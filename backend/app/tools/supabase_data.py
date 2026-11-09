"""Supabase-first data access layer.

Queries the ETL star schema (dim_indicators, dim_org_units, fact_indicator_values)
before falling back to the live DHIS2 API. This dramatically reduces latency
for indicators that have already been synced.

Architecture:
    Analysis request
      → search_indicators()  in dim_indicators, fallback to DHIS2 search
      → query_analytics()    in fact_indicator_values, fallback to DHIS2 analytics
      → if fallback was used, the caller can trigger an incremental ETL sync
"""

from __future__ import annotations

import re
import time
import unicodedata
from difflib import SequenceMatcher
from typing import Any

import httpx
from supabase import create_client, Client

from app.agents.fuzzy_matching import fuzzy_similarity
from app.core.config import settings


# ─── Client ───────────────────────────────────────────────

_client: Client | None = None


def _get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    return _client


# ─── Helpers ──────────────────────────────────────────────

def _normalize(text: str) -> str:
    """Lowercase, strip accents, keep only alphanumerics."""
    nf = unicodedata.normalize("NFD", text)
    no_accents = "".join(c for c in nf if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9\s]", " ", no_accents.lower()).strip()


def _expand_periods(periods: list[str]) -> list[str]:
    """Expand relative period keywords to explicit YYYYMM codes.

    Returns the input unchanged if they are already explicit (6-digit).
    """
    if not periods:
        return periods
    # If already explicit YYYYMM (monthly) or YYYY (yearly), return as-is
    if all(re.match(r"^\d{4}(?:\d{2})?$", p) for p in periods):
        return periods

    from datetime import datetime
    now = datetime.now()
    cy, cm = now.year, now.month

    expanded: list[str] = []
    for p in periods:
        p_upper = p.upper()
        if re.match(r"^\d{6}$", p):
            expanded.append(p)
        elif p_upper == "THIS_MONTH":
            expanded.append(f"{cy}{cm:02d}")
        elif p_upper == "LAST_MONTH":
            lm = cm - 1
            ly = cy
            if lm < 1:
                lm = 12
                ly -= 1
            expanded.append(f"{ly}{lm:02d}")
        elif p_upper == "LAST_3_MONTHS":
            for i in range(1, 4):
                m = cm - i
                y = cy
                if m < 1:
                    m += 12
                    y -= 1
                expanded.append(f"{y}{m:02d}")
        elif p_upper == "LAST_6_MONTHS":
            for i in range(1, 7):
                m = cm - i
                y = cy
                if m < 1:
                    m += 12
                    y -= 1
                expanded.append(f"{y}{m:02d}")
        elif p_upper == "LAST_12_MONTHS":
            for i in range(1, 13):
                m = cm - i
                y = cy
                if m < 1:
                    m += 12
                    y -= 1
                expanded.append(f"{y}{m:02d}")
        elif p_upper == "THIS_YEAR":
            expanded.extend(f"{cy}{m:02d}" for m in range(1, cm + 1))
        elif p_upper == "LAST_YEAR":
            expanded.extend(f"{cy - 1}{m:02d}" for m in range(1, 13))
        # YEAR_OVER_YEAR handled by caller if needed
    return expanded


# ─── Indicator search ─────────────────────────────────────

def search_indicators(query: str, limit: int = 8) -> list[dict]:
    """Search dim_indicators by label match.

    Returns a list of candidates sorted by relevance:
        [{"id": str, "name": str, "code": None, "description": None, "score": float}]
    Returns empty list if no match or Supabase unavailable.
    """
    try:
        client = _get_client()
        # Keep short numeric tokens (e.g. "1", "3") — they are critical for
        # distinguishing indicators like "Pentavalent 1" vs "Pentavalent 3".
        terms = [w for w in _normalize(query).split()
                 if len(w) >= 3 or w.isdigit()][:6]
        if not terms:
            return []

        # Fetch all indicators (small table) and score in-memory
        resp = client.table("dim_indicators").select("id,label,source").execute()
        all_indicators = resp.data or []
        if not all_indicators:
            return []

        candidates = []
        for ind in all_indicators:
            haystack = _normalize(ind.get("label", ""))
            matched = 0
            for t in terms:
                if t.isdigit():
                    # Word-boundary match for numbers so "1" doesn't match "13"
                    if re.search(r"\b" + re.escape(t) + r"\b", haystack):
                        matched += 1
                elif t in haystack:
                    matched += 1
            if matched > 0:
                candidates.append({
                    "id": ind["id"],
                    "name": ind.get("label", ind["id"]),
                    "code": None,
                    "description": None,
                    "score": matched / max(len(terms), 1),
                })

        candidates.sort(key=lambda c: (-c["score"], c["name"]))
        return candidates[:limit]
    except Exception:
        return []


# ─── Org unit lookup ──────────────────────────────────────

def _dhis2_search_org_unit(name_query: str) -> dict | None:
    """Fallback: search DHIS2 directly for an org unit by name.

    Used when Supabase is unavailable or returns no results.
    """
    try:
        if not settings.dhis2_base_url or not settings.dhis2_username:
            return None
        # Extract significant words from the query
        norm_q = _normalize(name_query)
        generic_terms = {
            "zone", "de", "sante", "zs", "province", "provinces",
            "aire", "as", "national", "pays", "la", "du", "des", "les",
            "le", "l", "d", "republique", "democratique", "congo", "rdc",
        }
        significant_words = [w for w in norm_q.split() if w not in generic_terms and len(w) >= 3]
        search_term = significant_words[0] if significant_words else norm_q

        url = (
            f"{settings.dhis2_base_url}/api/organisationUnits.json"
            f"?fields=id,name,level&filter=name:ilike:{search_term}&paging=false"
        )
        with httpx.Client(timeout=30) as http_client:
            resp = http_client.get(
                url,
                auth=(settings.dhis2_username, settings.dhis2_password),
                headers={"Accept": "application/json"},
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
        units = data.get("organisationUnits", [])
        if not units:
            return None
        # Score and return best match
        scored = []
        for u in units:
            norm_name = _normalize(u.get("name", ""))
            score = sum(1 for w in significant_words if w in norm_name) if significant_words else 1
            if "zone" in norm_q and "sante" in norm_q and u.get("level") == 3:
                score += 2
            scored.append((score, u))
        scored.sort(key=lambda x: (-x[0], x[1].get("level", 99)))
        return scored[0][1] if scored else units[0]
    except Exception:
        return None


def find_org_unit(name_query: str) -> dict | None:
    """Find an org unit by name (case-insensitive, accent-insensitive).

    Tries Supabase first, falls back to DHIS2 API search.
    Returns {"id": str, "name": str, "level": int} or None.
    """
    # ─── Try Supabase first ───────────────────────────────
    try:
        client = _get_client()
        norm_q = _normalize(name_query)

        # Strip generic terms so "zone de santé de Mosango" → "mosango"
        # and "province de l'Equateur" → "equateur". This prevents the ilike
        # pattern from failing due to word order mismatches with stored names
        # like "kl Mosango Zone de Santé".
        generic_terms = {
            "zone", "de", "sante", "zs", "province", "provinces",
            "aire", "as", "national", "pays", "la", "du", "des", "les",
            "le", "la", "l", "d", "republique", "democratique", "congo",
            "rdc", "rdc",
        }
        significant_words = [w for w in norm_q.split() if w not in generic_terms and len(w) >= 3]

        # Build an OR ilike filter on the most significant word(s)
        if significant_words:
            query = client.table("dim_org_units").select("id,name,level")
            # Use the longest significant word as primary search key
            primary_word = max(significant_words, key=len)
            query = query.ilike("name", f"%{primary_word}%")
            resp = query.limit(10).execute()
        else:
            # Fallback: full phrase search
            pattern = f"%{name_query}%"
            resp = (
                client.table("dim_org_units")
                .select("id,name,level")
                .ilike("name", pattern)
                .limit(5)
                .execute()
            )
        rows = resp.data or []
        if rows:
            # Score by how many significant words match
            scored = []
            for r in rows:
                norm_name = _normalize(r.get("name", ""))
                score = sum(1 for w in significant_words if w in norm_name) if significant_words else 1
                # Prefer lower-level units (health zones = 3) when user mentions "zone de sante"
                if "zone" in norm_q and "sante" in norm_q:
                    level = r.get("level", 0)
                    if level == 3:
                        score += 2  # boost health zones
                scored.append((score, r))
            scored.sort(key=lambda x: (-x[0], x[1].get("level", 99)))
            return scored[0][1] if scored[0][0] > 0 else rows[0]
    except Exception:
        pass  # Supabase failed, try DHIS2 fallback

    # ─── DHIS2 fallback ───────────────────────────────────
    return _dhis2_search_org_unit(name_query)


# ─── Scored candidate search (fuzzy, misspelling-tolerant) ─

_OU_GENERIC_TOKENS = {
    "zone", "zones", "de", "sante", "zs", "province", "provinces",
    "aire", "aires", "as", "national", "pays", "la", "du", "des",
    "les", "le", "l", "d", "republique", "democratique", "congo", "rdc",
}

# Catalog of org units up to level 3 (provinces + health zones), cached
# in-process so fuzzy matching doesn't hit Supabase/DHIS2 on every request.
_ou_catalog_cache: tuple[float, list[dict]] | None = None
_OU_CATALOG_TTL = 1800  # seconds


def _org_unit_catalog(max_level: int = 3) -> list[dict]:
    """All org units up to max_level, from Supabase with DHIS2 fallback."""
    global _ou_catalog_cache
    if _ou_catalog_cache and time.time() - _ou_catalog_cache[0] < _OU_CATALOG_TTL:
        return _ou_catalog_cache[1]
    units: list[dict] = []
    try:
        client = _get_client()
        resp = client.table("dim_org_units").select("id,name,level").lte("level", max_level).execute()
        units = resp.data or []
    except Exception:
        units = []
    if not units and settings.dhis2_base_url and settings.dhis2_username:
        try:
            url = (
                f"{settings.dhis2_base_url}/api/organisationUnits.json"
                f"?fields=id,name,level&filter=level:le:{max_level}&paging=false"
            )
            with httpx.Client(timeout=60) as http_client:
                resp = http_client.get(
                    url,
                    auth=(settings.dhis2_username, settings.dhis2_password),
                    headers={"Accept": "application/json"},
                )
            if resp.status_code == 200:
                units = resp.json().get("organisationUnits", [])
        except Exception:
            units = []
    if units:
        _ou_catalog_cache = (time.time(), units)
    return units


def invalidate_org_unit_catalog() -> None:
    """Force a reload of the org unit catalog on next access.

    Call after an ETL sync that adds or renames org units.
    """
    global _ou_catalog_cache
    _ou_catalog_cache = None


def _core_org_name(name: str) -> str:
    """Extract the distinctive part of an org unit name.

    'll Lualaba Zone de Santé' → 'lualaba' (drops the 2-letter province
    prefix and generic type words, normalizes accents/case).
    """
    tokens = _normalize(name).split()
    core = [t for t in tokens if t not in _OU_GENERIC_TOKENS and not (len(t) <= 2 and t.isalpha())]
    return " ".join(core)


def find_org_unit_candidates(name_query: str, limit: int = 5) -> list[dict]:
    """Scored org unit candidates for a possibly misspelled name.

    Fuzzy-matches the query against the catalog of provinces and health
    zones (levels ≤ 3), tolerating spelling variants like 'Lwalaba' →
    'Lualaba' via combined character/bigram/phonetic similarity. Returns
    [{"id", "name", "level", "score"}] sorted by score (1.0 = exact
    core-name match).
    """
    norm_q = _normalize(name_query)
    significant = [w for w in norm_q.split() if w not in _OU_GENERIC_TOKENS and len(w) >= 3]
    query_core = " ".join(significant) or norm_q.strip()
    if len(query_core) < 3:
        return []

    # ── Contextual level hints (opt 9) ──
    # Strong bonus when the user explicitly named the level.
    wants_zone = bool(re.search(r"\b(zone|zs)\b", norm_q))
    wants_province = bool(re.search(r"\bprovince\b", norm_q))
    zone_bonus = 0.15 if wants_zone else 0.0
    zone_penalty = -0.05 if wants_province else 0.0
    province_bonus = 0.15 if wants_province else 0.0
    province_penalty = -0.05 if wants_zone else 0.0
    # Default (no explicit level): slight province preference
    if not wants_zone and not wants_province:
        province_bonus = 0.03

    results: dict[str, dict] = {}
    for unit in _org_unit_catalog():
        core = _core_org_name(unit.get("name", ""))
        if not core:
            continue
        if query_core == core:
            score = 1.0
        elif query_core in core or core in query_core:
            score = 0.9
        else:
            score = fuzzy_similarity(query_core, core)
            # Cap fuzzy matches below 1.0 so exact name matches always
            # rank higher than fuzzy look-alikes (e.g. "Makala" exact
            # vs "Mokala" fuzzy should prefer the exact match).
            if score > 0.99:
                score = 0.99
        if score < 0.72:
            continue
        # Apply contextual level scoring
        level = unit.get("level")
        if level == 3:
            score += zone_bonus + zone_penalty
        elif level == 2:
            score += province_bonus + province_penalty
        entry = {
            "id": unit["id"],
            "name": unit.get("name", unit["id"]),
            "level": level,
            "score": round(min(max(score, 0.0), 1.0), 3),
        }
        previous = results.get(unit["id"])
        if not previous or previous["score"] < entry["score"]:
            results[unit["id"]] = entry

    ranked = sorted(results.values(), key=lambda c: (-c["score"], c.get("level") or 99))
    return ranked[:limit]


def get_org_unit_children(org_unit_id: str, target_level: int) -> list[dict]:
    """Get child org units at a given level under a parent.

    Returns [{"id": str, "name": str, "level": int}].
    """
    try:
        client = _get_client()
        resp = (
            client.table("dim_org_units")
            .select("id,name,level")
            .eq("level", target_level)
            .execute()
        )
        # We can't easily do recursive parent queries via the REST API,
        # so we return all units at the target level. The caller should
        # filter by parent if needed. For now, this is used when the
        # parent is the national root, so all level-N units are children.
        return resp.data or []
    except Exception:
        return []


# ─── Analytics query ──────────────────────────────────────

def query_analytics(
    indicator_id: str,
    periods: list[str],
    org_unit_id: str,
    target_level: int | None = None,
) -> dict | None:
    """Query fact_indicator_values for the given indicator/periods/org_unit.

    Returns a DHIS2-compatible analytics result dict, or None if no data found.

    The returned structure matches what _fetch_analytics() in dhis2.py produces:
        {
            "rows": [[dx, pe, ou, value], ...],
            "metaData": {"items": {id: {"name": name}}, "dimensions": {...}},
            "headers": [...],
        }
    """
    try:
        client = _get_client()

        # Expand relative periods to explicit YYYYMM
        explicit_periods = _expand_periods(periods)
        if not explicit_periods:
            return None

        # Build query
        query = (
            client.table("fact_indicator_values")
            .select("indicator_id,org_unit_id,period,value")
            .eq("indicator_id", indicator_id)
            .in_("period", explicit_periods)
        )

        if target_level:
            # Get all org units at the target level
            children = get_org_unit_children(org_unit_id, target_level)
            child_ids = [c["id"] for c in children]
            if org_unit_id in child_ids or not child_ids:
                # Just query the parent org unit
                query = query.eq("org_unit_id", org_unit_id)
            else:
                # Query all children
                query = query.in_("org_unit_id", child_ids)
        else:
            query = query.eq("org_unit_id", org_unit_id)

        resp = query.execute()
        rows_data = resp.data or []
        if not rows_data:
            return None

        # Build DHIS2-compatible structure
        rows: list[list[str]] = []
        items: dict[str, dict] = {}

        # Get indicator name
        ind_resp = client.table("dim_indicators").select("label").eq("id", indicator_id).limit(1).execute()
        ind_name = ind_resp.data[0]["label"] if ind_resp.data else indicator_id
        items[indicator_id] = {"name": ind_name}

        # Get org unit names
        org_unit_ids = list({r["org_unit_id"] for r in rows_data})
        if org_unit_ids:
            ou_resp = (
                client.table("dim_org_units")
                .select("id,name")
                .in_("id", org_unit_ids)
                .execute()
            )
            for ou in ou_resp.data or []:
                items[ou["id"]] = {"name": ou.get("name", ou["id"])}

        for r in rows_data:
            dx = r["indicator_id"]
            pe = r["period"]
            ou = r["org_unit_id"]
            val = str(r["value"])
            rows.append([dx, pe, ou, val])
            if ou not in items:
                items[ou] = {"name": ou}

        # Build dimensions
        dimensions: dict[str, list[str]] = {
            "dx": [indicator_id],
            "pe": sorted({r["period"] for r in rows_data}),
            "ou": sorted({r["org_unit_id"] for r in rows_data}),
        }

        return {
            "rows": rows,
            "metaData": {
                "items": items,
                "dimensions": dimensions,
            },
            "headers": [
                {"name": "dx"},
                {"name": "pe"},
                {"name": "ou"},
                {"name": "value"},
            ],
        }
    except Exception:
        return None


# ─── Combined: Supabase-first with DHIS2 fallback ─────────

def try_supabase_analysis(
    metric_query: str,
    periods: list[str],
    org_unit_id: str,
    target_level: int | None = None,
) -> tuple[dict | None, dict | None]:
    """Try to run the full analysis from Supabase.

    Returns (analytics_result, metric) or (None, None) if Supabase
    doesn't have the data.

    The analytics_result is DHIS2-compatible so the caller can use it
    interchangeably with the DHIS2 API response.
    """
    # 1. Search indicator in Supabase
    candidates = search_indicators(metric_query)
    if not candidates:
        return None, None

    metric = candidates[0]

    # 2. Query analytics from Supabase
    analytics = query_analytics(
        indicator_id=metric["id"],
        periods=periods,
        org_unit_id=org_unit_id,
        target_level=target_level,
    )
    if not analytics:
        return None, None

    return analytics, metric
