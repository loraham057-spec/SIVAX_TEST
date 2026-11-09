"""
Clarification engine — deterministic slot completeness and ambiguity detection.

Symmetric to conversation_context.py (the context resolver): this module makes
the "should we ask a question?" decision deterministic, traceable, and
structured, instead of relying solely on an LLM confidence score.

Flow:
    1. Entities are extracted (LLM + deterministic) and the conversation
       context resolver fills inherited slots FIRST — a follow-up must never
       re-trigger a clarification for slots already known.
    2. assess_completeness() checks required/optional slots for the detected
       QID or analytical intent.
    3. detect_ambiguities() finds genuinely ambiguous references (partial
       province names, unspecified count vs proportion, penta without dose).
    4. decide() applies the policy:
         - PROCEED               all required slots filled, nothing ambiguous
         - PROCEED_WITH_DEFAULTS optional slots missing → safe defaults, with
                                 explicit assumptions surfaced to the user
         - CLARIFY               a required slot is missing or ambiguous →
                                 ONE structured question with concrete options

The LLM is only used (in decision_assistant.clarification) to phrase the
question in natural French from the structured skeleton built here.
"""

from __future__ import annotations

import re
from typing import Any

from app.tools.question_catalog import (
    QUESTION_CATALOG,
    normalize_text,
)


# ─── Slot requirements ─────────────────────────────────────

# Slots every analytical request must have (directly or via defaults).
# "indicator" is the only hard-required slot with no safe default.
DEFAULTS: dict[str, Any] = {
    "period": "LAST_12_MONTHS",
    "geography": "national",
    "geographic_level": "province",
}

# Priority order when several slots need clarification — ask ONE question
# about the most blocking slot only.
SLOT_PRIORITY = [
    "indicator",
    "metric",
    "measurement_type",
    "antigen_dose",
    "geography",
    "period",
    "threshold",
]

# Partial geography names that match several DRC provinces.
AMBIGUOUS_GEOGRAPHIES: dict[str, list[str]] = {
    "kasai": ["Kasaï", "Kasaï-Central", "Kasaï-Oriental"],
    "kivu": ["Nord-Kivu", "Sud-Kivu"],
    "ubangi": ["Nord-Ubangi", "Sud-Ubangi"],
    "uele": ["Bas-Uele", "Haut-Uele"],
    "lomami": ["Lomami", "Haut-Lomami"],
}

# Exact province names that must NOT be flagged as ambiguous even though
# they contain an ambiguous fragment.
UNAMBIGUOUS_GEOGRAPHY_TERMS = {
    "kasai central", "kasai oriental", "nord kivu", "sud kivu",
    "nord ubangi", "sud ubangi", "bas uele", "haut uele",
    "haut lomami", "lomami",
}

# Terms indicating the user gave a measurement type explicitly.
_COUNT_TERMS = ("nombre", "combien", "effectif")
_PROPORTION_TERMS = ("proportion", "pourcentage", "taux", "%")

# Vague period expressions → safe default instead of clarification.
VAGUE_PERIOD_TERMS = ("recemment", "ces derniers temps", "dernierement", "actuellement")


# ─── Completeness ──────────────────────────────────────────

def assess_completeness(
    entities: dict[str, Any],
    qid: str | None = None,
    business_intent: str | None = None,
) -> dict[str, Any]:
    """Deterministic slot-by-slot completeness check.

    Returns {complete, missing_slots, filled_slots, inferred_defaults, trace}.
    A slot counts as filled if provided by the user OR inherited from the
    conversation context (the resolver runs before this).
    """
    trace: list[dict[str, Any]] = []
    filled: dict[str, Any] = {}
    missing: list[str] = []
    inferred_defaults: dict[str, Any] = {}

    definition = QUESTION_CATALOG.get(qid or "")

    # ── Indicator (hard required, no default) ──
    has_indicator = bool(
        definition
        or entities.get("indicator_keywords")
        or entities.get("metric_id")
        or entities.get("antigens")
        or entities.get("population")
    )
    if has_indicator:
        filled["indicator"] = (
            definition.get("indicator_query") if definition
            else entities.get("indicator_keywords") or entities.get("antigens")
        )
        trace.append({"slot": "indicator", "status": "filled", "value": filled["indicator"]})
    else:
        missing.append("indicator")
        trace.append({"slot": "indicator", "status": "missing"})

    # ── Period (optional → default) ──
    if entities.get("periods") or entities.get("period"):
        filled["period"] = entities.get("periods") or entities.get("period")
        trace.append({"slot": "period", "status": "filled", "value": filled["period"]})
    else:
        inferred_defaults["period"] = DEFAULTS["period"]
        trace.append({"slot": "period", "status": "default", "value": DEFAULTS["period"]})

    # ── Geography (optional → default national) ──
    if entities.get("geography") or entities.get("org_unit_id") or entities.get("geographic_levels"):
        filled["geography"] = (
            entities.get("geography")
            or entities.get("org_unit_id")
            or entities.get("geographic_levels")
        )
        trace.append({"slot": "geography", "status": "filled", "value": filled["geography"]})
    else:
        inferred_defaults["geography"] = DEFAULTS["geography"]
        trace.append({"slot": "geography", "status": "default", "value": DEFAULTS["geography"]})

    # ── Threshold (required only for threshold_proportion QIDs; catalog
    #    provides the standard PEV threshold as default) ──
    intent = (definition or {}).get("intent") or business_intent
    if intent == "threshold_proportion":
        if entities.get("threshold") is not None:
            filled["threshold"] = entities["threshold"]
            trace.append({"slot": "threshold", "status": "filled", "value": entities["threshold"]})
        elif definition and definition.get("threshold") is not None:
            inferred_defaults["threshold"] = definition["threshold"]
            trace.append({"slot": "threshold", "status": "default", "value": definition["threshold"]})
        else:
            missing.append("threshold")
            trace.append({"slot": "threshold", "status": "missing"})

    return {
        "complete": not missing,
        "missing_slots": missing,
        "filled_slots": filled,
        "inferred_defaults": inferred_defaults,
        "trace": trace,
    }


# ─── Ambiguity detection ───────────────────────────────────

_OU_LEVEL_LABELS = {1: "National", 2: "Province", 3: "Zone de Santé", 4: "Aire de Santé", 5: "Formation sanitaire"}


def _org_unit_option_label(candidate: dict[str, Any]) -> str:
    """Human-readable option label: 'll Lualaba Zone de Santé' → 'Lualaba (Zone de Santé)'."""
    name = str(candidate.get("name", candidate.get("id", "")))
    # Drop the 2-letter DHIS2 prefix ("ll ", "tn ", ...)
    cleaned = re.sub(r"^[a-z]{2}\s+", "", name)
    level_label = _OU_LEVEL_LABELS.get(candidate.get("level") or 0)
    for suffix in ("Zone de Santé", "Aire de Santé", "Centre de Santé", "Province"):
        if cleaned.endswith(suffix):
            core = cleaned[: -len(suffix)].strip()
            return f"{core} ({suffix})" if core else cleaned
    return f"{cleaned} ({level_label})" if level_label else cleaned


def detect_ambiguities(message: str, entities: dict[str, Any]) -> list[dict[str, Any]]:
    """Detect genuinely ambiguous references, each with concrete options."""
    normalized = " ".join(normalize_text(message).split())
    ambiguities: list[dict[str, Any]] = []

    # ── Partial geography matching several provinces ──
    for fragment, provinces in AMBIGUOUS_GEOGRAPHIES.items():
        if fragment in normalized and not any(
            term in normalized for term in UNAMBIGUOUS_GEOGRAPHY_TERMS if fragment in term
        ):
            ambiguities.append({
                "slot": "geography",
                "reason": f"'{fragment}' correspond à plusieurs provinces",
                "options": [{"label": name, "value": name} for name in provinces],
            })
            break

    # ── Misspelled / unknown geography (smart resolution) ──
    # When the place name doesn't exactly match any known unit, ask the user
    # to confirm among fuzzy candidates instead of silently guessing.
    # Confirmed answers are learned platform-wide (see alias_learning).
    geography = entities.get("geography")
    if (
        geography
        and not entities.get("org_unit_id")
        and not any(a["slot"] == "geography" for a in ambiguities)
    ):
        resolution = entities.get("_geo_resolution")
        if not isinstance(resolution, dict):
            from app.agents.geo_resolution import resolve_geography_smart
            resolution = resolve_geography_smart(str(geography))
        if resolution.get("status") == "ambiguous" and resolution.get("candidates"):
            options = [
                {
                    "label": _org_unit_option_label(candidate),
                    "value": f"org_unit:{candidate['id']}:{candidate['name']}",
                }
                for candidate in resolution["candidates"]
            ]
            ambiguities.append({
                "slot": "geography",
                "reason": (
                    f"« {resolution.get('alias_original', geography)} » ne correspond "
                    "exactement à aucune unité connue — confirmation nécessaire"
                ),
                "options": options,
                "alias_original": resolution.get("alias_original", str(geography)),
            })
        elif resolution.get("status") == "not_found":
            # Even in not_found, propose close candidates if available (opt 7)
            nf_candidates = resolution.get("candidates") or []
            options = [
                {
                    "label": _org_unit_option_label(candidate),
                    "value": f"org_unit:{candidate['id']}:{candidate['name']}",
                }
                for candidate in nf_candidates
            ]
            # Always add a free-text option so the user can type the correct name
            options.append({
                "label": "Autre (saisie libre)",
                "value": "free_text",
            })
            ambiguities.append({
                "slot": "geography",
                "reason": (
                    f"« {resolution.get('alias_original', geography)} » est introuvable "
                    "parmi les provinces, zones et aires de santé connues. "
                    "Vouliez-vous dire l'une de ces provinces, ou précisez le nom exact."
                ),
                "options": options,
                "alias_original": resolution.get("alias_original", str(geography)),
            })

    # ── Count vs proportion for zero-dose / under-vaccinated ──
    population_terms = ("zero dose", "sous vaccine")
    if any(term in normalized for term in population_terms):
        has_count = any(term in normalized for term in _COUNT_TERMS)
        has_proportion = any(term in normalized for term in _PROPORTION_TERMS)
        if not has_count and not has_proportion:
            ambiguities.append({
                "slot": "measurement_type",
                "reason": "nombre ou proportion non précisé",
                "options": [
                    {"label": "Nombre d'enfants", "value": "count"},
                    {"label": "Proportion (%)", "value": "proportion"},
                ],
            })

    # ── "les cas" without confirmed/suspected ──
    if re.search(r"\bles?\s+cas\b", normalized) and not re.search(
        r"confirm|suspect|presume|presumes", normalized
    ):
        ambiguities.append({
            "slot": "measurement_type",
            "reason": "cas confirmés ou suspects non précisé",
            "options": [
                {"label": "Cas confirmés", "value": "confirmed"},
                {"label": "Cas suspects", "value": "suspected"},
                {"label": "Les deux (total)", "value": "all"},
            ],
        })

    # ── Penta without dose number when coverage is requested ──
    antigens = entities.get("antigens") or []
    if "penta" in antigens and not any(a in antigens for a in ("penta1", "penta3")):
        if re.search(r"couverture|abandon|dose", normalized):
            ambiguities.append({
                "slot": "antigen_dose",
                "reason": "dose Penta non précisée",
                "options": [
                    {"label": "Penta 1", "value": "penta1"},
                    {"label": "Penta 3", "value": "penta3"},
                    {"label": "Les deux", "value": "penta1,penta3"},
                ],
            })

    # ── Misspelled / unknown indicator (smart metric resolution) ──
    # When the user wrote an indicator name that doesn't strongly match a
    # single DHIS2 metric, ask them to confirm among candidates instead of
    # silently picking the wrong one. Confirmed answers are learned
    # platform-wide (see alias_learning).
    indicator_query = (
        entities.get("metric_id")
        or (entities.get("indicator_keywords") and " ".join(entities["indicator_keywords"]))
        or ""
    )
    if indicator_query and not entities.get("metric_id") and not any(
        a["slot"] in ("indicator", "metric") for a in ambiguities
    ):
        resolution = entities.get("_metric_resolution")
        if not isinstance(resolution, dict):
            from app.agents.metric_resolution import resolve_metric_smart
            resolution = resolve_metric_smart(str(indicator_query))
        if resolution.get("status") == "ambiguous" and resolution.get("candidates"):
            options = [
                {
                    "label": candidate.get("name", candidate.get("id", "")),
                    "value": f"metric:{candidate['id']}:{candidate.get('name', candidate['id'])}",
                }
                for candidate in resolution["candidates"]
            ]
            ambiguities.append({
                "slot": "metric",
                "reason": (
                    f"« {resolution.get('alias_original', indicator_query)} » ne correspond "
                    "pas clairement à un seul indicateur — confirmation nécessaire"
                ),
                "options": options,
                "alias_original": resolution.get("alias_original", str(indicator_query)),
            })

    return ambiguities


# ─── Decision policy ───────────────────────────────────────

def decide(
    message: str,
    entities: dict[str, Any],
    qid: str | None = None,
    business_intent: str | None = None,
) -> dict[str, Any]:
    """Apply the clarification policy. Returns a structured decision:

    {
      "action": "PROCEED" | "PROCEED_WITH_DEFAULTS" | "CLARIFY",
      "completeness": {...},
      "ambiguities": [...],
      "assumptions": {...},          # defaults applied (surfaced to user)
      "clarification_request": {...} # only when action == CLARIFY
    }
    """
    completeness = assess_completeness(entities, qid, business_intent)
    ambiguities = detect_ambiguities(message, entities)

    # A follow-up that inherited its slots from context must not clarify:
    # inherited values are already in `entities` at this point.
    blocking: list[dict[str, Any]] = []
    for slot in completeness["missing_slots"]:
        blocking.append({"slot": slot, "reason": "information requise manquante", "options": []})
    blocking.extend(ambiguities)

    if blocking:
        blocking.sort(
            key=lambda item: SLOT_PRIORITY.index(item["slot"])
            if item["slot"] in SLOT_PRIORITY else len(SLOT_PRIORITY)
        )
        chosen = blocking[0]
        return {
            "action": "CLARIFY",
            "completeness": completeness,
            "ambiguities": ambiguities,
            "assumptions": {},
            "clarification_request": build_clarification_request(
                chosen, completeness, entities, qid
            ),
        }

    if completeness["inferred_defaults"]:
        return {
            "action": "PROCEED_WITH_DEFAULTS",
            "completeness": completeness,
            "ambiguities": [],
            "assumptions": completeness["inferred_defaults"],
            "clarification_request": None,
        }

    return {
        "action": "PROCEED",
        "completeness": completeness,
        "ambiguities": [],
        "assumptions": {},
        "clarification_request": None,
    }


# ─── Structured clarification request ──────────────────────

_SLOT_QUESTIONS = {
    "indicator": "Quel indicateur souhaitez-vous analyser ?",
    "metric": "Quelle métrique souhaitez-vous analyser ?",
    "measurement_type": "Souhaitez-vous un nombre ou une proportion ?",
    "antigen_dose": "Quelle dose de Penta souhaitez-vous analyser ?",
    "geography": "Quelle zone géographique souhaitez-vous analyser ?",
    "period": "Sur quelle période souhaitez-vous l'analyse ?",
    "threshold": "Quel seuil souhaitez-vous appliquer ?",
}

_INDICATOR_SUGGESTIONS = [
    {"label": "Couverture Penta3", "value": "couverture penta3"},
    {"label": "Abandon Penta1-Penta3", "value": "taux d'abandon penta1 penta3"},
    {"label": "Enfants zéro dose", "value": "enfants zéro dose"},
    {"label": "Taux de perte des vaccins", "value": "taux de perte des vaccins"},
]


def build_clarification_request(
    blocking: dict[str, Any],
    completeness: dict[str, Any],
    entities: dict[str, Any],
    qid: str | None,
) -> dict[str, Any]:
    """Build the structured skeleton for the clarification question."""
    slot = blocking["slot"]
    options = blocking.get("options") or []
    if slot == "indicator" and not options:
        options = _INDICATOR_SUGGESTIONS

    filled = completeness["filled_slots"]
    understood_parts = []
    if filled.get("indicator"):
        value = filled["indicator"]
        understood_parts.append(
            f"Indicateur : {', '.join(value) if isinstance(value, list) else value}"
        )
    if filled.get("geography"):
        value = filled["geography"]
        understood_parts.append(
            f"Géographie : {', '.join(value) if isinstance(value, list) else value}"
        )
    if filled.get("period"):
        value = filled["period"]
        understood_parts.append(
            f"Période : {', '.join(map(str, value)) if isinstance(value, list) else value}"
        )

    return {
        "slot": slot,
        "reason": blocking.get("reason", ""),
        "alias_original": blocking.get("alias_original", ""),
        "question": _SLOT_QUESTIONS.get(slot, "Pouvez-vous préciser votre demande ?"),
        "options": options,
        "defaults_available": completeness["inferred_defaults"],
        "partial_understanding": " · ".join(understood_parts),
        "partial_entities": {
            key: value for key, value in (entities or {}).items()
            if not key.startswith("_") and value not in (None, [], "")
        },
        "qid": qid,
        "resolution_trace": completeness["trace"],
    }


# ─── Answering a pending clarification ─────────────────────

def apply_clarification_answer(
    message: str,
    pending: dict[str, Any],
) -> dict[str, Any]:
    """Interpret the user's reply as an answer to a pending clarification.

    Matches the reply against the proposed options (label or value),
    merges with the partial entities saved when the question was asked.

    Returns {matched: bool, slot, value, entities}.
    """
    normalized = " ".join(normalize_text(message).split())
    slot = pending.get("slot")
    partial = dict(pending.get("partial_entities") or {})

    # Prefer the LONGEST match so a reply like "Kasaï-Central" is matched
    # against the "Kasaï-Central" option, not the shorter "Kasaï" option.
    matched_value = None
    best_length = 0
    for option in pending.get("options") or []:
        # "free_text" is a special catch-all option — always match it so
        # the user's typed reply is used as the geography/value.
        if option.get("value") == "free_text":
            matched_value = "free_text"
            continue
        label_norm = " ".join(normalize_text(str(option.get("label", ""))).split())
        value_norm = " ".join(normalize_text(str(option.get("value", ""))).split())
        for candidate in (label_norm, value_norm):
            if candidate and candidate in normalized and len(candidate) > best_length:
                matched_value = option.get("value")
                best_length = len(candidate)
    # Short replies like "les deux" / "1" / "penta 3" — try loose matching
    if matched_value is None and len(normalized.split()) <= 4:
        for option in pending.get("options") or []:
            tokens = " ".join(normalize_text(str(option.get("label", ""))).split()).split()
            if tokens and all(token in normalized for token in tokens if len(token) > 2):
                matched_value = option.get("value")
                break

    # ── Fuzzy similarity fallback (opt 5) ──
    # If exact/loose matching failed, try fuzzy similarity against each
    # option label. This handles free-text replies like "Lualaba" matching
    # the option "Lualaba (Province)" where the token "province" prevented
    # the strict loose matcher from succeeding.
    if matched_value is None and normalized:
        from app.agents.fuzzy_matching import fuzzy_similarity
        best_score = 0.0
        for option in pending.get("options") or []:
            label_norm = " ".join(normalize_text(str(option.get("label", ""))).split())
            # Strip the parenthetical suffix for comparison:
            # "Lualaba (Province)" → "lualaba"
            label_core = re.sub(r"\s*\([^)]*\)\s*", "", label_norm).strip()
            for candidate in (label_core, label_norm):
                score = fuzzy_similarity(normalized, candidate)
                if score > best_score:
                    best_score = score
                    matched_value = option.get("value")
        # Only accept if the fuzzy score is high enough
        if best_score < 0.60:
            matched_value = None

    if matched_value is None:
        return {"matched": False, "slot": slot, "value": None, "entities": partial}

    # Merge the answered slot into the partial entities
    if slot == "measurement_type":
        partial["measurement_type"] = matched_value
    elif slot == "antigen_dose":
        partial["antigens"] = [a.strip() for a in str(matched_value).split(",")]
    elif slot == "geography":
        value_str = str(matched_value)
        if value_str == "free_text":
            # User chose "Other (free text)" — use their typed reply as the
            # geography. The planner will re-resolve it (possibly triggering
            # another clarification if still ambiguous).
            partial["geography"] = normalized
        elif value_str.startswith("org_unit:"):
            # Structured option "org_unit:<id>:<name>" from the smart geo
            # resolver — inject the exact org unit so the planner doesn't
            # re-resolve (and possibly re-mismatch) the name.
            _, ou_id, ou_name = value_str.split(":", 2)
            partial["org_unit_id"] = ou_id
            partial["org_unit_name"] = ou_name
            partial["geography"] = ou_name
        else:
            partial["geography"] = matched_value
    elif slot == "metric":
        value_str = str(matched_value)
        if value_str.startswith("metric:"):
            _, metric_id, metric_name = value_str.split(":", 2)
            partial["metric_id"] = metric_id
            partial["metric_name"] = metric_name
        else:
            partial["indicator_keywords"] = [matched_value]
    elif slot == "indicator":
        partial["indicator_keywords"] = [matched_value]
    elif slot == "period":
        partial["period"] = matched_value
    elif slot == "threshold":
        try:
            partial["threshold"] = float(str(matched_value).replace(",", "."))
        except ValueError:
            pass

    return {"matched": True, "slot": slot, "value": matched_value, "entities": partial}


# ─── Suggested follow-ups (proactive deepening) ────────────

_DEPTH_FOLLOWUPS = {
    "situation": [
        {"label": "Décomposer par province", "message": "par province"},
        {"label": "Voir l'évolution sur 12 mois", "message": "montre l'évolution sur les 12 derniers mois"},
        {"label": "Diagnostic des unités sous le seuil", "message": "pourquoi certaines zones sont sous le seuil ?"},
    ],
    "diagnosis": [
        {"label": "Zones les plus à risque", "message": "quelles sont les zones les plus à risque ?"},
        {"label": "Comparer avec la période précédente", "message": "compare avec la période précédente"},
    ],
    "risk": [
        {"label": "Actions recommandées", "message": "que faire en priorité ?"},
    ],
    "action": [],
}


def suggest_followups(
    qid: str | None,
    entities: dict[str, Any],
    business_intent: str | None = None,
) -> list[dict[str, str]]:
    """Deterministic follow-up suggestions based on QID and analysis depth."""
    depth = entities.get("analysis_depth") or "situation"
    # Defensive: LLMs sometimes return analysis_depth as a list (e.g.
    # ["diagnosis"]) instead of a string. A list is unhashable and would
    # crash _DEPTH_FOLLOWUPS.get(depth) with "unhashable type: 'list'".
    if isinstance(depth, list):
        depth = depth[0] if depth else "situation"
    if not isinstance(depth, str) or depth not in _DEPTH_FOLLOWUPS:
        depth = "situation"
    suggestions = list(_DEPTH_FOLLOWUPS.get(depth, []))

    definition = QUESTION_CATALOG.get(qid or "")
    if definition:
        remaining_steps = [
            step for step in definition.get("steps", [])
            if step not in ("situation", depth)
        ]
        if "ranking" in remaining_steps and not any(
            "province" in s["message"] for s in suggestions
        ):
            suggestions.append({
                "label": "Classement des zones",
                "message": "quelles sont les zones les plus faibles ?",
            })
        if "trend" in remaining_steps and not any(
            "évolution" in s["message"] for s in suggestions
        ):
            suggestions.append({
                "label": "Tendance",
                "message": "montre la tendance sur 12 mois",
            })

    breakdown = entities.get("breakdown")
    if breakdown == "province":
        suggestions.insert(0, {
            "label": "Détailler par zone de santé",
            "message": "par zone de santé",
        })

    # Dedupe by message, cap at 3
    seen: set[str] = set()
    unique = []
    for suggestion in suggestions:
        if suggestion["message"] not in seen:
            seen.add(suggestion["message"])
            unique.append(suggestion)
    return unique[:3]
