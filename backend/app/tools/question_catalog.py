from __future__ import annotations

import re
import unicodedata
from typing import Any


ANALYTICAL_INTENTS = {
    "metric_value",
    "threshold_proportion",
    "comparison",
    "ranking",
    "trend",
    "diagnosis",
    "risk_alert",
    "controlled_recommendation",
    "data_quality",
    "population_count",
    "population_proportion",
}

MONTH_ALIASES = {
    "janvier": 1,
    "fevrier": 2,
    "mars": 3,
    "avril": 4,
    "mai": 5,
    "juin": 6,
    "juillet": 7,
    "aout": 8,
    "septembre": 9,
    "octobre": 10,
    "novembre": 11,
    "decembre": 12,
}

ANTIGEN_ALIASES = {
    "bcg": ["bcg", "bgc"],
    "penta": ["penta", "pentavalent", "dtc-hepb-hib", "dtc"],
    "penta1": ["penta1", "penta 1", "pentavalent 1", "dtc1", "dtc 1", "dtc-hepb-hib 1"],
    "penta3": ["penta3", "penta 3", "pentavalent 3", "dtc3", "dtc 3", "dtc-hepb-hib 3"],
    "var": ["var", "rougeole", "antirougeoleux", "anti rougeoleux"],
    "vaa": ["vaa", "fievre jaune"],
    "vpi": ["vpi", "polio injectable"],
    "vpo": ["vpo", "polio oral"],
    "rotasil": ["rotasil", "rotavirus"],
    "pcv13": ["pcv-13", "pcv13", "pneumocoque"],
}

CALCULATION_RULES: dict[str, dict[str, Any]] = {
    "proportion_couverture_penta3_seuil": {
        "numerator": "unités avec couverture Penta3 conforme au seuil",
        "denominator": "unités avec une couverture Penta3 valide",
        "formula": "numerator / denominator * 100",
        "validation_status": "validated",
    },
    "proportion_couverture_rougeole_seuil": {
        "numerator": "unités avec couverture VAR conforme au seuil",
        "denominator": "unités avec une couverture VAR valide",
        "formula": "numerator / denominator * 100",
        "validation_status": "requires_pev_validation",
    },
    "proportion_couverture_penta1_seuil": {
        "numerator": "unités avec couverture Penta1 conforme au seuil",
        "denominator": "unités avec une couverture Penta1 valide",
        "formula": "numerator / denominator * 100",
        "validation_status": "validated",
    },
    "proportion_abandon_penta_seuil": {
        "numerator": "unités avec taux d'abandon Penta1-Penta3 conforme au seuil",
        "denominator": "unités avec un taux d'abandon valide",
        "formula": "numerator / denominator * 100",
        "validation_status": "validated",
    },
    "taux_perte_vaccins": {
        "numerator": "doses perdues",
        "denominator": "doses utilisées",
        "formula": "doses_perdues / doses_utilisees * 100",
        "validation_status": "requires_pev_validation",
    },
    "proportion_sans_rupture_stock": {
        "numerator": "unités sans rupture pendant la période",
        "denominator": "unités avec données de stock valides",
        "formula": "numerator / denominator * 100",
        "validation_status": "requires_pev_validation",
    },
    "proportion_supervision_annuelle": {
        "numerator": "unités ayant reçu au moins une supervision",
        "denominator": "unités attendues avec données valides",
        "formula": "numerator / denominator * 100",
        "validation_status": "requires_program_validation",
    },
    "proportion_disponibilite_vaccins_seuil": {
        "numerator": "unités avec disponibilité conforme au seuil",
        "denominator": "unités avec données de disponibilité valides",
        "formula": "numerator / denominator * 100",
        "validation_status": "requires_pev_validation",
    },
    "nombre_enfants_zero_dose": {
        "numerator": "population cible 0-11 mois moins enfants ayant reçu Penta1",
        "denominator": None,
        "formula": "population_cible - penta1_administre",
        "validation_status": "requires_pev_validation",
    },
    "nombre_enfants_sous_vaccines": {
        "numerator": "population cible 0-11 mois moins enfants ayant reçu Penta3",
        "denominator": None,
        "formula": "population_cible - penta3_administre",
        "validation_status": "requires_pev_validation",
    },
    "proportion_enfants_zero_dose": {
        "numerator": "enfants zéro-dose",
        "denominator": "population cible 0-11 mois",
        "formula": "zero_dose / population_cible * 100",
        "validation_status": "requires_pev_validation",
    },
    "proportion_enfants_sous_vaccines": {
        "numerator": "enfants sous-vaccinés",
        "denominator": "population cible 0-11 mois",
        "formula": "sous_vaccines / population_cible * 100",
        "validation_status": "requires_pev_validation",
    },
    "taux_consommation_vaccins": {
        "numerator": "doses consommées pendant la période",
        "denominator": "doses disponibles et utilisables pendant la période",
        "formula": "doses_consommees / doses_disponibles_utilisables * 100",
        "validation_status": "requires_pev_validation",
    },
    "nombre_enfants_vaccines_penta1": {
        "numerator": "enfants ayant reçu la 1re dose de DTC-HepB-Hib (Penta1)",
        "denominator": None,
        "formula": "somme des enfants vaccinés Penta1 sur la période",
        "validation_status": "validated",
    },
    "nombre_enfants_vaccines_penta3": {
        "numerator": "enfants ayant reçu la 3e dose de DTC-HepB-Hib (Penta3)",
        "denominator": None,
        "formula": "somme des enfants vaccinés Penta3 sur la période",
        "validation_status": "validated",
    },
}

QUESTION_CATALOG: dict[str, dict[str, Any]] = {
    "proportion_couverture_penta3_seuil": {
        "patterns": ["proportion", "couverture penta3", "penta3", "80"],
        "domain": "vaccination_coverage",
        "intent": "threshold_proportion",
        "indicator_query": "taux de couverture vaccinale en Pentavalent 3",
        "indicator_ids": ["v9b9aYsA5PM"],
        "measurement_type": "proportion",
        "operator": "gte",
        "threshold": 80.0,
        "population": "nourrissons",
        "steps": ["situation", "gap", "ranking"],
        "render_type": "ranking_answer",
    },
    "proportion_couverture_rougeole_seuil": {
        "patterns": ["proportion", "rougeole", "anti-rougeoleuse", "90"],
        "domain": "vaccination_coverage",
        "intent": "threshold_proportion",
        "indicator_query": "taux de couverture vaccinale antirougeoleuse VAR",
        "indicator_ids": [],
        "measurement_type": "proportion",
        "operator": "gte",
        "threshold": 90.0,
        "population": "enfants cibles",
        "steps": ["situation", "gap", "ranking"],
        "render_type": "ranking_answer",
    },
    "proportion_couverture_penta1_seuil": {
        "patterns": ["proportion", "couverture penta1", "penta1", "80"],
        "domain": "service_access",
        "intent": "threshold_proportion",
        "indicator_query": "taux de couverture vaccinale en Pentavalent 1",
        "indicator_ids": ["k26tJ22Ncpd"],
        "measurement_type": "proportion",
        "operator": "gte",
        "threshold": 80.0,
        "population": "enfants",
        "steps": ["situation", "gap", "ranking"],
        "render_type": "ranking_answer",
    },
    "proportion_abandon_penta_seuil": {
        "patterns": ["proportion", "abandon", "penta1", "penta3", "10"],
        "domain": "service_continuity",
        "intent": "threshold_proportion",
        "indicator_query": "taux d'abandon Penta1 à Penta3",
        "indicator_ids": ["MULXtL8iom8"],
        "measurement_type": "proportion",
        "operator": "lt",
        "threshold": 10.0,
        "population": "enfants ayant reçu Penta1",
        "steps": ["situation", "gap", "diagnosis", "ranking"],
        "render_type": "diagnostic_answer",
    },
    "taux_perte_vaccins": {
        "patterns": ["taux de perte", "perte", "vaccin"],
        "domain": "vaccine_management",
        "intent": "metric_value",
        "indicator_query": "taux de perte des vaccins",
        "indicator_ids": ["YM7Tmn01ieL"],
        "measurement_type": "rate",
        "steps": ["situation", "gap", "trend"],
        "render_type": "trend_answer",
    },
    "proportion_sans_rupture_stock": {
        "patterns": ["proportion", "rupture de stock", "n ont pas eu", "sans rupture"],
        "domain": "vaccine_supply",
        "intent": "threshold_proportion",
        "indicator_query": "proportion de structures sans rupture de stock de vaccin",
        "indicator_ids": [],
        "measurement_type": "proportion",
        "operator": "eq",
        "threshold": 0.0,
        "steps": ["situation", "gap", "ranking"],
        "render_type": "ranking_answer",
    },
    "proportion_supervision_annuelle": {
        "patterns": ["proportion", "supervision", "visite", "annee"],
        "domain": "supervision",
        "intent": "threshold_proportion",
        "indicator_query": "proportion de structures ayant reçu au moins une visite de supervision",
        "indicator_ids": [],
        "measurement_type": "proportion",
        "operator": "gte",
        "threshold": 1.0,
        "steps": ["situation", "gap", "ranking"],
        "render_type": "ranking_answer",
    },
    "proportion_disponibilite_vaccins_seuil": {
        "patterns": ["proportion", "disponibilite", "vaccin", "80"],
        "domain": "vaccine_supply",
        "intent": "threshold_proportion",
        "indicator_query": "taux de disponibilité des vaccins",
        "indicator_ids": [],
        "measurement_type": "proportion",
        "operator": "gte",
        "threshold": 80.0,
        "steps": ["situation", "gap", "ranking"],
        "render_type": "ranking_answer",
    },
    "nombre_enfants_zero_dose": {
        "patterns": ["nombre", "enfants zero dose", "zero dose"],
        "domain": "vaccination_equity",
        "intent": "population_count",
        "indicator_query": "nombre d'enfants zéro dose",
        "indicator_ids": [],
        "measurement_type": "count",
        "population": "enfants de 0 à 11 mois sans Penta1",
        "steps": ["situation", "ranking", "trend"],
        "render_type": "ranking_answer",
    },
    "nombre_enfants_sous_vaccines": {
        "patterns": ["nombre", "enfants sous vaccines", "sous vaccines"],
        "domain": "service_continuity",
        "intent": "population_count",
        "indicator_query": "nombre d'enfants sous vaccinés",
        "indicator_ids": ["RMHgIqfBG7N"],
        "measurement_type": "count",
        "population": "enfants de 0 à 11 mois sans Penta3",
        "steps": ["situation", "ranking", "trend"],
        "render_type": "ranking_answer",
    },
    "proportion_enfants_zero_dose": {
        "patterns": ["proportion", "enfants zero dose", "zero dose"],
        "domain": "vaccination_equity",
        "intent": "population_proportion",
        "indicator_query": "proportion d'enfants zéro dose",
        "indicator_ids": [],
        "measurement_type": "proportion",
        "population": "enfants de 0 à 11 mois sans Penta1",
        "steps": ["situation", "ranking", "trend"],
        "render_type": "ranking_answer",
    },
    "proportion_enfants_sous_vaccines": {
        "patterns": ["proportion", "enfants sous vaccines", "sous vaccines"],
        "domain": "service_continuity",
        "intent": "population_proportion",
        "indicator_query": "proportion d'enfants sous vaccinés",
        "indicator_ids": [],
        "measurement_type": "proportion",
        "population": "enfants de 0 à 11 mois sans Penta3",
        "steps": ["situation", "ranking", "trend"],
        "render_type": "ranking_answer",
    },
    "taux_consommation_vaccins": {
        "patterns": ["taux de consommation", "consommation", "vaccin"],
        "domain": "vaccine_supply",
        "intent": "metric_value",
        "indicator_query": "taux de consommation des vaccins",
        "indicator_ids": [],
        "measurement_type": "rate",
        "steps": ["situation", "trend", "ranking"],
        "render_type": "trend_answer",
    },
    "nombre_enfants_vaccines_penta1": {
        "patterns": ["enfants vaccines", "dtc 1", "dtc1", "penta1", "penta 1", "pentavalent 1"],
        "domain": "vaccination_coverage",
        "intent": "population_count",
        "indicator_query": "enfants vaccinés DTC-HepB-Hib 1",
        "indicator_ids": ["uNdFg1eymsa"],
        "measurement_type": "count",
        "population": "enfants",
        "steps": ["situation", "trend"],
        "render_type": "trend_answer",
    },
    "nombre_enfants_vaccines_penta3": {
        "patterns": ["enfants vaccines", "dtc 3", "dtc3", "penta3", "penta 3", "pentavalent 3"],
        "domain": "vaccination_coverage",
        "intent": "population_count",
        "indicator_query": "enfants vaccinés DTC-HepB-Hib 3",
        "indicator_ids": ["WWxqaHSeiwd"],
        "measurement_type": "count",
        "population": "enfants",
        "steps": ["situation", "trend"],
        "render_type": "trend_answer",
    },
}


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.lower().replace("’", "'").replace(">/=", ">=").replace("</=", "<=")
    return re.sub(r"[^a-z0-9%<>=\s'-]", " ", text).replace("-", " ")


def classify_business_question(question: str) -> dict[str, Any]:
    normalized = re.sub(r"\s+", " ", normalize_text(question)).strip()
    best_qid = None
    best_score = 0.0
    best_matched = 0
    for qid, definition in QUESTION_CATALOG.items():
        patterns = [normalize_text(term).strip() for term in definition["patterns"]]
        matched = [term for term in patterns if term and term in normalized]
        score = sum(max(len(term.split()), 1) for term in matched) / max(
            sum(max(len(term.split()), 1) for term in patterns), 1
        )
        if score > best_score:
            best_qid = qid
            best_score = score
            best_matched = len(matched)

    if best_qid is None or best_score < 0.25 or best_matched < 2:
        intent = infer_analytical_intent(normalized)
        return {
            "status": "no_match",
            "qid": None,
            "confidence": 0.0,
            "intent": intent,
            "definition": None,
        }

    definition = QUESTION_CATALOG[best_qid]
    resolved_definition = {
        "qid": best_qid,
        **definition,
        "calculation": CALCULATION_RULES[best_qid],
        "resolution_mode": "semantic_uid" if definition.get("indicator_ids") else "controlled_metadata_search",
        "mapping_status": "validated" if definition.get("indicator_ids") else "requires_dhis2_validation",
    }
    return {
        "status": "ready",
        "qid": best_qid,
        "confidence": round(best_score, 3),
        "intent": definition["intent"],
        "definition": resolved_definition,
    }


def infer_analytical_intent(question: str) -> str:
    normalized = normalize_text(question)
    if any(term in normalized for term in ["pourquoi", "cause", "facteur", "explique"]):
        return "diagnosis"
    if any(term in normalized for term in ["risque", "alerte", "prioritaire", "priorite"]):
        return "risk_alert"
    if any(term in normalized for term in ["que faire", "recommand", "action"]):
        return "controlled_recommendation"
    if any(term in normalized for term in ["evolution", "tendance", "depuis", "au fil"]):
        return "trend"
    if any(term in normalized for term in ["compare", "comparaison", "ecart", "difference"]):
        return "comparison"
    if any(term in normalized for term in ["classement", "top", "plus eleve", "plus faible"]):
        return "ranking"
    if any(term in normalized for term in ["completude", "promptitude", "qualite des donnees"]):
        return "data_quality"
    if "proportion" in normalized and re.search(r"(?:>=|>/=|<=|</=|superieur|inferieur|moins de|au moins)", normalized):
        return "threshold_proportion"
    if "proportion" in normalized:
        return "population_proportion"
    if "nombre" in normalized or "combien" in normalized:
        return "population_count"
    return "metric_value"


def extract_period_codes(question: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", normalize_text(question)).strip()
    periods = re.findall(r"\b(20\d{2}(?:0[1-9]|1[0-2]))\b", normalized)
    if periods:
        return list(dict.fromkeys(periods))

    years = [int(year) for year in re.findall(r"\b(20\d{2})\b", normalized)]
    if not years:
        return []
    year = years[-1]
    mentioned_months = [month for name, month in MONTH_ALIASES.items() if re.search(rf"\b{name}\b", normalized)]
    unique_years = sorted(dict.fromkeys(years))
    if len(unique_years) >= 2 and not mentioned_months:
        first_year, last_year = unique_years[0], unique_years[-1]
        is_range = bool(re.search(r"\b20\d{2}\s+(?:a|au|et|jusqu ?a)\s+(?:20\d{2}|.{0,20}20\d{2})|entre\s+20\d{2}|de\s+20\d{2}|depuis\s+20\d{2}|\b20\d{2}\s+20\d{2}\b", normalized))
        if is_range and 0 < last_year - first_year <= 10:
            # Multi-year range (e.g. "de 2022 à 2025") → yearly period codes
            return [str(y) for y in range(first_year, last_year + 1)]
        return [str(y) for y in unique_years]
    if mentioned_months:
        first, last = min(mentioned_months), max(mentioned_months)
        if len(mentioned_months) >= 2 and any(term in normalized for term in [" a ", " jusqu a ", " au "]):
            return [f"{year}{month:02d}" for month in range(first, last + 1)]
        return [f"{year}{month:02d}" for month in mentioned_months]

    quarter = re.search(r"(?:t|trimestre)\s*([1-4])", normalized)
    if quarter:
        start = (int(quarter.group(1)) - 1) * 3 + 1
        return [f"{year}{month:02d}" for month in range(start, start + 3)]
    semester = re.search(r"(?:s|semestre)\s*([1-2])", normalized)
    if semester:
        start = (int(semester.group(1)) - 1) * 6 + 1
        return [f"{year}{month:02d}" for month in range(start, start + 6)]
    if "annee" in normalized or "annuel" in normalized:
        return [f"{year}{month:02d}" for month in range(1, 13)]
    return []


def extract_business_entities(question: str) -> dict[str, Any]:
    normalized = re.sub(r"\s+", " ", normalize_text(question)).strip()
    antigens = [
        antigen
        for antigen, aliases in ANTIGEN_ALIASES.items()
        if any(normalize_text(alias).strip() in normalized for alias in aliases)
    ]
    if "penta" in antigens and any(antigen in antigens for antigen in ("penta1", "penta3")):
        antigens.remove("penta")
    levels = []
    for level, patterns in {
        "health_area": [r"\bas\b", r"aire de sante"],
        "health_zone": [r"\bzs\b", r"zone de sante"],
        "province": [r"province"],
        "national": [r"\bpays\b", r"national"],
    }.items():
        if any(re.search(pattern, normalized) for pattern in patterns):
            levels.append(level)

    threshold_match = re.search(r"(?:>/=|>=|</=|<=|>|<)?\s*(\d+(?:[.,]\d+)?)\s*%", normalized)
    threshold = float(threshold_match.group(1).replace(",", ".")) if threshold_match else None
    operator = None
    if re.search(r">/=|>=|au moins|superieur ou egal", normalized):
        operator = "gte"
    elif re.search(r"</=|<=|au plus|inferieur ou egal", normalized):
        operator = "lte"
    elif re.search(r"moins de|inferieur", normalized):
        operator = "lt"
    elif re.search(r"plus de|superieur", normalized):
        operator = "gt"

    periodicity = None
    for value, terms in {
        "monthly": ["mois", "mensuel"],
        "quarterly": ["trimestre", "trimestriel"],
        "semiannual": ["semestre", "semestriel"],
        "annual": ["annee", "annuel"],
    }.items():
        if any(term in normalized for term in terms):
            periodicity = value
            break

    measurement_type = "value"
    if "proportion" in normalized:
        measurement_type = "proportion"
    elif "nombre" in normalized or "combien" in normalized:
        measurement_type = "count"
    elif "taux" in normalized:
        measurement_type = "rate"

    population = None
    if "zero dose" in normalized:
        population = "enfants de 0 à 11 mois sans Penta1"
    elif "sous vaccine" in normalized:
        population = "enfants de 0 à 11 mois sans Penta3"
    elif "nourrisson" in normalized:
        population = "nourrissons"
    elif "enfant" in normalized:
        population = "enfants"

    depth = "situation"
    inferred_intent = infer_analytical_intent(normalized)
    if inferred_intent == "diagnosis":
        depth = "diagnosis"
    elif inferred_intent == "risk_alert":
        depth = "risk"
    elif inferred_intent == "controlled_recommendation":
        depth = "action"

    return {
        "antigens": antigens,
        "measurement_type": measurement_type,
        "geographic_levels": levels,
        "periodicity": periodicity,
        "periods": extract_period_codes(question),
        "threshold": threshold,
        "comparison_operator": operator,
        "population": population,
        "analysis_depth": depth,
        "breakdown": levels[0] if levels else None,
    }


def get_question_definition(qid: str | None) -> dict[str, Any] | None:
    if not qid or qid not in QUESTION_CATALOG:
        return None
    return {"qid": qid, **QUESTION_CATALOG[qid]}
