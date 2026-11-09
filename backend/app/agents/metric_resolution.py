"""
Indicator/metric resolution — from a user-written indicator name to a DHIS2
metric ID, with misspelling tolerance and platform-wide learning.

Symmetric to geo_resolution.resolve_geography_smart:
    1. Learned aliases (agent_learned_aliases, 'metric' type) → resolved
    2. Dominant business synonym (semantic layer)              → resolved
    3. Exact / strong token match in dim_indicators             → resolved
    4. Fuzzy candidates                                         → ambiguous
    5. Nothing                                                  → not_found

Confirmed clarification answers are recorded via alias_learning so the whole
platform improves over time.
"""

from __future__ import annotations

import re
from typing import Any

from app.agents.alias_learning import get_learned_alias, get_proposed_alias
from app.tools.supabase_data import search_indicators


# A synonym match is trusted only when it beats the runner-up by this factor:
# "abandon penta1 penta3" scores 20 for the dropout indicator against 6 for
# each coverage indicator, whereas a bare "pentavalent 3" ties nothing and
# falls through to the token search unchanged.
SYNONYM_DOMINANCE_RATIO = 2.0


def _resolve_by_synonyms(query: str) -> dict[str, Any] | None:
    from app.tools.semantic_layer import SemanticLayer

    matches = SemanticLayer().resolve_indicator(query).get("matches") or []
    if not matches:
        return None
    best = matches[0]
    runner_up = matches[1]["score"] if len(matches) > 1 else 0
    if runner_up and best["score"] < runner_up * SYNONYM_DOMINANCE_RATIO:
        return None
    return {
        "status": "resolved", "source": "semantic_synonym",
        "metric_id": best["indicator_id"], "metric_name": best["name"],
    }


def resolve_metric_smart(query: str) -> dict[str, Any]:
    """Statused metric resolution used before planning.

    Returns:
        {
          "status": "resolved" | "ambiguous" | "not_found",
          "metric_id" / "metric_name": set when status == "resolved",
          "source": "learned" | "indicator_exact",
          "candidates": [{"id","name","score","source"}],  # ambiguous
          "alias_original": the user's original spelling,
        }
    """
    original = (query or "").strip()
    if not original:
        return {"status": "not_found", "candidates": [], "alias_original": original}

    # 0. Auto-correction defaults (from evaluation runs)
    try:
        from app.eval.auto_correct import load_metric_defaults
        norm_lower = original.lower()
        for default in load_metric_defaults():
            if norm_lower == default.get("query", "").lower():
                return {
                    "status": "resolved", "source": "eval_default",
                    "metric_id": default["metric_id"],
                    "metric_name": default["metric_name"],
                    "alias_original": original,
                }
    except Exception:
        pass  # corrections store not available

    # 1. Learned aliases — trusted (≥2 confirmations) → resolved silently
    learned = get_learned_alias("metric", original)
    if learned:
        return {
            "status": "resolved", "source": "learned",
            "metric_id": learned["target_id"],
            "metric_name": learned["target_name"],
            "alias_original": original,
        }

    # 1b. Learned aliases — proposed (1 confirmation) → pre-select
    proposed = get_proposed_alias("metric", original)

    # 2. Business synonyms from the semantic layer → resolved when one
    #    indicator clearly dominates. Label-token matching alone cannot tell
    #    "taux d'abandon pentavalent 1 et pentavalent 3" (one dropout
    #    indicator) from two coverage indicators, because the dropout label
    #    spells the antigen "DTC-HepB-Hib". The synonyms encode exactly that
    #    business vocabulary, so they take precedence over token overlap.
    semantic = _resolve_by_synonyms(original)
    if semantic:
        return {**semantic, "alias_original": original}

    # 3/4. Scored indicator candidates
    candidates = search_indicators(original, limit=5)
    if proposed:
        candidates.insert(0, {
            "id": proposed["target_id"],
            "name": proposed["target_name"],
            "score": 1.0,
            "source": "learned_proposed",
        })
    if not candidates:
        return {"status": "not_found", "candidates": [], "alias_original": original}

    top = candidates[0]
    runner_up = candidates[1]["score"] if len(candidates) > 1 else 0.0
    # Strong, unambiguous match → resolved silently
    # Use rounding to avoid floating-point precision issues (1.0 - 0.8 = 0.1999...)
    if top.get("score", 0) >= 0.8 and round(top["score"] - runner_up, 3) >= 0.2:
        return {
            "status": "resolved", "source": "indicator_exact",
            "metric_id": top["id"], "metric_name": top["name"],
            "alias_original": original,
        }

    # Domain default: when "couverture X" is mentioned without a dose number
    # and multiple dose-specific indicators tie for the top score, default
    # to dose 1 (the first vaccine dose). This is the standard PEV convention.
    query_lower = original.lower()
    if "couverture" in query_lower or "taux" in query_lower:
        tied = [c for c in candidates if c.get("score", 0) >= top.get("score", 0) - 0.01]
        dose1 = next(
            (c for c in tied
             if re.search(r"\b1\b|[ -]1\b|pentavalent 1|dose 1", c.get("name", "").lower())
             and "rupture" not in c.get("name", "").lower()
             and "abandon" not in c.get("name", "").lower()),
            None,
        )
        if dose1 and len(tied) >= 2:
            return {
                "status": "resolved", "source": "indicator_default_dose1",
                "metric_id": dose1["id"], "metric_name": dose1["name"],
                "alias_original": original,
            }

    return {
        "status": "ambiguous",
        "candidates": [{**c, "source": "indicator_search"} for c in candidates],
        "alias_original": original,
    }
