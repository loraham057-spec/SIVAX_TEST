"""
Conversation context resolver — handles anaphora and follow-up resolution.

When a user asks a follow-up question like "montre l'évolution de ce nombre"
or "et pour Kinshasa ?", this module resolves the references against the
previous analysis context (indicator, geography, periods) so the planner
can use the SAME parameters instead of searching for a new indicator.

The context is passed explicitly from the frontend (last_analysis_context)
to avoid fragile text parsing of chat history.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from app.tools.question_catalog import MONTH_ALIASES, extract_period_codes


REFERENCE_PATTERNS = [
    r"\b(ce|cet|cette|ces|le meme|la meme|les memes)\s+(nombre|chiffre|total|resultat|donnee|taux|cas|indicateur|valeur|province|zone|periode|tendance)",
    r"\b(ca|cela|ceci|idem|pareil|meme chose)\b",
    r"\b(evolution|tendance|variation)\s+(de|du|des|pour)\b",
    r"\b(compare|comparaison|comparativement)\s+(avec|a|au|cela|ca|precedent)",
    r"\b(et|sinon|maintenant)\s+(pour|en|sur|avec|par)\b",
    r"\b(jusqu a|depuis|a partir de|de\s+\w+\s+a\s+\w+)\b",
    r"\b(par|selon)\s+(province|zone|zs|region|aire|as|antigene|vaccin|mois|trimestre|annee)\b",
    r"\b(decompose|detaille|repartition)\s+(par|selon)\b",
    r"^(et|idem|pareil|meme chose|sinon|maintenant)\b",
    # Analytical follow-ups: "quelles sont les zones a risque ?", "les plus
    # faibles", "classement des zones", "pourquoi certaines zones", etc.
    # These reference the previous analysis implicitly — they must inherit
    # its indicator/geography instead of being treated as standalone CHAT.
    r"\b(quelles sont|quels sont|quelles?|quels?)\s+(les\s+)?(zones?|provinces?|aires?|unites?)\b",
    r"\b(les\s+)?(plus|moins)\s+(a\s+risque|faibles?|fortes?|performantes?|critiques?|touchees?)\b",
    r"\b(classement|ranking|top|palmares?)\s+(des\s+)?(zones?|provinces?|aires?)\b",
    r"\b(pourquoi|comment|qu est ce qui)\s+(certaines?|les|des)\s+(zones?|provinces?|aires?)\b",
    r"\b(zones?|provinces?)\s+(les\s+)?(plus|moins)\s+\w",
]

_COMPILED_PATTERNS = [re.compile(pattern, re.IGNORECASE) for pattern in REFERENCE_PATTERNS]
_BREAKDOWN_LEVELS = {
    "province": ("province", 2),
    "provinces": ("province", 2),
    "zone": ("health_zone", 3),
    "zones": ("health_zone", 3),
    "zs": ("health_zone", 3),
    "region": ("health_zone", 3),
    "aire": ("health_area", 4),
    "aires": ("health_area", 4),
    "as": ("health_area", 4),
}
_INHERITABLE_FIELDS = (
    "measurement_type",
    "population",
    "threshold",
    "comparison_operator",
    "antigens",
    "periodicity",
    "analysis_depth",
)


def _normalize(message: str) -> str:
    text = unicodedata.normalize("NFD", message or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.lower().replace("’", "'").replace("'", " ")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s-]", " ", text)).strip()


def classify_followup(message: str) -> dict[str, Any]:
    normalized = _normalize(message)
    dimensions: set[str] = set()
    if any(pattern.search(normalized) for pattern in _COMPILED_PATTERNS):
        dimensions.add("reference")
    if re.search(r"\b(jusqu a|depuis|a partir de|mois dernier|trimestre dernier|annee derniere)\b", normalized):
        dimensions.add("period")
    if re.search(r"\b(pour|par)\s+(kinshasa|kongo|kivu|katanga|kasai|equateur|tshopo|province|zone|zs|aire|as)\b", normalized):
        dimensions.add("geography")
    if re.search(r"\b(compare|comparaison|versus|vs)\b", normalized):
        dimensions.add("comparison")
    if re.search(r"\b(par|selon)\s+(province|zone|zs|region|aire|as|antigene|vaccin|mois)\b", normalized):
        dimensions.add("breakdown")
    short_continuation = len(normalized.split()) <= 8 and bool(
        re.match(r"^(et|idem|pareil|meme chose|sinon|maintenant|pour|en|avec|par)\b", normalized)
    )
    detected = bool(dimensions) or short_continuation
    confidence = 0.9 if "reference" in dimensions or short_continuation else 0.7 if detected else 0.0
    return {
        "is_followup": detected,
        "confidence": confidence,
        "dimensions": sorted(dimensions),
    }


def is_followup(message: str) -> bool:
    return classify_followup(message)["is_followup"]


def _month_extension(normalized: str, previous_periods: list[str]) -> list[str]:
    if not previous_periods:
        return []
    month_match = next(
        ((name, month) for name, month in MONTH_ALIASES.items() if re.search(rf"\b{name}\b", normalized)),
        None,
    )
    if not month_match:
        return []
    previous = sorted(period for period in previous_periods if re.fullmatch(r"20\d{4}", str(period)))
    if not previous:
        return []
    target_month = month_match[1]
    if "jusqu a" in normalized:
        start_year, start_month = int(previous[0][:4]), int(previous[0][4:])
        target_year = int(previous[-1][:4])
        if target_month < start_month:
            target_year += 1
        start_index = start_year * 12 + start_month - 1
        end_index = target_year * 12 + target_month - 1
    elif "depuis" in normalized or "a partir de" in normalized:
        end_year, end_month = int(previous[-1][:4]), int(previous[-1][4:])
        start_year = end_year if target_month <= end_month else end_year - 1
        start_index = start_year * 12 + target_month - 1
        end_index = end_year * 12 + end_month - 1
    else:
        return []
    return [f"{index // 12}{index % 12 + 1:02d}" for index in range(start_index, end_index + 1)]


def _extract_breakdown(normalized: str) -> tuple[str, int] | None:
    match = re.search(r"\b(?:par|selon)\s+(province|provinces|zone|zones|zs|region|aire|aires|as)\b", normalized)
    return _BREAKDOWN_LEVELS.get(match.group(1)) if match else None


def _extract_geography_override(normalized: str) -> str | None:
    match = re.match(r"^(?:et\s+|maintenant\s+)?(?:pour|dans)\s+(.+)$", normalized)
    if not match:
        return None
    candidate = re.split(r"\s+(?:en\s+20\d{2}|de\s+\w+|jusqu\s+a|par\s+)", match.group(1))[0].strip()
    ignored = {
        "cela", "ca", "ceci", "la meme chose", "la meme periode", "cette province",
        "cette zone", "le pays", "les memes donnees",
    }
    if candidate in ignored or not candidate or candidate.isdigit():
        return None
    return candidate.title()


def _inherit(
    resolved: dict[str, Any],
    field: str,
    value: Any,
    trace: list[dict[str, Any]],
) -> None:
    if resolved.get(field) in (None, "", []):
        resolved[field] = value
        trace.append({"field": field, "source": "previous_analysis", "value": value})


def resolve_context(
    message: str,
    entities: dict[str, Any],
    last_context: dict[str, Any] | None,
) -> tuple[dict[str, Any], str]:
    resolved = dict(entities or {})
    if last_context is None:
        return resolved, ""

    normalized = _normalize(message)
    trace: list[dict[str, Any]] = []
    previous_metric_name = last_context.get("metric_name")
    previous_metric_id = last_context.get("metric_id")
    previous_periods = list(last_context.get("periods") or [])

    if not resolved.get("indicator_keywords") and previous_metric_name:
        resolved["indicator_keywords"] = [previous_metric_name]
        resolved["metric_id"] = previous_metric_id
        trace.append({
            "field": "indicator_keywords",
            "source": "previous_analysis",
            "value": [previous_metric_name],
            "id": previous_metric_id,
        })

    geography_override = _extract_geography_override(normalized) if not resolved.get("geography") else None
    if geography_override:
        resolved["geography"] = geography_override
        resolved.pop("org_unit_id", None)
        trace.append({"field": "geography", "source": "current_message", "value": geography_override})
    elif not resolved.get("geography") and last_context.get("org_unit_id"):
        resolved["geography"] = last_context.get("org_unit_name")
        resolved["org_unit_id"] = last_context.get("org_unit_id")
        trace.append({
            "field": "geography",
            "source": "previous_analysis",
            "value": last_context.get("org_unit_name"),
            "id": last_context.get("org_unit_id"),
        })

    explicit_periods = list(resolved.get("periods") or extract_period_codes(message))
    year_only = re.fullmatch(r"(?:et\s+)?(?:en\s+)?(20\d{2})", normalized)
    comparison_year = re.search(r"\b(?:compare|comparaison|avec|en)\s+(20\d{2})\b", normalized)
    requested_year = year_only.group(1) if year_only else comparison_year.group(1) if comparison_year else None
    if requested_year and not explicit_periods:
        explicit_periods = [f"{requested_year}{month:02d}" for month in range(1, 13)]
    extended_periods = _month_extension(normalized, previous_periods) if not explicit_periods else []
    if explicit_periods:
        resolved["periods"] = explicit_periods
        trace.append({"field": "periods", "source": "current_message", "value": explicit_periods})
    elif extended_periods:
        resolved["periods"] = extended_periods
        trace.append({"field": "periods", "source": "extended_previous_period", "value": extended_periods})
    elif not resolved.get("period") and previous_periods:
        resolved["periods"] = previous_periods
        trace.append({"field": "periods", "source": "previous_analysis", "value": previous_periods})

    breakdown = _extract_breakdown(normalized)
    if breakdown:
        level, target_level = breakdown
        resolved["breakdown"] = level
        resolved["geographic_levels"] = [level]
        resolved["target_org_unit_level"] = target_level
        if level == "province":
            resolved["geography"] = "national"
            resolved["org_unit_id"] = None
        trace.append({
            "field": "breakdown",
            "source": "current_message",
            "value": level,
            "target_org_unit_level": target_level,
        })
    else:
        _inherit(resolved, "breakdown", last_context.get("breakdown"), trace)
        _inherit(resolved, "geographic_levels", last_context.get("geographic_levels"), trace)
        _inherit(resolved, "target_org_unit_level", last_context.get("target_org_unit_level"), trace)

    for field in _INHERITABLE_FIELDS:
        _inherit(resolved, field, last_context.get(field), trace)

    if re.search(r"\b(compare|comparaison|versus|vs)\b", normalized):
        resolved["comparison_mode"] = "previous_analysis"
        resolved["comparison_baseline"] = {
            "metric_id": previous_metric_id,
            "metric_name": previous_metric_name,
            "org_unit_id": last_context.get("org_unit_id"),
            "org_unit_name": last_context.get("org_unit_name"),
            "periods": previous_periods,
            "total": last_context.get("total"),
        }
        trace.append({"field": "comparison_mode", "source": "current_message", "value": "previous_analysis"})

    resolved["context_resolution"] = {
        "version": "2.0",
        "followup": classify_followup(message),
        "trace": trace,
    }
    summary = "\n".join(
        f"- {item['field']}: {item.get('value')} ({item['source']})"
        for item in trace
    )
    return resolved, summary
