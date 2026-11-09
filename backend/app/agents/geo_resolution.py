"""
Geography resolution — from a user-written place name to a DHIS2 org unit.

Two entry points:
    resolve_org_unit(geography)          — legacy best-effort resolution
                                           (always returns something; used by
                                           the planner as a last resort).
    resolve_geography_smart(geography)   — statused resolution used BEFORE the
                                           planner, so uncertain spellings
                                           trigger a clarification instead of
                                           a silent (possibly wrong) guess.

Smart resolution ladder:
    1. Curated aliases (PROVINCE_MAP)            → resolved
    2. Learned aliases (agent_learned_aliases,
       confirmed by users in past clarifications) → resolved
    3. Exact org unit name match                  → resolved
    4. Fuzzy candidates (provinces + org units)   → ambiguous (ask the user)
    5. Nothing                                    → not_found

Confirmed clarification answers are recorded via alias_learning so the whole
platform improves over time (see alias_learning.record_alias_confirmation).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.agents.alias_learning import get_learned_alias, get_proposed_alias
from app.agents.fuzzy_matching import fuzzy_similarity, strip_accents as _strip_accents_fuzzy
from app.tools.supabase_data import find_org_unit, find_org_unit_candidates


# ─── Province mapping (DRC, 26 provinces) ─────────────────
# Maps province names (and common variants) to DHIS2 org unit IDs.
# This allows the planner to correctly set orgUnitId when the user
# mentions a province by name, instead of defaulting to national level.
PROVINCE_MAP: dict[str, str] = {
    # Kinshasa
    "kinshasa": "TwSa8zUu09Q",
    # Kongo Central
    "kongo central": "dKdrd8HqZWz",
    "kongo": "dKdrd8HqZWz",
    # Kwango
    "kwango": "PvtAI4RUMkr",
    # Kwilu
    "kwilu": "BmKjwqc6BEw",
    # Maindombe
    "maindombe": "u0vP3ZicczY",
    "maïndombe": "u0vP3ZicczY",
    "mai ndombe": "u0vP3ZicczY",
    "maï ndombe": "u0vP3ZicczY",
    # Equateur
    "equateur": "XjeRGfqHMrl",
    "équateur": "XjeRGfqHMrl",
    # Mongala
    "mongala": "krWZMdwGDIf",
    # Sud Ubangi
    "sud ubangi": "JkIljbLc4Ny",
    # Nord Ubangi
    "nord ubangi": "iu4Zj3Zq39m",
    # Bas Uele
    "bas uele": "rWrCdr321Qu",
    "bas uélé": "rWrCdr321Qu",
    # Haut Uele
    "haut uele": "wy1lwIP18SL",
    "haut uélé": "wy1lwIP18SL",
    # Ituri
    "ituri": "Q4cbnIAo10f",
    # Haut Lomami
    "haut lomami": "fEKDiQIuqeE",
    # Lualaba (variantes orthographiques courantes : Lwalaba, Luwalaba)
    "lualaba": "dJ3v8xc6ZIK",
    "lwalaba": "dJ3v8xc6ZIK",
    "luwalaba": "dJ3v8xc6ZIK",
    # Haut Katanga
    "haut katanga": "F9w3VW1cQmb",
    "katanga": "F9w3VW1cQmb",
    # Tanganyika
    "tanganyika": "hyvduSNKvfe",
    # Lomami
    "lomami": "an1cK6GbbVw",
    # Sankuru
    "sankuru": "ybgmW3kIGuq",
    # Kasai
    "kasai": "D15NtionqkH",
    "kasaï": "D15NtionqkH",
    # Kasai Central
    "kasai central": "I8CuQpdBQfP",
    "kasaï central": "I8CuQpdBQfP",
    # Kasai Oriental
    "kasai oriental": "fgHCmGhaP2X",
    "kasaï oriental": "fgHCmGhaP2X",
    # Maniema
    "maniema": "uyuwe6bqphf",
    # Sud Kivu
    "sud kivu": "GnLX8MNgxZw",
    # Nord Kivu
    "nord kivu": "pIAYIpy4hiH",
    "kivu": "pIAYIpy4hiH",
    # Tshopo
    "tshopo": "mnOXJ2Oa5U7",
    # Tshuapa
    "tshuapa": "ym2K6YcSNl9",
}

# National root
NATIONAL_OU = "ymGeqzoPhN3"
NATIONAL_NAME = "République Démocratique du Congo"

# National-level aliases — must be checked BEFORE province matching so
# "République démocratique du Congo" doesn't fuzzy-match to "Province du Kongo".
NATIONAL_ALIASES = {
    "rdc", "drc", "congo", "république démocratique du congo",
    "republique democratique du congo",
    "république democratique du congo",
    "republique démocratique du congo",
    "république démocratique", "republique democratique",
    "démocratique", "democratique",
}

GENERIC_SCOPES = {
    "province", "provinces", "zs", "as", "zone de santé", "zones de santé",
    "zone de sante", "zones de sante", "national", "pays",
    "tout le pays", "ensemble du pays",
}


def _strip_accents(text: str) -> str:
    return _strip_accents_fuzzy(text)


def _fuzzy_province_match(norm: str) -> tuple[str, str] | None:
    """Fuzzy-match a geography string against province names.

    Uses combined character/bigram/phonetic similarity to handle common
    DRC misspellings (e.g. "Lwalaba" → "Lualaba", "Ekuateur" → "Equateur",
    "Cuapa" → "Tshuapa"). Returns (ou_id, name) or None.
    """
    norm_ascii = _strip_accents(norm)
    # If the user explicitly targets a facility-level unit, don't remap the
    # name to a province — the local unit is likely intended.
    if re.search(r"\b(aire|centre)s?\b", norm_ascii):
        return None
    # Don't fuzzy-match national-level references to provinces
    # (e.g. "Congo" → "Kongo Central" is a false positive).
    if norm_ascii in {_strip_accents(a) for a in NATIONAL_ALIASES}:
        return None
    province_keys = list({_strip_accents(k) for k in PROVINCE_MAP})
    tokens = [norm_ascii] + [t for t in re.split(r"[\s'\-,]+", norm_ascii) if len(t) >= 4]
    best_score = 0.0
    best_key = None
    for token in tokens:
        for prov_key in province_keys:
            score = fuzzy_similarity(token, prov_key)
            if score > best_score:
                best_score = score
                best_key = prov_key
    if best_key and best_score >= 0.72:
        # Map back from ascii-stripped key to original PROVINCE_MAP key
        for orig_key, ou_id in PROVINCE_MAP.items():
            if _strip_accents(orig_key) == best_key:
                return ou_id, orig_key.title()
    return None


def _canonical_spacing(norm: str) -> str:
    """Official DRC spellings hyphenate compound names (Bas-Uele, Haut-Katanga,
    Sud-Kivu, Kasaï-Central) while PROVINCE_MAP keys use spaces. Treat the two
    as the same word separator so neither spelling falls through to fuzzy
    matching and a needless clarification."""
    return re.sub(r"\s+", " ", re.sub(r"[-_/]", " ", norm)).strip()


def _exact_province_match(norm: str) -> tuple[str, str] | None:
    # If the user explicitly targets a facility-level unit, don't remap the
    # name to a province — the local unit is likely intended (e.g. "Aire de
    # Santé Lualaba" should NOT resolve to Lualaba Province).
    if re.search(r"\b(aire|centre)s?\b", _strip_accents(norm)):
        return None
    norm = _canonical_spacing(norm)
    if norm in PROVINCE_MAP:
        return PROVINCE_MAP[norm], norm.title()
    for name, ou_id in PROVINCE_MAP.items():
        if name in norm or norm in name:
            return ou_id, name.title()
    return None


def resolve_org_unit(geography: str | None) -> tuple[str, str]:
    """Resolve a geography string to (orgUnitId, orgUnitName). Best-effort.

    Returns (NATIONAL_OU, "République Démocratique du Congo") if not found.
    """
    if not geography:
        return NATIONAL_OU, NATIONAL_NAME
    norm = geography.strip().lower()
    # National-level aliases
    norm_ascii = _strip_accents(norm)
    if norm_ascii in {_strip_accents(a) for a in NATIONAL_ALIASES}:
        return NATIONAL_OU, NATIONAL_NAME
    exact = _exact_province_match(norm)
    if exact:
        return exact
    learned = get_learned_alias("geo", norm)
    if learned:
        return learned["target_id"], learned["target_name"]
    # Try fuzzy match against province names (misspellings, phonetic variants)
    fuzzy = _fuzzy_province_match(norm)
    if fuzzy:
        return fuzzy
    if norm not in GENERIC_SCOPES:
        dynamic_unit = find_org_unit(geography.strip())
        if dynamic_unit:
            return dynamic_unit["id"], dynamic_unit["name"]
    return NATIONAL_OU, NATIONAL_NAME


def resolve_geography_smart(geography: str | None) -> dict[str, Any]:
    """Statused geography resolution used before planning.

    Returns:
        {
          "status": "generic" | "resolved" | "ambiguous" | "not_found",
          "org_unit_id" / "org_unit_name": set when status == "resolved",
          "source": "province_map" | "learned" | "org_unit_exact",
          "candidates": [{"id","name","level","score","source"}],  # ambiguous
          "alias_original": the user's original spelling,
        }
    """
    if not geography:
        return {"status": "generic", "alias_original": ""}
    original = geography.strip()
    if not original:
        return {"status": "generic", "alias_original": ""}
    norm = original.lower()
    if norm in GENERIC_SCOPES:
        return {"status": "generic", "alias_original": original}

    # 0. National-level aliases → resolved silently (before province matching
    #    so "Congo" doesn't fuzzy-match to "Kongo Central" province).
    norm_ascii = _strip_accents(norm)
    if norm_ascii in {_strip_accents(a) for a in NATIONAL_ALIASES}:
        return {
            "status": "resolved", "source": "national",
            "org_unit_id": NATIONAL_OU, "org_unit_name": NATIONAL_NAME,
            "alias_original": original,
        }

    # 0b. Auto-correction geo aliases (from evaluation runs)
    try:
        from app.eval.auto_correct import load_geo_aliases
        for alias in load_geo_aliases():
            if norm_ascii == _strip_accents(alias.get("alias", "")):
                return {
                    "status": "resolved", "source": "eval_alias",
                    "org_unit_id": alias["org_unit_id"],
                    "org_unit_name": alias["org_unit_name"],
                    "alias_original": original,
                }
    except Exception:
        pass  # corrections store not available

    # 1. Curated province names / aliases → resolved silently
    exact = _exact_province_match(norm)
    if exact:
        return {
            "status": "resolved", "source": "province_map",
            "org_unit_id": exact[0], "org_unit_name": exact[1],
            "alias_original": original,
        }

    # 2. Learned aliases — trusted (≥2 confirmations) → resolved silently
    learned = get_learned_alias("geo", norm)
    if learned:
        return {
            "status": "resolved", "source": "learned",
            "org_unit_id": learned["target_id"],
            "org_unit_name": learned["target_name"],
            "alias_original": original,
        }

    # 2b. Learned aliases — proposed (1 confirmation) → still ask, but
    #     pre-select the learned target as the top candidate.
    proposed = get_proposed_alias("geo", norm)

    # 3/4. Scored org unit candidates (exact core name → resolved;
    #      fuzzy or several close names → ask the user)
    candidates = [
        {**c, "source": "org_unit"} for c in find_org_unit_candidates(original)
    ]
    # If a proposed alias exists, inject it as the top candidate (marked
    # so the clarification UI can pre-select it).
    if proposed:
        candidates.insert(0, {
            "id": proposed["target_id"],
            "name": proposed["target_name"],
            "level": proposed.get("target_level"),
            "score": 1.0,
            "source": "learned_proposed",
        })
    fuzzy_prov = _fuzzy_province_match(norm)
    if fuzzy_prov and not any(c["id"] == fuzzy_prov[0] for c in candidates):
        candidates.insert(0, {
            "id": fuzzy_prov[0], "name": f"Province du {fuzzy_prov[1]}",
            "level": 2, "score": 0.88, "source": "province_fuzzy",
        })
    candidates.sort(key=lambda c: -c["score"])

    if candidates:
        top = candidates[0]
        runner_up = candidates[1]["score"] if len(candidates) > 1 else 0.0
        # Unambiguous exact name match → resolved silently
        if top["score"] >= 0.95 and round(top["score"] - runner_up, 3) >= 0.1:
            return {
                "status": "resolved", "source": "org_unit_exact",
                "org_unit_id": top["id"], "org_unit_name": top["name"],
                "alias_original": original,
            }
        return {
            "status": "ambiguous",
            "candidates": candidates[:4],
            "alias_original": original,
        }

    # Last resort: legacy single-result search (aires de santé, facilities)
    dynamic_unit = find_org_unit(original)
    if dynamic_unit:
        return {
            "status": "ambiguous",
            "candidates": [{
                "id": dynamic_unit["id"], "name": dynamic_unit["name"],
                "level": dynamic_unit.get("level"), "score": 0.7,
                "source": "org_unit_search",
            }],
            "alias_original": original,
        }

    # ── not_found: still propose close province candidates (opt 7) ──
    # Even when nothing matched at the normal threshold (0.72), relax to
    # 0.50 and offer the closest provinces + a free-text option so the
    # user has a starting point instead of a dead end.
    province_keys = list({_strip_accents(k) for k in PROVINCE_MAP})
    norm_ascii = _strip_accents(norm)
    close_provinces = []
    for prov_key in province_keys:
        score = fuzzy_similarity(norm_ascii, prov_key)
        if score >= 0.50:
            # Find the original PROVINCE_MAP entry for this key
            for orig_key, ou_id in PROVINCE_MAP.items():
                if _strip_accents(orig_key) == prov_key:
                    close_provinces.append((ou_id, orig_key, score))
                    break
    close_provinces.sort(key=lambda x: -x[2])
    candidates = [
        {
            "id": ou_id, "name": f"Province du {orig_key.title()}",
            "level": 2, "score": round(score, 3), "source": "province_fuzzy_relaxed",
        }
        for ou_id, orig_key, score in close_provinces[:3]
    ]
    return {
        "status": "not_found",
        "candidates": candidates,
        "alias_original": original,
    }
