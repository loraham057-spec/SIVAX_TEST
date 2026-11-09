"""
DHIS2 Tool — server-side execution of DHIS2 analyses.

Port of src/lib/dhis2-analysis.ts. Executes the real DHIS2 API calls so the
agent's fact checker can verify every figure against ground-truth data.
The frontend STILL receives the run_dhis2_analysis command to render the chart;
this tool produces the verified facts used by the response generator.
"""

from __future__ import annotations

import asyncio
import time
import re
import unicodedata
import httpx
from app.core.cache import get_cache
from app.core.config import settings
from app.tools.supabase_data import try_supabase_analysis, search_indicators as supabase_search


# ─── Cache ─────────────────────────────────────────────────
# Backed by the shared cache layer so entries survive across replicas once
# REDIS_URL is set; falls back to process memory otherwise.

CACHE_TTL_METADATA = 24 * 60 * 60  # 24h
CACHE_TTL_DATA = 10 * 60  # 10 min

_CACHE_PREFIX = "dhis2:"

# Upper bound on metadata rows fetched per search term.
SEARCH_PAGE_SIZE = 50


async def _cached(key: str):
    cache = await get_cache()
    return await cache.get(_CACHE_PREFIX + key)


async def _store(key: str, value, ttl: int):
    cache = await get_cache()
    await cache.set(_CACHE_PREFIX + key, value, ttl)


# ─── Low-level DHIS2 client ────────────────────────────────
#
# A single AsyncClient is shared for the whole process: connections to SNIS RDC
# are kept alive between calls (TLS handshakes dominate on a slow link), and the
# semaphore caps outbound concurrency so a fan-out search cannot flood the
# server. The client is bound to the event loop that first created it, so it is
# rebuilt if the loop changes (tests, reload).

_HTTP_TIMEOUT = httpx.Timeout(connect=5.0, read=15.0, write=10.0, pool=15.0)
_MAX_CONCURRENCY = 6

_client: httpx.AsyncClient | None = None
_client_loop: asyncio.AbstractEventLoop | None = None
_client_lock = asyncio.Lock()
_semaphore: asyncio.Semaphore | None = None
# Coalesces identical in-flight requests (the same term is often searched by
# several concurrent questions) into a single network call.
_inflight: dict[str, asyncio.Task] = {}


async def _get_client() -> tuple[httpx.AsyncClient, asyncio.Semaphore]:
    global _client, _client_loop, _semaphore
    loop = asyncio.get_running_loop()
    if _client is not None and _client_loop is loop and _semaphore is not None:
        return _client, _semaphore
    async with _client_lock:
        if _client is None or _client_loop is not loop or _semaphore is None:
            _client = httpx.AsyncClient(
                timeout=_HTTP_TIMEOUT,
                limits=httpx.Limits(max_connections=_MAX_CONCURRENCY, max_keepalive_connections=_MAX_CONCURRENCY),
                headers={"Accept": "application/json", "Accept-Encoding": "gzip, deflate"},
            )
            _client_loop = loop
            _semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
    return _client, _semaphore


async def close_client() -> None:
    """Close the shared client — called on FastAPI shutdown."""
    global _client, _client_loop, _semaphore
    if _client is not None:
        await _client.aclose()
    _client, _client_loop, _semaphore = None, None, None


async def _dhis2_get(path: str, retries: int = 2):
    if not settings.dhis2_base_url or not settings.dhis2_username or not settings.dhis2_password:
        raise RuntimeError("DHIS2 is not configured (missing base URL, username, or password)")

    existing = _inflight.get(path)
    if existing is not None:
        return await asyncio.shield(existing)

    task = asyncio.ensure_future(_dhis2_get_uncached(path, retries))
    _inflight[path] = task
    try:
        return await asyncio.shield(task)
    finally:
        if _inflight.get(path) is task:
            _inflight.pop(path, None)


async def _dhis2_get_uncached(path: str, retries: int):
    client, semaphore = await _get_client()
    url = f"{settings.dhis2_base_url}{path}"
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            async with semaphore:
                res = await client.get(
                    url,
                    auth=(settings.dhis2_username, settings.dhis2_password),
                )
            if res.status_code != 200:
                raise RuntimeError(f"DHIS2 request failed ({res.status_code}) for {path}")
            return res.json()
        except Exception as e:  # noqa: BLE001
            last_error = e
            if attempt < retries:
                await asyncio.sleep(2 ** attempt)
    raise last_error or RuntimeError("DHIS2 request: unreachable")


# ─── Metric search (port of dhis2-analysis.ts) ────────────

STOP_WORDS = {
    "affiche", "analyse", "avec", "dans", "dernier", "derniers", "durant",
    "entre", "faire", "moins", "montre", "pour", "repartition", "sante",
    "selon", "trois", "zone", "zones",
}

SYNONYM_MAP: dict[str, list[str]] = {
    "paludisme": ["malaria", "paludisme"],
    "malaria": ["malaria", "paludisme"],
    "vaccination": ["vaccination", "vaccine", "vaccin"],
    "vaccin": ["vaccination", "vaccine", "vaccin"],
    "bcg": ["bcg"],
    "dtc": ["dtc", "diphtherie", "tetanos", "coqueluche"],
    "rougeole": ["rougeole", "measles", "measle"],
    "polio": ["polio", "poliomyelite", "poliomyelitis"],
    "fievre": ["fievre", "fever"],
    "jaune": ["jaune", "yellow"],
    "accouchement": ["accouchement", "delivery", "naissance", "assiste"],
    "cpn": ["cpn", "prenatale", "anc", "prenatal"],
    "prenatale": ["prenatale", "prenatal", "cpn", "anc"],
    "nutrition": ["nutrition", "malnutrition", "nutritional"],
    "malnutrition": ["malnutrition", "nutrition", "nutritional"],
    "cas": ["cas", "case", "cases"],
    "confirmes": ["confirmes", "confirmed", "confirme"],
    "confirme": ["confirmes", "confirmed", "confirme"],
    "deces": ["deces", "death", "deaths"],
    "hospitalisation": ["hospitalisation", "hospital", "admission"],
    "consultation": ["consultation", "consult", "visit"],
    "tuberculose": ["tuberculose", "tuberculosis", "tb"],
    "tb": ["tuberculose", "tuberculosis", "tb"],
    "vih": ["vih", "sida", "hiv", "aids"],
    "sida": ["vih", "sida", "hiv", "aids"],
}


def _normalize(value: str) -> str:
    text = unicodedata.normalize("NFD", value)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _search_terms(query: str) -> list[str]:
    base = [w for w in dict.fromkeys(_normalize(query).split(" "))
            if (len(w) >= 3 or w.isdigit()) and w not in STOP_WORDS][:6]
    expanded: list[str] = []
    seen: set[str] = set()
    for term in base:
        for candidate in [term, *SYNONYM_MAP.get(term, [])]:
            if candidate not in seen:
                seen.add(candidate)
                expanded.append(candidate)
    return expanded[:8]


async def _search_term(collection: str, term: str) -> list[dict]:
    """One metadata lookup, cached for 24h — DHIS2 metadata barely changes."""
    cache_key = f"search:{collection}:{term}"
    cached = await _cached(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    # `paging=false` asked DHIS2 for every match: a generic term like "cas" can
    # return thousands of rows, of which only the top 8 are ever used. 50 is
    # well above what the scoring pass needs.
    path = (
        f"/api/{collection}.json?fields=id,name,shortName,code,description"
        f"&filter=name:ilike:{term}&pageSize={SEARCH_PAGE_SIZE}"
    )
    try:
        data = await _dhis2_get(path, retries=0)
    except Exception:  # noqa: BLE001
        return []
    items = data.get(collection, [])
    await _store(cache_key, items, CACHE_TTL_METADATA)
    return items


async def _search_collection(collection: str, terms: list[str]) -> list[dict]:
    # All terms are queried concurrently instead of one after the other: the
    # wall-clock cost of a search drops from sum(latencies) to max(latencies).
    responses = await asyncio.gather(*(_search_term(collection, t) for t in terms))

    found: dict[str, dict] = {}
    for items in responses:
        for item in items:
            found[item["id"]] = item

    candidates = []
    for item in found.values():
        haystack = _normalize(
            f"{item.get('name', '')} {item.get('shortName', '')} "
            f"{item.get('code', '')} {item.get('description', '')}"
        )
        matched = 0
        for t in terms:
            if t.isdigit():
                if re.search(r"\b" + re.escape(t) + r"\b", haystack):
                    matched += 1
            elif t in haystack:
                matched += 1
        candidates.append({
            "id": item["id"],
            "name": item.get("name", ""),
            "code": item.get("code"),
            "description": item.get("description"),
            "score": matched / max(len(terms), 1),
        })
    return candidates


async def search_metrics(query: str) -> list[dict]:
    terms = _search_terms(query)
    if not terms:
        return []

    cache_key = f"metrics:{'|'.join(terms)}"
    cached = await _cached(cache_key)
    if cached is not None:
        return cached  # type: ignore[return-value]

    indicators, data_elements = await asyncio.gather(
        _search_collection("indicators", terms),
        _search_collection("dataElements", terms),
    )
    all_candidates = indicators + data_elements
    all_candidates.sort(key=lambda c: (-c["score"], c["name"]))
    top = all_candidates[:8]
    await _store(cache_key, top, CACHE_TTL_METADATA)
    return top


# ─── Analytics ─────────────────────────────────────────────

VALID_PERIODS = {
    "THIS_MONTH", "LAST_MONTH", "THIS_YEAR", "LAST_YEAR",
    "LAST_12_MONTHS", "LAST_6_MONTHS", "LAST_3_MONTHS", "YEAR_OVER_YEAR",
}

VALID_VISUALIZATIONS = {"auto", "kpi", "line", "bar", "pie", "table"}


async def _fetch_analytics(dx: list[str], pe: list[str], ou: str, target_level: int | None) -> dict:
    cache_key = f"analytics:{';'.join(dx)}:{';'.join(pe)}:{ou}:{target_level or 'self'}"
    cached = await _cached(cache_key)
    if cached:
        return cached

    pe_param = pe[0] if len(pe) == 1 else ";".join(pe)
    ou_param = f"{ou};LEVEL-{target_level}" if target_level else ou

    paths = [
        f"/api/analytics.json?dimension=dx:{single_dx}"
        f"&dimension=pe:{pe_param}"
        f"&dimension=ou:{ou_param}"
        f"&displayProperty=NAME&skipMeta=false&skipRounding=true"
        for single_dx in dx
    ]
    # One request per indicator, all in flight at once (bounded by the client
    # semaphore) rather than chained.
    responses = await asyncio.gather(*(_dhis2_get(p) for p in paths), return_exceptions=True)

    rows: list[list[str]] = []
    items: dict = {}
    headers: list = []
    for data in responses:
        if isinstance(data, BaseException) or not isinstance(data, dict):
            continue
        rows.extend(data.get("rows", []))
        meta = data.get("metaData", {})
        items.update(meta.get("items", {}))
        if not headers:
            headers = data.get("headers", [])

    if not rows:
        # Surface the query context so the agent can explain the failure
        # precisely (wrong org unit resolution vs. genuinely missing data)
        # instead of a generic "no data" answer.
        first_error = next((r for r in responses if isinstance(r, BaseException)), None)
        detail = f" (erreur DHIS2 : {first_error})" if first_error else ""
        raise RuntimeError(
            f"La requête analytics DHIS2 n'a retourné aucune donnée pour "
            f"dx={';'.join(dx)}, pe={pe_param}, ou={ou_param}{detail}. "
            "Vérifiez que l'unité d'organisation résolue correspond bien au lieu "
            "demandé (orthographe, niveau province/ZS/AS) et que la période est couverte."
        )

    result = {"headers": headers, "metaData": {"items": items}, "rows": rows}
    await _store(cache_key, result, CACHE_TTL_DATA)
    return result


async def _fetch_org_units(level: int, parent: str) -> list[dict]:
    cache_key = f"orgUnits:{level}:{parent}"
    cached = await _cached(cache_key)
    if cached:
        return cached
    path = (
        "/api/organisationUnits.json?fields=id,name,level,shortName"
        f"&filter=level:eq:{level}&filter=path:like:{parent}&paging=false"
    )
    data = await _dhis2_get(path)
    units = data.get("organisationUnits", [])
    await _store(cache_key, units, CACHE_TTL_METADATA)
    return units


# ─── Tool ──────────────────────────────────────────────────


def _compare(value: float, threshold: float, operator: str) -> bool:
    if operator == "gt":
        return value > threshold
    if operator == "gte":
        return value >= threshold
    if operator == "lt":
        return value < threshold
    if operator == "lte":
        return value <= threshold
    if operator == "eq":
        return value == threshold
    return False


def _aggregate_by_period(cells: list[dict], measurement_type: str) -> dict[str, float]:
    values_by_period: dict[str, list[float]] = {}
    for cell in cells:
        values_by_period.setdefault(cell["period"], []).append(cell["value"])
    return {
        period: (
            sum(period_values) / len(period_values)
            if measurement_type in ("proportion", "rate")
            else sum(period_values)
        )
        for period, period_values in values_by_period.items()
    }


def _build_threshold_proportion(
    cells: list[dict], threshold: float, comparison_operator: str
) -> dict | None:
    periods = {cell["period"] for cell in cells}
    latest_period = max(periods) if periods else None
    if latest_period is None:
        return None
    latest_by_org_unit = {
        cell["org_unit_id"]: cell
        for cell in cells
        if cell["period"] == latest_period
    }
    eligible_cells = list(latest_by_org_unit.values())
    denominator = len(eligible_cells)
    numerator = sum(
        1 for cell in eligible_cells
        if _compare(cell["value"], threshold, comparison_operator)
    )
    return {
        "type": "threshold_proportion",
        "period": latest_period,
        "numerator": numerator,
        "denominator": denominator,
        "value": round(numerator / denominator * 100, 2) if denominator else None,
        "unit": "percent",
        "threshold": threshold,
        "comparison_operator": comparison_operator,
        "denominator_basis": "unités géographiques ayant une valeur valide pour la période",
        "excluded_missing": None,
    }


class Dhis2Tool:
    """Isolated tool for DHIS2 analysis operations."""

    async def execute(self, action: str, args: dict) -> dict:
        if action == "run_dhis2_analysis":
            return await self.run_analysis(args)
        raise ValueError(f"Unknown DHIS2 action: {action}")

    async def run_analysis(self, args: dict) -> dict:
        """
        Run a DHIS2 analysis server-side and return verified facts
        (ground truth numbers) used by the agent's fact checker.

        Strategy: Supabase-first with DHIS2 fallback.
        1. Try to find the indicator and query data from Supabase (ETL tables).
        2. If Supabase has the data, return it immediately (fast path).
        3. If Supabase doesn't have it, fall back to the live DHIS2 API.
        """
        question = str(args.get("question", "")).strip()
        metric_query = str(args.get("metricQuery") or question).strip()
        requested_metric_id = str(args.get("metricId") or "").strip()
        requested_metric_name = str(args.get("metricName") or metric_query).strip()
        period = str(args.get("periodPreset", "LAST_12_MONTHS")).upper()
        if period not in VALID_PERIODS:
            period = "LAST_3_MONTHS"
        # Explicit periods (YYYYMM monthly or YYYY yearly) take precedence over preset
        raw_periods = args.get("periods")
        explicit_periods = None
        if isinstance(raw_periods, list) and raw_periods:
            explicit_periods = [str(p).strip() for p in raw_periods if isinstance(p, str) and re.match(r"^\d{4}(?:\d{2})?$", str(p).strip())]
            if not explicit_periods:
                explicit_periods = None
        org_unit = str(args.get("orgUnitId") or settings.dhis2_root_ou).strip() or settings.dhis2_root_ou
        raw_level = args.get("targetOrgUnitLevel")
        target_level = int(raw_level) if isinstance(raw_level, (int, float)) else None

        pe_list = explicit_periods if explicit_periods else [period]

        # candidates is populated only on the DHIS2 fallback path; initialize
        # it here so the `ambiguous` check below doesn't raise UnboundLocalError
        # when the Supabase fast path is taken.
        candidates: list[dict] = []
        data_source = "DHIS2 — SNIS RDC"

        # ─── Supabase-first path ────────────────────
        # supabase_search and try_supabase_analysis both use the blocking
        # supabase-py client. Running them on the event loop would stall every
        # other in-flight DHIS2 request, so they go to a worker thread.
        if not requested_metric_id:
            sb_candidates = await asyncio.to_thread(supabase_search, metric_query or question)
            if len(sb_candidates) > 1 and sb_candidates[0]["score"] == sb_candidates[1]["score"]:
                return {
                    "status": "needs_clarification",
                    "message": f"Plusieurs métriques correspondent à « {metric_query} ».",
                    "candidates": sb_candidates[:5],
                }
        sb_analytics, sb_metric = await asyncio.to_thread(
            try_supabase_analysis,
            metric_query=metric_query or question,
            periods=pe_list,
            org_unit_id=org_unit,
            target_level=target_level,
        )
        if requested_metric_id and sb_metric and sb_metric.get("id") != requested_metric_id:
            sb_analytics, sb_metric = None, None

        if sb_analytics and sb_metric:
            # Supabase has the data — use it (fast path)
            data_source = "Supabase ETL — source DHIS2 SNIS RDC"
            metric = sb_metric
            analytics = sb_analytics
            rows = analytics["rows"]
            items = dict(analytics["metaData"]["items"])
            items[metric["id"]] = {"name": metric["name"]}
            if target_level:
                for unit in await _fetch_org_units(target_level, org_unit):
                    items[unit["id"]] = {"name": unit["name"]}
        else:
            # ─── DHIS2 fallback ───────────────────
            if requested_metric_id:
                metric = {
                    "id": requested_metric_id,
                    "name": requested_metric_name,
                    "score": 1.0,
                    "type": "indicator",
                }
            else:
                candidates = await search_metrics(metric_query or question)
                if not candidates:
                    return {
                        "status": "needs_clarification",
                        "message": f"Aucune métrique DHIS2 trouvée pour « {metric_query} ».",
                        "candidates": [],
                    }
                if len(candidates) > 1 and candidates[0]["score"] == candidates[1]["score"]:
                    return {
                        "status": "needs_clarification",
                        "message": f"Plusieurs métriques DHIS2 correspondent à « {metric_query} ».",
                        "candidates": candidates[:5],
                    }
                metric = candidates[0]

            # The analytics query and the org-unit label lookup are independent —
            # issue them together instead of waiting for the first to finish.
            analytics_task = _fetch_analytics([metric["id"]], pe_list, org_unit, target_level)
            if target_level:
                analytics, org_units = await asyncio.gather(
                    analytics_task,
                    _fetch_org_units(target_level, org_unit),
                )
            else:
                analytics, org_units = await analytics_task, []

            rows = analytics["rows"]
            items = dict(analytics["metaData"]["items"])
            items[metric["id"]] = {"name": metric["name"]}
            for unit in org_units:
                items[unit["id"]] = {"name": unit["name"]}

        # ─── Build cells: each row → {period, org_unit_id, org_unit_name, value} ─
        cells: list[dict] = []
        for r in rows:
            if len(r) > 3 and _is_number(r[3]):
                ou_id = r[2] if len(r) > 2 else org_unit
                ou_name = _clean_name(items.get(ou_id, {}).get("name", ou_id))
                cells.append({
                    "period": r[1],
                    "period_label": _period_label(r[1]),
                    "org_unit_id": ou_id,
                    "org_unit_name": ou_name,
                    "orgUnitId": ou_id,
                    "orgUnitName": ou_name,
                    "value": round(float(r[3]), 2),
                })

        # ─── Compute verified facts (ground truth) ─────────
        values = [c["value"] for c in cells]
        org_unit_ids = {c["org_unit_id"] for c in cells}
        periods_set = {c["period"] for c in cells}
        measurement_type = str(args.get("measurementType") or "value")

        # ─── Query scope: what the user actually asked for ───
        # This lets fact_check verify that a number is attributed to the
        # correct period + org_unit, not just that it exists somewhere.
        scope_ou_name = _clean_name(items.get(org_unit, {}).get("name", org_unit))
        query_scope: dict = {
            "metric_id": metric["id"],
            "metric_name": metric["name"],
            "org_unit_id": org_unit,
            "org_unit_name": scope_ou_name,
            "orgUnitId": org_unit,
            "orgUnitName": scope_ou_name,
            "periods": sorted(periods_set),
            "target_level": target_level,
            "targetLevel": target_level,
            "antigens": args.get("antigens") or [],
        }
        latest_period = max(periods_set) if periods_set else None
        latest_values = [cell["value"] for cell in cells if cell["period"] == latest_period]
        if measurement_type in ("proportion", "rate"):
            total = sum(latest_values) / len(latest_values) if latest_values else 0.0
            aggregate_method = "mean_of_reporting_units_latest_period"
        else:
            total = sum(values)
            aggregate_method = "sum"

        facts: dict = {
            "metric": {
                "id": metric["id"],
                "name": metric["name"],
                "type": metric.get("type", "indicator"),
            },
            "metric_name": metric["name"],
            "total": round(total, 2),
            "aggregate_method": aggregate_method,
            "org_unit_count": len(org_unit_ids),
            "period_count": len(periods_set),
            "period_label": ", ".join(explicit_periods) if explicit_periods else period.lower().replace("_", " "),
            # Flat set for backward compat (existing fact_check)
            "values": sorted({round(v, 2) for v in values}),
            # NEW: structured cells for cell-based fact checking
            "cells": cells,
            # NEW: what the user actually asked for
            "query_scope": query_scope,
        }
        facts["values"].append(round(total, 2))

        # Trend (first vs last period) using the measurement-appropriate aggregation
        by_period = _aggregate_by_period(cells, measurement_type)
        if len(by_period) >= 2:
            ordered = sorted(by_period.items())
            first_val, last_val = ordered[0][1], ordered[-1][1]
            delta = last_val - first_val
            facts["trend"] = {
                "direction": "up" if delta > 0 else ("down" if delta < 0 else "stable"),
                "first": round(first_val, 2),
                "last": round(last_val, 2),
                "pct_change": round(delta / first_val * 100, 1) if first_val else None,
            }
            facts["values"].extend([round(first_val, 2), round(last_val, 2)])

        # Top / bottom org units
        if len(org_unit_ids) > 1:
            by_ou = {
                cell["org_unit_id"]: cell["value"]
                for cell in cells
                if cell["period"] == latest_period
            }
            if len(by_ou) >= 2:
                ranked = sorted(by_ou.items(), key=lambda kv: kv[1], reverse=True)
                top_id, top_val = ranked[0]
                bottom_id, bottom_val = ranked[-1]
                facts["top"] = {
                    "name": _clean_name(items.get(top_id, {}).get("name", top_id)),
                    "value": round(top_val, 2),
                }
                facts["bottom"] = {
                    "name": _clean_name(items.get(bottom_id, {}).get("name", bottom_id)),
                    "value": round(bottom_val, 2),
                }
                facts["values"].extend([round(top_val, 2), round(bottom_val, 2)])

        threshold = args.get("threshold")
        comparison_operator = str(args.get("comparisonOperator") or "")
        derived = None
        if measurement_type == "proportion" and isinstance(threshold, (int, float)) and comparison_operator:
            derived = _build_threshold_proportion(cells, float(threshold), comparison_operator)
            if derived:
                facts["values"].extend([
                    float(derived["numerator"]),
                    float(derived["denominator"]),
                    float(threshold),
                ])
                if derived["value"] is not None:
                    facts["values"].append(derived["value"])

        facts["derived"] = derived
        facts["data_quality"] = {
            "status": "partially_assessed",
            "returned_cells": len(cells),
            "reported_org_units": len(org_unit_ids),
            "expected_org_units": None,
            "completeness": None,
            "promptitude": None,
            "limitations": [
                "La complétude et la promptitude ne sont pas calculables sans le nombre attendu de rapports."
            ],
        }
        facts["response_contract"] = {
            "version": "1.0",
            "qid": args.get("qid") or None,
            "analysis_intent": args.get("analysisIntent") or "metric_value",
            "measurement_type": measurement_type,
            "render_type": args.get("renderType") or "kpi_answer",
            "required_fields": [
                "direct_answer", "indicator", "period", "geography", "source",
                "data_quality", "limitations",
            ] + (["numerator", "denominator", "threshold_comparison"] if derived else []),
        }
        facts["values"] = sorted(set(facts["values"]))

        # ─── Analysis payload for the frontend container ────
        # This is the SINGLE source of truth that both the chat text
        # and the in-app analytics container should use. The frontend
        # must NOT re-query DHIS2 independently.
        is_ambiguous = len(candidates) > 1 and candidates[1]["score"] == metric["score"]
        warnings: list[str] = []
        if is_ambiguous:
            warnings.append(
                f"La métrique « {metric['name']} » a été sélectionnée automatiquement "
                f"parmi plusieurs correspondances."
            )
        analysis_payload: dict = {
            "metric": metric,
            "query_scope": query_scope,
            "rows": rows,
            "metaData": {"items": items},
            "summary": {
                "total": round(total, 2),
                "aggregateMethod": aggregate_method,
                "rowCount": len(rows),
                "orgUnitCount": len(org_unit_ids),
                "periodCount": len(periods_set),
                "derived": derived,
                "dataQuality": facts["data_quality"],
            },
            "verified_facts": facts,
            "render_type": args.get("renderType", "kpi_answer"),
            "analysis_type": args.get("analysisIntent", "metric_value"),
            "qid": args.get("qid") or None,
            "response_contract": facts["response_contract"],
            "visualization": args.get("visualization", "auto"),
            "provenance": {
                "source": data_source,
                "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "metricIds": [metric["id"]],
                "orgUnitId": org_unit,
                "orgUnitName": scope_ou_name,
                "periods": sorted(periods_set),
            },
            # Frontend rendering metadata — lets the UI render the full
            # analysis panel from this payload without a second DHIS2 call.
            "title": metric["name"],
            "candidates": candidates[:5] if candidates else [metric],
            "warnings": warnings,
        }

        return {
            "status": "ready",
            "metric": metric,
            "ambiguous": is_ambiguous,
            "verified_facts": facts,
            # Single source of truth for the in-app analytics container: the
            # frontend renders from this and must NOT re-query DHIS2 itself.
            "analysis_payload": analysis_payload,
            # Same data in the shape earlier clients expect. Returning it here
            # is what lets them skip re-running the whole analysis against
            # DHIS2 a second time (PERF-01).
            "analytics": {
                "headers": analytics.get("headers", []),
                "metaData": {"items": items},
                "rows": rows,
            },
            "candidates": candidates,
            "request": {
                "question": question,
                "metricQuery": metric_query,
                "periodPreset": period,
                "periods": explicit_periods,
                "orgUnitId": org_unit,
                "targetOrgUnitLevel": target_level,
            },
        }


def _is_number(value) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def _clean_name(name: str) -> str:
    """Strip short-code prefix and 'Province' suffix from org unit names."""
    cleaned = re.sub(r"^[a-z]{1,3}\s+", "", name)
    return re.sub(r"\s+Province$", "", cleaned, flags=re.IGNORECASE).strip()


_FR_MONTHS = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
]


def _period_label(period_code: str) -> str:
    """Convert a DHIS2 period code to a human-readable French label.

    YYYYMM → 'Avril 2026', YYYY → 'Année 2026'.
    """
    code = str(period_code)
    if re.match(r"^\d{6}$", code):
        year = code[:4]
        month = int(code[4:6])
        if 1 <= month <= 12:
            return f"{_FR_MONTHS[month - 1]} {year}"
        return code
    if re.match(r"^\d{4}$", code):
        return f"Année {code}"
    return code
