"""Semantic layer — maps business terms to DHIS2 indicators with definitions,
thresholds, units, and interpretation rules.

This is the bridge between the user's natural language and the DHIS2 data.
It provides:
- Indicator definitions (numerator, denominator, calculation mode)
- Thresholds from the RDC indicator reference (WHO standards)
- Interpretation rules (what does a value below threshold mean?)
- Synonyms and aliases for natural language matching
- Domain categorization (vaccination, malaria, maternal, etc.)

Source: « Version 3 analyse plateforme PEV OMS amb.xlsx » (81 indicators)
+ DHIS2 audit (ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §11)
"""

from __future__ import annotations

from typing import Any

from app.tools.question_catalog import (
    classify_business_question,
    extract_business_entities,
    get_question_definition,
)


# ─── Indicator definitions ───────────────────────────────────
# Each entry maps a DHIS2 UID to its full semantic definition.
# Thresholds are from the RDC indicator reference (WHO / national standards).

# PEV thresholds — same values as src/lib/pev/thresholds.json (dashboard,
# reports), checked by tests/test_pev_thresholds.py. Two bounds, three bands:
# beyond `warning` = critical, between `warning` and `target` = warning,
# target reached = good. Mapped here onto evaluate_threshold's keys
# (critical = alert bound, warning = target bound).
PEV_THRESHOLDS: dict[str, dict[str, float]] = {
    "coverage": {"warning": 80, "target": 90},
    "dropout": {"warning": 10, "target": 5},
    "wastage": {"warning": 15, "target": 5},
}


def _pev_thresholds(kind: str) -> dict[str, float]:
    t = PEV_THRESHOLDS[kind]
    return {"target": t["target"], "warning": t["target"], "critical": t["warning"]}


INDICATOR_DEFINITIONS: dict[str, dict[str, Any]] = {
    # ─── Vaccination — coverage ───
    "v9b9aYsA5PM": {
        "name": "Taux de couverture vaccinale en Pentavalent 3",
        "short_name": "Couverture Penta3",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["penta3", "pentavalent 3", "dtc3", "penta 3", "3e dose penta", "couverture penta3"],
        "definition": "Pourcentage d'enfants ayant reçu la 3e dose de vaccin pentavalent (DTC-HepB-Hib)",
        "numerator": "Nombre d'enfants ayant reçu Penta3",
        "denominator": "Population cible (enfants < 1 an)",
        "thresholds": _pev_thresholds("coverage"),
        "interpretation": {
            "above_target": "Couverture satisfaisante — objectif OMS atteint",
            "warning": "Couverture sous l'objectif — surveillance renforcée recommandée",
            "critical": "Couverture critique — risque d'épidémie, action urgente requise",
        },
        "priority": "high",
        "level": "province",
        "associated_indicators": ["k26tJ22Ncpd"],      # Penta1 — examiner conjointement
        "explanatory_indicators": [                      # causes probables d'une dégradation
            "MULXtL8iom8",   # Abandon Penta1-Penta3
            "RMHgIqfBG7N",   # Sous-vaccinés
            "YM7Tmn01ieL",   # Taux de perte vaccins
        ],
        "consequence_indicators": [                      # ce que cela impacte
            "nvPe9ZZiEaH",   # Enfants complètement vaccinés
        ],
        "questions": [
            "Où la couverture Penta3 est-elle faible ?",
            "Pourquoi la couverture Penta3 baisse-t-elle dans cette province ?",
            "Quelles ZS sont prioritaires sur la couverture Penta3 ?",
        ],
        "actions": [
            "Vérifier les ruptures de stock Penta3 dans les ZS à faible couverture",
            "Comparer séances planifiées vs réalisées",
            "Organiser des séances de rattrapage dans les ZS sous le seuil",
        ],
        "default_render": "diagnostic_answer",
    },
    "k26tJ22Ncpd": {
        "name": "Taux de couverture vaccinale en Pentavalent 1",
        "short_name": "Couverture Penta1",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["penta1", "pentavalent 1", "dtc1", "penta 1", "1re dose penta", "couverture penta1"],
        "definition": "Pourcentage d'enfants ayant reçu la 1re dose de vaccin pentavalent",
        "numerator": "Nombre d'enfants ayant reçu Penta1",
        "denominator": "Population cible (enfants < 1 an)",
        "thresholds": _pev_thresholds("coverage"),
        "interpretation": {
            "above_target": "Couverture Penta1 satisfaisante",
            "warning": "Couverture Penta1 sous l'objectif",
            "critical": "Couverture Penta1 critique — risque de zéro-dose élevé",
        },
        "priority": "high",
        "level": "province",
        "associated_indicators": ["v9b9aYsA5PM"],      # Penta3
        "explanatory_indicators": [
            "RMHgIqfBG7N",   # Sous-vaccinés
            "YM7Tmn01ieL",   # Taux de perte vaccins
        ],
        "consequence_indicators": [
            "MULXtL8iom8",   # Abandon Penta1-Penta3
            "nvPe9ZZiEaH",   # Enfants complètement vaccinés
        ],
        "questions": [
            "Où la couverture Penta1 est-elle faible ?",
            "Quelles ZS ont le plus de zéro-dose ?",
        ],
        "actions": [
            "Identifier les enfants zéro-dose (cible Penta1 - Penta1 administré)",
            "Renforcer les stratégies avancées et mobiles dans les ZS à faible accès",
        ],
        "default_render": "diagnostic_answer",
    },
    "cWJXYKCXrLx": {
        "name": "Taux de couverture vaccinale en BCG",
        "short_name": "Couverture BCG",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["bcg", "couverture bcg", "vaccination bcg"],
        "definition": "Pourcentage de nouveau-nés ayant reçu le vaccin BCG",
        "numerator": "Nombre de nouveau-nés vaccinés BCG",
        "denominator": "Nombre de naissances vivantes",
        "thresholds": _pev_thresholds("coverage"),
        "interpretation": {
            "above_target": "Couverture BCG satisfaisante",
            "warning": "Couverture BCG sous l'objectif",
            "critical": "Couverture BCG très faible — risque tuberculose pédiatrique",
        },
        "priority": "high",
        "level": "province",
        "associated_indicators": ["k26tJ22Ncpd"],      # Penta1 — première dose aussi
        "explanatory_indicators": [
            "RMHgIqfBG7N",   # Sous-vaccinés
            "W25tOXS0rxS",   # Doses BCG administrées
        ],
        "consequence_indicators": [
            "nvPe9ZZiEaH",   # Enfants complètement vaccinés
        ],
        "questions": [
            "Où la couverture BCG est-elle faible ?",
            "Quelles ZS ont le plus de nouveau-nés non vaccinés par le BCG ?",
        ],
        "actions": [
            "Renforcer la vaccination à la naissance en maternité",
            "Identifier les nouveau-nés manqués via les registres de naissance",
        ],
        "default_render": "diagnostic_answer",
    },
    "tNZxs1kE6fy": {
        "name": "Taux de couverture vaccinale en VAP 4",
        "short_name": "Couverture VAP4",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["vap4", "vap 4", "paludisme 4", "vaccin antipaludique", "vaccination paludisme", "couverture vap4"],
        "definition": "Pourcentage d'enfants de 12-23 mois ayant reçu la 4e dose de VAP (Vaccin AntiPaludique). Introduction progressive : une couverture nulle signale d'abord une province non encore couverte.",
        "numerator": "Enfants de 12-23 mois ayant reçu la VAP 4",
        "denominator": "Enfants de 12-23 mois attendus (population totale × 3,49 %)",
        "thresholds": _pev_thresholds("coverage"),
        "interpretation": {
            "above_target": "Couverture VAP4 satisfaisante",
            "warning": "Couverture VAP4 sous l'objectif",
            "critical": "Couverture VAP4 critique — vérifier d'abord si la zone a introduit le vaccin antipaludique",
        },
        "priority": "high",
        "level": "province",
        "associated_indicators": ["v9b9aYsA5PM", "k26tJ22Ncpd"],
        "explanatory_indicators": [
            "MULXtL8iom8",   # Abandon Penta1-Penta3
            "RMHgIqfBG7N",   # Sous-vaccinés
        ],
        "consequence_indicators": [
            "nvPe9ZZiEaH",   # Enfants complètement vaccinés
        ],
        "questions": [
            "Où la couverture VAP4 est-elle faible ?",
            "Quelles provinces ont introduit le vaccin antipaludique ?",
        ],
        "actions": [
            "Distinguer les ZS non encore couvertes par l'introduction du VAP des ZS en contre-performance",
            "Vérifier la disponibilité du VAP en stock (SIGL ESS)",
        ],
        "default_render": "diagnostic_answer",
    },
    # ─── Vaccination — dropout ───
    "MULXtL8iom8": {
        "name": "Taux d'abandons DTC-HepB-Hib1-DTC-Hep-Hib3",
        "short_name": "Abandon Penta1-Penta3",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["abandon", "dropout", "perta1 penta3", "abandon penta", "taux d'abandon"],
        "definition": "Pourcentage d'enfants qui ont reçu Penta1 mais n'ont pas reçu Penta3",
        "numerator": "Penta1 - Penta3",
        "denominator": "Penta1",
        "thresholds": _pev_thresholds("dropout"),
        "interpretation": {
            "below_target": "Taux d'abandon acceptable (≤ 5 %)",
            "warning": "Taux d'abandon élevé — pertes dans le parcours vaccinal",
            "critical": "Taux d'abandon critique — rupture du parcours vaccinal",
        },
        "priority": "high",
        "level": "province",
        "inverted": True,  # Higher = worse
        "associated_indicators": ["FhQ8Hd5rCHj"],      # Abandon MR1-MR2
        "explanatory_indicators": [
            "k26tJ22Ncpd",   # Couverture Penta1 (si Penta1 haut mais Penta3 bas → abandon)
            "v9b9aYsA5PM",   # Couverture Penta3
            "YM7Tmn01ieL",   # Taux de perte vaccins
        ],
        "consequence_indicators": [
            "nvPe9ZZiEaH",   # Enfants complètement vaccinés
            "RMHgIqfBG7N",   # Sous-vaccinés
        ],
        "questions": [
            "Où l'abandon Penta1-Penta3 est-il le plus élevé ?",
            "Pourquoi l'abandon augmente-t-il dans cette province ?",
        ],
        "actions": [
            "Analyser les rendez-vous manqués (tracking defaulter)",
            "Renforcer le rappel des mères via SMS ou visite à domicile",
        ],
        "default_render": "diagnostic_answer",
    },
    "FhQ8Hd5rCHj": {
        "name": "EPI - MR 1 to 2 dropout rate",
        "short_name": "Abandon MR1-MR2",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["mr dropout", "rougeole abandon", "mr1 mr2", "abandon rougeole"],
        "definition": "Taux d'abandon entre MR1 (Rougeole 1) et MR2 (Rougeole 2)",
        "thresholds": _pev_thresholds("dropout"),
        "interpretation": {
            "below_target": "Abandon MR acceptable",
            "warning": "Abandon MR élevé",
            "critical": "Abandon MR critique — risque d'épidémie de rougeole",
        },
        "priority": "high",
        "level": "province",
        "inverted": True,
        "associated_indicators": ["MULXtL8iom8"],      # Abandon Penta1-Penta3
        "explanatory_indicators": [
            "YM7Tmn01ieL",   # Taux de perte vaccins
        ],
        "consequence_indicators": [
            "nvPe9ZZiEaH",   # Enfants complètement vaccinés
            "RMHgIqfBG7N",   # Sous-vaccinés
        ],
        "questions": [
            "Où l'abandon MR1-MR2 est-il le plus élevé ?",
            "Quelles ZS sont à risque d'épidémie de rougeole ?",
        ],
        "actions": [
            "Organiser une 2e opportunité de vaccination MR2",
            "Renforcer la sensibilisation sur le rappel MR2",
        ],
        "default_render": "diagnostic_answer",
    },
    # ─── Vaccination — loss ───
    "YM7Tmn01ieL": {
        "name": "Taux de perte des vaccins",
        "short_name": "Perte vaccins",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["perte vaccin", "wastage", "perte", "gaspi"],
        "definition": "Pourcentage de doses de vaccin perdues (périmées, brisées, non utilisées)",
        "thresholds": _pev_thresholds("wastage"),
        "interpretation": {
            "below_target": "Taux de perte acceptable",
            "warning": "Perte élevée — vérifier gestion stock et chaîne du froid",
            "critical": "Perte critique — gaspillage important, audit logistique requis",
        },
        "priority": "medium",
        "level": "province",
        "inverted": True,
        "associated_indicators": ["MULXtL8iom8", "FhQ8Hd5rCHj"],
        "explanatory_indicators": [
            # Logistique détaillée (B 6.1) — non saisie dans DHIS2 mais liée conceptuellement
        ],
        "consequence_indicators": [
            "v9b9aYsA5PM",   # Couverture Penta3
            "k26tJ22Ncpd",   # Couverture Penta1
        ],
        "questions": [
            "Où le taux de perte vaccinale est-il élevé ?",
            "Quels vaccins sont les plus touchés par les pertes ?",
        ],
        "actions": [
            "Audit de la gestion du stock au niveau ZS",
            "Vérifier le respect de la chaîne du froid",
        ],
        "default_render": "diagnostic_answer",
    },
    # ─── Vaccination — population ───
    "nvPe9ZZiEaH": {
        "name": "Taux d'enfants complètement vaccinés",
        "short_name": "Enfants complétement vaccinés",
        "domain": "vaccination",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["complètement vacciné", "fully vaccinated", "couverture complete", "pev complete"],
        "definition": "Pourcentage d'enfants ayant reçu tous les vaccins du calendrier PEV",
        "thresholds": _pev_thresholds("coverage"),
        "interpretation": {
            "above_target": "Couverture complète satisfaisante",
            "warning": "Couverture complète sous l'objectif",
            "critical": "Couverture complète critique — grande proportion d'enfants non protégés",
        },
        "priority": "high",
        "level": "province",
        "associated_indicators": [
            "v9b9aYsA5PM",   # Penta3
            "k26tJ22Ncpd",   # Penta1
            "cWJXYKCXrLx",   # BCG
            "tNZxs1kE6fy",   # VAP4
        ],
        "explanatory_indicators": [
            "MULXtL8iom8",   # Abandon Penta1-Penta3
            "FhQ8Hd5rCHj",   # Abandon MR1-MR2
            "RMHgIqfBG7N",   # Sous-vaccinés
        ],
        "consequence_indicators": [
            # Risque d'épidémie (rougeole, polio, coqueluche) — non mesuré directement
        ],
        "questions": [
            "Où la couverture complète est-elle la plus faible ?",
            "Quelles provinces ont le plus d'enfants non protégés ?",
        ],
        "actions": [
            "Prioriser les ZS à faible couverture complète pour les interventions",
            "Renforcer le PEV dans les zones à risque",
        ],
        "default_render": "ranking_answer",
    },
    "RMHgIqfBG7N": {
        "name": "Nombre d'enfants sous vaccinés (SV)",
        "short_name": "Sous-vaccinés",
        "domain": "vaccination",
        "unit": "count",
        "dhis2_type": "indicator",
        "synonyms": ["sous vacciné", "under-vaccinated", "sous vaccination", "enfants non vaccinés"],
        "definition": "Nombre d'enfants qui n'ont pas reçu tous les vaccins prévus",
        "thresholds": None,  # No fixed threshold — relative comparison
        "interpretation": {
            "info": "Nombre absolu d'enfants sous-vaccinés — comparer entre provinces",
        },
        "priority": "high",
        "level": "province",
        "inverted": True,
        "associated_indicators": ["nvPe9ZZiEaH"],      # Enfants complètement vaccinés
        "explanatory_indicators": [
            "k26tJ22Ncpd",   # Couverture Penta1
            "v9b9aYsA5PM",   # Couverture Penta3
            "MULXtL8iom8",   # Abandon Penta1-Penta3
        ],
        "consequence_indicators": [
            # Risque épidémique — non mesuré directement
        ],
        "questions": [
            "Où y a-t-il le plus d'enfants sous-vaccinés ?",
            "Quelles ZS concentrent les zéro-dose ?",
        ],
        "actions": [
            "Calculer les zéro-dose : cible Penta1 - Penta1 administré",
            "Mettre en œuvre des stratégies de vaccination de rattrapage",
        ],
        "default_render": "ranking_answer",
    },
    # ─── Vaccination — doses administered ───
    "W25tOXS0rxS": {
        "name": "BCG - doses administrées (agrégé)",
        "short_name": "Doses BCG",
        "domain": "vaccination",
        "unit": "count",
        "dhis2_type": "data_element",
        "synonyms": ["doses bcg", "bcg administré", "nombre bcg"],
        "definition": "Nombre total de doses BCG administrées",
        "thresholds": None,
        "interpretation": {"info": "Volume de doses — indicateur d'activité vaccinale"},
        "priority": "medium",
        "level": "province",
    },
    "uNdFg1eymsa": {
        "name": "DTC-HepB Hib 1 - doses administrées",
        "short_name": "Doses Penta1",
        "domain": "vaccination",
        "unit": "count",
        "dhis2_type": "data_element",
        "synonyms": ["doses penta1", "penta1 administré", "nombre penta1"],
        "definition": "Nombre total de doses Penta1 administrées",
        "thresholds": None,
        "interpretation": {"info": "Volume de doses Penta1 — indicateur d'activité"},
        "priority": "medium",
        "level": "province",
    },
    "WWxqaHSeiwd": {
        "name": "DTC-HepB Hib 3 - doses administrées",
        "short_name": "Doses Penta3",
        "domain": "vaccination",
        "unit": "count",
        "dhis2_type": "data_element",
        "synonyms": ["doses penta3", "penta3 administré", "nombre penta3"],
        "definition": "Nombre total de doses Penta3 administrées",
        "thresholds": None,
        "interpretation": {"info": "Volume de doses Penta3 — indicateur d'activité"},
        "priority": "medium",
        "level": "province",
    },
    # ─── Malaria ───
    "rOt4BctnRqS": {
        "name": "Cas de paludisme (présumés et confirmés)",
        "short_name": "Cas paludisme",
        "domain": "malaria",
        "unit": "count",
        "dhis2_type": "indicator",
        "synonyms": ["paludisme", "malaria", "cas de paludisme", "cas présomptifs"],
        "definition": "Nombre total de cas de paludisme (présumés + confirmés)",
        "thresholds": None,
        "interpretation": {"info": "Volume de cas — surveiller les tendances saisonnières"},
        "priority": "high",
        "level": "province",
    },
    # ─── Maternal ───
    "eVbOZqoI7JP": {
        "name": "Accouchements assistés par personnel qualifié",
        "short_name": "Accouchements qualifiés",
        "domain": "maternal",
        "unit": "percent",
        "dhis2_type": "indicator",
        "synonyms": ["accouchement", "accouchements", "personnel qualifié", "sage femme"],
        "definition": "Pourcentage d'accouchements assistés par un personnel de santé qualifié",
        "thresholds": {
            "target": 90,
            "critical": 60,
            "warning": 70,
        },
        "interpretation": {
            "above_target": "Taux d'accouchements qualifiés satisfaisant",
            "warning": "Taux sous l'objectif — risque maternel élevé",
            "critical": "Taux critique — mortalité maternelle élevée",
        },
        "priority": "high",
        "level": "province",
    },
}


# ─── Health terminology (RDC PEV / polio context) ────────────
# Abbreviations and terms commonly used in DRC vaccination documents.
# Source: doc_sante (45 documents — directives, fiches, macroplans, briefings).
# Used by resolve_terminology() to expand abbreviations in user queries.

HEALTH_TERMINOLOGY: dict[str, dict[str, Any]] = {
    # ─── Vaccines ───
    "vpob": {
        "full_name": "Vaccin antipoliomyélitique oral bivalent",
        "short_name": "VPOb",
        "category": "vaccine",
        "description": "Vaccin oral contre les poliovirus types 1 et 3. Utilisé en routine et lors des ripostes cVDPV1.",
        "doses_per_vial": "20 ou 50",
        "pfmd": True,           # Politique des flacons multidoses applicable
        "storage": "+2°C à +8°C (ou -25°C à -15°C en entrepôt)",
        "administration": "2 gouttes per os",
    },
    "nvpo2": {
        "full_name": "nouveau Vaccin antipoliomyélitique oral de type 2",
        "short_name": "nVPO2",
        "category": "vaccine",
        "description": "Vaccin oral type 2 utilisé uniquement lors des ripostes contre cVDPV2. PFMD non applicable.",
        "doses_per_vial": "20",
        "pfmd": False,
        "storage": "+2°C à +8°C",
        "administration": "2 gouttes per os",
    },
    "vpom2": {
        "full_name": "Vaccin antipoliomyélitique oral monovalent type 2",
        "short_name": "VPOm2",
        "category": "vaccine",
        "description": "Ancien vaccin type 2, retiré de la circulation. Ne doit plus être utilisé.",
        "doses_per_vial": "20",
        "pfmd": False,
        "storage": "Retiré — destruction requise",
        "administration": "2 gouttes per os",
    },
    "vpot": {
        "full_name": "Vaccin antipoliomyélitique oral trivalent",
        "short_name": "VPOt",
        "category": "vaccine",
        "description": "Vaccin trivalent retiré depuis avril 2016 (passage au VPOb). Recherche active pour retrait.",
        "doses_per_vial": "20",
        "pfmd": False,
        "storage": "Retiré — destruction requise",
        "administration": "2 gouttes per os",
    },
    "vpi": {
        "full_name": "Vaccin antipoliomyélitique inactivé",
        "short_name": "VPI",
        "category": "vaccine",
        "description": "Vaccin injectable inactivé contre la polio. Administré en routine (doses 1 et 2).",
        "doses_per_vial": "Variable",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection intramusculaire",
    },
    "vap": {
        "full_name": "Vaccin antipaludique",
        "short_name": "VAP",
        "category": "vaccine",
        "description": "Vaccin contre le paludisme (SNIS RDC : « Vaccin antipaludique (VAP) 5 doses/flacon, injectable »). Schéma en 4 doses, VAP4 chez les 12-23 mois. Introduction progressive par province. Ne pas confondre avec les vaccins polio (VPO, VPI).",
        "doses_per_vial": "5",
        "pfmd": None,
        "storage": "+2°C à +8°C",
        "administration": "Injection intramusculaire",
    },
    "bcg": {
        "full_name": "Bacille de Calmette et Guérin",
        "short_name": "BCG",
        "category": "vaccine",
        "description": "Vaccin contre la tuberculose. Administré à la naissance.",
        "doses_per_vial": "Variable (lyophilisé)",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection intradermique",
    },
    "penta": {
        "full_name": "Vaccin pentavalent (DTC-HepB-Hib)",
        "short_name": "Penta",
        "category": "vaccine",
        "description": "Vaccin combiné contre Diphtérie, Tétanos, Coqueluche, Hépatite B, Haemophilus influenzae type b.",
        "doses_per_vial": "Variable (liquide)",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection intramusculaire",
    },
    "dtc": {
        "full_name": "Diphtérie-Tétanos-Coqueluche",
        "short_name": "DTC",
        "category": "vaccine",
        "description": "Composant du vaccin pentavalent. DTC-HepB-Hib = Penta.",
        "doses_per_vial": "Variable",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection intramusculaire",
    },
    "mr": {
        "full_name": "Vaccin Rougeole-Rubéole",
        "short_name": "MR",
        "category": "vaccine",
        "description": "Vaccin combiné contre la rougeole et la rubéole. MR1 (9 mois) et MR2 (18 mois).",
        "doses_per_vial": "Variable (lyophilisé)",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection sous-cutanée",
    },
    "var": {
        "full_name": "Vaccin anti-rougeoleux",
        "short_name": "VAR",
        "category": "vaccine",
        "description": "Vaccin contre la rougeole. Utilisé lors des campagnes de rattrapage (6 mois–14 ans).",
        "doses_per_vial": "Variable (lyophilisé)",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection sous-cutanée",
    },
    "vat": {
        "full_name": "Vaccin anti-tétanique",
        "short_name": "VAT",
        "category": "vaccine",
        "description": "Vaccin contre le tétanos. Cible : femmes en âge de procréer (15-49 ans).",
        "doses_per_vial": "Variable",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection intramusculaire",
    },
    "pcv13": {
        "full_name": "Vaccin antipneumococcique conjugué 13-valent",
        "short_name": "PCV-13",
        "category": "vaccine",
        "description": "Vaccin contre les pneumocoques. Présentation 4 doses ou monodose.",
        "doses_per_vial": "4 ou 1",
        "pfmd": True,
        "storage": "+2°C à +8°C",
        "administration": "Injection intramusculaire",
    },
    # ─── Epidemiological terms ───
    "cvdpv": {
        "full_name": "Poliovirus dérivé d'une souche vaccinale circulant",
        "short_name": "cVDPV",
        "category": "epidemiology",
        "description": "Poliovirus qui a retrouvé sa virulence après circulation. cVDPV1 (type 1), cVDPV2 (type 2).",
    },
    "pfa": {
        "full_name": "Paralysie Flasque Aiguë",
        "short_name": "PFA",
        "category": "epidemiology",
        "description": "Indicateur de surveillance de la polio. Tout cas de PFA < 15 ans doit être notifié.",
    },
    "wpv": {
        "full_name": "Poliovirus sauvage (Wild Poliovirus)",
        "short_name": "WPV",
        "category": "epidemiology",
        "description": "Poliovirus sauvage. Type 2 déclaré éradiqué en 2015.",
    },
    "mev": {
        "full_name": "Maladies évitables par la vaccination",
        "short_name": "MEV",
        "category": "epidemiology",
        "description": "Maladies ciblées par le PEV : polio, rougeole, tétanos, fièvre jaune, BCG, etc.",
    },
    # ─── Program & institutional ───
    "pev": {
        "full_name": "Programme Élargi de Vaccination",
        "short_name": "PEV",
        "category": "program",
        "description": "Programme national de vaccination de la RDC (EPI en anglais).",
    },
    "coup": {
        "full_name": "Comité des Opérations d'Urgence Polio",
        "short_name": "COUP",
        "category": "program",
        "description": "Comité national de coordination des ripostes polio.",
    },
    "cpc": {
        "full_name": "Comité Provincial de Coordination",
        "short_name": "CPC",
        "category": "program",
        "description": "Comité de coordination au niveau provincial. Présidé par le Gouverneur.",
    },
    "clc": {
        "full_name": "Comité Local de Coordination",
        "short_name": "CLC",
        "category": "program",
        "description": "Comité de coordination au niveau de la Zone de Santé.",
    },
    "imep": {
        "full_name": "Initiative Mondiale pour l'Éradication de la Poliomyélite",
        "short_name": "IMEP",
        "category": "program",
        "description": "Partenariat international (GPEI en anglais) finançant les ripostes polio.",
    },
    # ─── Campaign types ───
    "avs": {
        "full_name": "Activités de Vaccination Supplémentaires",
        "short_name": "AVS",
        "category": "campaign",
        "description": "Campagnes de vaccination de masse en complément à la routine (SIA en anglais).",
    },
    "jnv": {
        "full_name": "Journées Nationales de Vaccination",
        "short_name": "JNV",
        "category": "campaign",
        "description": "Campagne nationale couvrant les 26 provinces simultanément.",
    },
    "jlv": {
        "full_name": "Journées Locales de Vaccination",
        "short_name": "JLV",
        "category": "campaign",
        "description": "Campagne locale limitée à un bloc de provinces défini par l'analyse de risque.",
    },
    # ─── Monitoring & evaluation ───
    "lqas": {
        "full_name": "Lot Quality Assurance Sampling",
        "short_name": "LQAS",
        "category": "monitoring",
        "description": "Méthode d'évaluation de la couverture vaccinale en fin de campagne. 60 grappes par ZS.",
    },
    "pcv_vvm": {
        "full_name": "Pastille de Contrôle du Vaccin (Vaccine Vial Monitor)",
        "short_name": "PCV",
        "category": "monitoring",
        "description": "Indicateur visuel de la qualité du vaccin. PCV bonne = utilisable, PCV virée = à ne pas utiliser.",
    },
    "pfmd": {
        "full_name": "Politique des Flacons MultiDoses",
        "short_name": "PFMD",
        "category": "monitoring",
        "description": "Permet de conserver un flacon entamé jusqu'à 28 jours si PCV bonne. Applicable au VPOb, pas au nVPO2.",
    },
    "mapi": {
        "full_name": "Manifestations Adverses Post-Immunisation",
        "short_name": "MAPI",
        "category": "monitoring",
        "description": "Effets indésirables suivant la vaccination (AEFI en anglais). Mineures et graves.",
    },
    "odk": {
        "full_name": "Open Data Kit",
        "short_name": "ODK",
        "category": "tool",
        "description": "Outil de collecte de données sur téléphone Android utilisé lors des campagnes.",
    },
    # ─── Population categories ───
    "ecm": {
        "full_name": "Enfants Chroniquement Manqués",
        "short_name": "ECM",
        "category": "population",
        "description": "Enfants manqués lors d'au moins 3 AVS consécutives. Critères spécifiques.",
    },
    "zero_dose": {
        "full_name": "Enfant zéro dose",
        "short_name": "Zéro dose",
        "category": "population",
        "description": "Enfant qui n'a jamais reçu de dose de VPO (riposte) ou n'a pas reçu DTC1 (routine).",
    },
    "sous_vaccine": {
        "full_name": "Enfant sous-vacciné",
        "short_name": "Sous-vacciné",
        "category": "population",
        "description": "Enfant qui n'a pas reçu tous les vaccins prévus pour son âge.",
    },
    # ─── Administrative levels ───
    "zs": {
        "full_name": "Zone de Santé",
        "short_name": "ZS",
        "category": "geography",
        "description": "Niveau opérationnel du système de santé (519 ZS en RDC). Dirigé par un MCZ.",
    },
    "as": {
        "full_name": "Aire de Santé",
        "short_name": "AS",
        "category": "geography",
        "description": "Subdivision de la ZS. Dirigée par un Infirmier Titulaire (IT).",
    },
    "bczs": {
        "full_name": "Bureau Central de la Zone de Santé",
        "short_name": "BCZS",
        "category": "geography",
        "description": "Bureau administratif de la ZS. Centre de stockage et coordination.",
    },
    "cs": {
        "full_name": "Centre de Santé",
        "short_name": "CS",
        "category": "geography",
        "description": "Structure de soins de premier niveau (FOSA).",
    },
    "dps": {
        "full_name": "Division Provinciale de la Santé",
        "short_name": "DPS",
        "category": "geography",
        "description": "Niveau provincial du Ministère de la Santé.",
    },
    "antenne": {
        "full_name": "Antenne PEV",
        "short_name": "Antenne",
        "category": "geography",
        "description": "Niveau intermédiaire entre Province et ZS pour le PEV. Gère la logistique vaccinale.",
    },
    # ─── Roles ───
    "it": {
        "full_name": "Infirmier Titulaire",
        "short_name": "IT",
        "category": "role",
        "description": "Responsable de l'Aire de Santé. Coordonne la riposte dans son AS.",
    },
    "mcz": {
        "full_name": "Médecin Chef de Zone",
        "short_name": "MCZ",
        "category": "role",
        "description": "Responsable de la Zone de Santé.",
    },
    "mca": {
        "full_name": "Médecin Chef d'Antenne",
        "short_name": "MCA",
        "category": "role",
        "description": "Responsable de l'Antenne PEV.",
    },
    "apa": {
        "full_name": "Autorité Politico-Administrative",
        "short_name": "APA",
        "category": "role",
        "description": "Autorité locale devant présider les comités de coordination.",
    },
}


# ─── Campaign types ──────────────────────────────────────────
# Source: Macroplan, Directives cVDPV1, Directives poliovirus variants.

CAMPAIGN_TYPES: dict[str, dict[str, Any]] = {
    "jnv": {
        "name": "Journées Nationales de Vaccination",
        "short_name": "JNV",
        "scope": "National (26 provinces)",
        "target_age": "0-59 mois",
        "vaccine": "VPOb ou nVPO2 selon le type de riposte",
        "strategy": "Porte-à-porte + sites fixes + populations spéciales",
        "duration": "3 jours + 1-2 jours ratissage (non financés)",
        "monitoring": "Monitorage interne, monitorage indépendant, LQAS",
        "evaluation": "LQAS à 80% et 90%, end process monitoring",
    },
    "jlv": {
        "name": "Journées Locales de Vaccination",
        "short_name": "JLV",
        "scope": "Bloc de provinces défini par analyse de risque",
        "target_age": "0-59 mois",
        "vaccine": "VPOb ou nVPO2",
        "strategy": "Porte-à-porte + sites fixes",
        "duration": "3 jours + ratissage",
        "monitoring": "Monitorage interne, LQAS",
        "evaluation": "LQAS à 80%",
    },
    "riposte_cvdpv1": {
        "name": "Riposte contre cVDPV1",
        "short_name": "Riposte cVDPV1",
        "scope": "Défini par analyse de risque",
        "target_age": "0-59 mois",
        "vaccine": "VPOb (bivalent types 1+3)",
        "strategy": "Porte-à-porte + stratégies spéciales",
        "duration": "3 jours + ratissage",
        "monitoring": "MI, MI indépendant, LQAS",
        "evaluation": "LQAS, rapport synthèse J+7",
    },
    "riposte_cvdpv2": {
        "name": "Riposte contre cVDPV2",
        "short_name": "Riposte cVDPV2",
        "scope": "Défini par analyse de risque",
        "target_age": "0-59 mois",
        "vaccine": "nVPO2 (type 2 uniquement)",
        "strategy": "Porte-à-porte + stratégies spéciales",
        "duration": "3 jours + ratissage",
        "monitoring": "MI, MI indépendant, LQAS, monitorage flacons",
        "evaluation": "LQAS, formulaire A/B, rapport synthèse J+7",
    },
    "rougeole_rattrapage": {
        "name": "Campagne de rattrapage rougeole",
        "short_name": "Rattrapage VAR",
        "scope": "Selon analyse de risque",
        "target_age": "6 mois – 14 ans",
        "vaccine": "VAR (vaccin anti-rougeoleux)",
        "strategy": "Sites fixes + avancés",
        "duration": "Variable",
        "monitoring": "Monitorage, LQAS",
        "evaluation": "LQAS",
    },
    "rougeole_suivi": {
        "name": "Campagne de suivi rougeole",
        "short_name": "Suivi VAR",
        "scope": "Selon analyse de risque",
        "target_age": "6 mois – 10 ans",
        "vaccine": "VAR",
        "strategy": "Sites fixes",
        "duration": "Variable",
        "monitoring": "Monitorage, LQAS",
        "evaluation": "LQAS",
    },
    "tetanos": {
        "name": "Campagne contre le tétanos maternel et néonatal",
        "short_name": "VAT",
        "scope": "Selon analyse de risque",
        "target_age": "Femmes 15-49 ans (14-49 pour riposte)",
        "vaccine": "VAT (vaccin anti-tétanique)",
        "strategy": "Sites fixes + avancés",
        "duration": "3 phases",
        "monitoring": "Monitorage",
        "evaluation": "Couverture VAT2+",
    },
    "fievre_jaune": {
        "name": "Campagne contre la fièvre jaune",
        "short_name": "Fièvre jaune",
        "scope": "Selon analyse de risque",
        "target_age": "9 mois et plus",
        "vaccine": "Vaccin anti-amarile",
        "strategy": "Sites fixes",
        "duration": "Variable",
        "monitoring": "Monitorage",
        "evaluation": "Couverture",
    },
}


# ─── Calculation formulas ────────────────────────────────────
# Source: Rapport synthèse, Briefing logistique, Macroplan, Outils gestion.

CALCULATION_FORMULAS: dict[str, dict[str, Any]] = {
    "taux_perte": {
        "name": "Taux de perte des vaccins",
        "formula": "(Doses utilisées - Doses administrées) / Doses utilisées × 100",
        "description": "Pourcentage de doses perdues (flacons entamés non utilisés, PCV virée, cassés, etc.)",
        "thresholds": {
            "good": "< 5%",
            "warning": "5-10%",
            "critical": "> 20% (problème d'administration)",
        },
        "source": "Rapport synthèse de riposte, Briefing logistique",
    },
    "facteur_perte": {
        "name": "Facteur de perte (pour estimation des besoins)",
        "formula": "1 / (1 - taux_perte_décimal)",
        "description": "Multiplicateur appliqué à la cible pour estimer le nombre de doses nécessaires",
        "values_by_vaccine": {
            "VPOb": 1.18,       # 15% de perte
            "nVPO2": 1.25,      # 20% de perte
            "VAR": 1.10,        # 10% de perte
            "VAT": 1.15,        # 15% de perte
            "Mébendazole": 1.10,
            "Vitamine A": 1.10,
            "MILD": 1.82,
        },
        "source": "Macroplan COUP-OMS-PEV",
    },
    "cible_vpo": {
        "name": "Population cible VPO (0-59 mois)",
        "formula": "Population totale × 18,9%",
        "description": "Estimation de la population cible pour les campagnes polio (0-59 mois = 18,9% de la population totale)",
        "source": "Briefing logistique VPOb/nVPO2 2024",
    },
    "besoin_flacons": {
        "name": "Besoin en flacons par équipe",
        "formula": "PlafondMath(cibles × facteur_perte ; doses_par_flacon)",
        "description": "Calcul du nombre de flacons à distribuer à chaque équipe",
        "examples": {
            "urbain_vpoB": "300 enfants × 1,18 = 354 → 18 flacons de 20 doses",
            "rural_vpoB": "100 enfants × 1,18 = 118 → 6 flacons de 20 doses",
            "urbain_nvpo2": "300 enfants × 1,25 = 375 → 8 flacons de 50 doses (arrondi à 400)",
            "rural_nvpo2": "100 enfants × 1,25 = 125 → 3 flacons de 50 doses",
        },
        "source": "Briefing logistique VPOb/nVPO2 2024",
    },
    "taux_abandon": {
        "name": "Taux d'abandon (dropout)",
        "formula": "(Dose1 - Dose3) / Dose1 × 100",
        "description": "Pourcentage d'enfants ayant reçu la dose 1 mais pas la dose 3",
        "examples": {
            "penta": "(Penta1 - Penta3) / Penta1 × 100",
            "mr": "(MR1 - MR2) / MR1 × 100",
        },
        "thresholds": {
            "good": "< 5%",
            "warning": "> 10%",
            "critical": "> 15%",
        },
        "source": "Définitions PEV / OMS",
    },
    "taux_satisfaction": {
        "name": "Taux de satisfaction (distribution intrants)",
        "formula": "Quantités reçues / Quantités prévues × 100",
        "description": "Mesure la couverture de la distribution des intrants (vaccins, consommables)",
        "source": "Outils de gestion VPOb 2023 OMS",
    },
    "pourcentage_flacons_incineres": {
        "name": "% flacons incinérés",
        "formula": "(Flacons détruits × 100) / Total flacons à détruire",
        "description": "Pourcentage de flacons correctement détruits en fin de campagne",
        "source": "Rapport synthèse de riposte",
    },
    "besoin_accumulateurs": {
        "name": "Besoin en accumulateurs de froid",
        "formula": "2 × nb_jours × nb_équipes",
        "description": "Estimation du nombre d'accumulateurs nécessaires pour une ZS",
        "example": "ZS de 50 équipes, 4 jours : 2 × 4 × 50 = 400 accumulateurs",
        "source": "Briefing logistique VPOb/nVPO2 2024",
    },
    "couverture_vaccinale": {
        "name": "Taux de couverture vaccinale",
        "formula": "(Enfants vaccinés / Population cible) × 100",
        "description": "Pourcentage de la population cible ayant reçu le vaccin",
        "source": "Définitions PEV / OMS",
    },
}


# ─── Operational thresholds ─────────────────────────────────
# Source: Lignes directrices revaccination, Directives cVDPV1, Éléments qualité.

OPERATIONAL_THRESHOLDS: dict[str, dict[str, Any]] = {
    "lqas_80": {
        "name": "LQAS seuil 80%",
        "description": "Une ZS passe le LQAS à 80% si ≤ 9 enfants manqués sur 60 grappes",
        "pass_condition": "≤ 9 enfants manqués sur 60",
        "fail_action": "Revaccination requise",
        "source": "Lignes directrices pour la revaccination AVS polio",
    },
    "lqas_90": {
        "name": "LQAS seuil 90%",
        "description": "LQAS à 90% : 4-8 enfants manqués → examiner autres indicateurs avant décision",
        "pass_condition": "≤ 3 enfants manqués",
        "borderline": "4-8 enfants manqués → examiner monitoring in process, couvertures administratives",
        "fail_action": "Revaccination si > 8 enfants manqués",
        "source": "Lignes directrices pour la revaccination AVS polio",
    },
    "revaccination_10pct": {
        "name": "Seuil de revaccination (Monitorage Indépendant)",
        "description": "Toute localité où > 10% des enfants n'ont pas été vaccinés (MI) doit être revaccinée",
        "threshold": "> 10% enfants non vaccinés",
        "action": "Revaccination dans la semaine suivant la campagne",
        "source": "Lignes directrices pour la revaccination AVS polio",
    },
    "revaccination_refus": {
        "name": "Seuil de revaccination (refus)",
        "description": "Taux de refus > 5% ou nombre croissant de refus → revaccination",
        "threshold": "> 5% de refus",
        "action": "Revaccination ciblée",
        "source": "Lignes directrices pour la revaccination AVS polio",
    },
    "ecm_criteres": {
        "name": "Critères d'identification des Enfants Chroniquement Manqués (ECM)",
        "description": "Critères pour identifier les ZS avec enfants chroniquement manqués",
        "criteria": [
            "ZS où ≥ 5% d'enfants ont été manqués pendant les 3 dernières AVS polio consécutives",
            "Grappe d'enfants (≥ 50 enfants < 5 ans) ayant raté la vaccination lors d'au moins 3 AVS consécutives",
            "ZS rapportant un cas de PFA avec zéro dose de vaccin polio",
            "ZS ayant une couverture < 80% pour VPO3/3e dose de polio pendant 2 années consécutives",
        ],
        "source": "Directives pour riposte contre cVDPV1",
    },
    "perte_vaccins_administration": {
        "name": "Seuil de perte vaccins (administration)",
        "description": "Rétro-information aux équipes sur la gestion des vaccins",
        "good": "< 5% — attirer l'attention sur le pointage et l'administration correcte",
        "critical": "> 20% — attirer l'attention sur l'administration (2 gouttes/enfant) et la conservation",
        "source": "Briefing logistique VPOb/nVPO2 2024",
    },
    "couverture_routine_vpo3": {
        "name": "Objectif couverture VPO3 (routine)",
        "description": "Au moins 80% de la population cible (0-11 mois) avec 3 doses de VPO (intervalle ≥ 4 semaines)",
        "threshold": "≥ 80%",
        "source": "Éléments de la qualité des activités de vaccination",
    },
    "monitorage_menages_problemes": {
        "name": "Seuil ménages à problèmes (monitorage)",
        "description": "Si sur 10 ménages au moins 3 sont à problèmes → refaire la vaccination dans la localité",
        "threshold": "≥ 3 ménages à problèmes sur 10",
        "probleme_definition": "Au moins 1 enfant non vacciné après visite si ménage marqué achevé, enfant non marqué, marquage incorrect, ou ménage non marqué",
        "source": "Fiche monitorage ménages AVS polio",
    },
}


# ─── Special populations ────────────────────────────────────
# Source: Identification et vaccination des ECM, Directives cVDPV1.

SPECIAL_POPULATIONS: dict[str, dict[str, Any]] = {
    "nomades": {
        "name": "Populations nomades",
        "provinces": ["Bas Uélé", "Haut Uélé"],
        "strategy": "Cartographie des nomades, implication des leaders, suivi quotidien",
    },
    "miniers": {
        "name": "Camps miniers",
        "provinces": ["Ituri", "Haut Katanga", "Haut Lomami", "Lualaba", "Tanganyika", "Maniema", "Kasaï"],
        "strategy": "Cartographie des camps miniers, implication des ONG, suivi quotidien",
    },
    "pecheurs": {
        "name": "Îlots et populations riveraines / pêcheurs",
        "provinces": ["Haut Katanga", "Haut Lomami", "Lualaba", "Tanganyika", "Maniema", "Maindombe",
                       "Kwango", "Kwilu", "Tshopo", "Mongala", "Tshuapa", "Equateur",
                       "Nord Ubangi", "Sud Ubangi", "Ituri", "Kongo central", "Sud Kivu"],
        "strategy": "Cartographie des îlots et campements, pirogues, équipes spécifiques",
    },
    "bidonvilles": {
        "name": "Buildings et bidonvilles urbains",
        "provinces": ["Haut Katanga", "Kinshasa", "Nord Kivu", "Sud Kivu", "Tshopo",
                       "Lualaba", "Tanganyika", "Kasaï", "Kasaï Central", "Kongo central"],
        "strategy": "Cartographie des espaces, implication des chefs de quartiers/rue",
    },
    "deplaces": {
        "name": "Déplacés internes et réfugiés",
        "provinces": ["Nord Kivu", "Sud Kivu", "Tanganyika", "Tshopo", "Bas Uélé",
                       "Haut Uélé", "Ituri", "Nord Ubangi", "Sud Ubangi"],
        "strategy": "Cartographie des camps, implication des leaders et ONG",
    },
    "frontaliers": {
        "name": "Populations frontalières",
        "provinces": ["Nord Ubangi", "Sud Ubangi", "Kinshasa", "Kongo Central", "Kasaï",
                       "Kasaï Central", "Bas Uélé", "Haut Uélé", "Haut Katanga",
                       "Lualaba", "Tanganyika", "Sud Kivu", "Nord Kivu"],
        "strategy": "Équipes aux points d'entrée, stratégie dos-à-dos, coordination transfrontalière",
    },
    "marches": {
        "name": "Grands marchés",
        "provinces": "Toutes les 26 provinces",
        "strategy": "Équipes spécifiques les jours de marché, implication des chefs de marchés",
    },
    "champetres": {
        "name": "Camps champêtres",
        "provinces": "Toutes les 26 provinces",
        "strategy": "Cartographie des camps, implication des relais communautaires",
    },
    "ecoles": {
        "name": "Écoles maternelles et crèches",
        "provinces": "Toutes les 26 provinces",
        "strategy": "Implication des PROVED, parents d'élèves et autorités de l'enseignement",
    },
}


# ─── Administrative structure ───────────────────────────────
# Source: Directives cVDPV1, VADE MECUM, Fiches de tâches.

ADMINISTRATIVE_STRUCTURE: dict[str, dict[str, Any]] = {
    "national": {
        "name": "Niveau National",
        "entities": ["PEV / COUP"],
        "responsibilities": "Coordination nationale, macro-planification, allocation des ressources",
        "data_tools": "Synthèse nationale, Dashboard PowerBI",
    },
    "province": {
        "name": "Niveau Provincial (26 provinces)",
        "entities": ["CPC", "DPS", "PEV Provincial"],
        "responsibilities": "Coordination provinciale, supervision des axes, compilation des données ZS",
        "data_tools": "Synthèse provinciale, Dashboard, ODK",
    },
    "antenne": {
        "name": "Niveau Antenne PEV",
        "entities": ["MCA", "Coordination d'Antenne"],
        "responsibilities": "Niveau intermédiaire : dispatching des intrants, compilation des données ZS",
        "data_tools": "Synthèse par antenne, fiches de stock",
    },
    "zone_sante": {
        "name": "Niveau Zone de Santé (519 ZS)",
        "entities": ["MCZ", "CLC", "BCZS"],
        "responsibilities": "Coordination locale, micro-planification, supervision des AS, compilation des données AS",
        "data_tools": "Synthèse ZS, fiches de stock, ODK, Dashboard",
    },
    "aire_sante": {
        "name": "Niveau Aire de Santé",
        "entities": ["IT (Infirmier Titulaire)"],
        "responsibilities": "Coordination de la riposte dans l'AS, compilation des données des équipes",
        "data_tools": "Synthèse AS, fiches de pointage, ODK",
    },
    "centre_sante": {
        "name": "Niveau Centre de Santé (FOSA)",
        "entities": ["Personnel de santé"],
        "responsibilities": "Site de vaccination, stockage des vaccins, gestion des déchets",
        "data_tools": "Fiches de pointage, fiches de stock, relevés de température",
    },
}


# ─── Business question patterns ──────────────────────────────
# Maps common business question patterns to the indicators and analysis
# steps needed to answer them. This drives the analysis planner.

QUESTION_PATTERNS: list[dict[str, Any]] = [
    {
        "pattern": ["couverture", "taux de couverture", "vaccinal", "vaccination"],
        "indicators": ["v9b9aYsA5PM", "k26tJ22Ncpd", "cWJXYKCXrLx"],
        "analysis_type": "coverage",
        "steps": ["situation", "gap", "ranking"],
    },
    {
        "pattern": ["abandon", "dropout", "perte", "rupture parcours"],
        "indicators": ["MULXtL8iom8", "FhQ8Hd5rCHj"],
        "analysis_type": "dropout",
        "steps": ["situation", "gap", "diagnosis"],
    },
    {
        "pattern": ["risque", "zone à risque", "prioritaire", "vulnérable"],
        "indicators": ["v9b9aYsA5PM", "MULXtL8iom8", "RMHgIqfBG7N"],
        "analysis_type": "risk",
        "steps": ["situation", "gap", "risk_scoring", "ranking"],
    },
    {
        "pattern": ["zéro dose", "zero dose", "non vacciné", "sous vacciné"],
        "indicators": ["RMHgIqfBG7N", "k26tJ22Ncpd"],
        "analysis_type": "zero_dose",
        "steps": ["situation", "gap", "ranking"],
    },
    {
        "pattern": ["équité", "ecart", "disparité", "inégalité"],
        "indicators": ["v9b9aYsA5PM", "k26tJ22Ncpd", "cWJXYKCXrLx"],
        "analysis_type": "equity",
        "steps": ["situation", "gap", "comparative"],
    },
]


class SemanticLayer:
    """Semantic layer — bridges natural language to DHIS2 indicators."""

    def execute(self, action: str, args: dict) -> dict:
        if action == "resolve_indicator":
            return self.resolve_indicator(args.get("query", ""))
        if action == "get_definition":
            return self.get_definition(args.get("indicator_id", ""))
        if action == "get_thresholds":
            return self.get_thresholds(args.get("indicator_id", ""))
        if action == "classify_question":
            return self.classify_question(args.get("query", ""))
        if action == "get_causal_links":
            return self.get_causal_links(args.get("indicator_id", ""))
        if action == "evaluate_threshold":
            return self.evaluate_threshold(args.get("indicator_id", ""), args.get("value", 0))
        if action == "extract_business_entities":
            return extract_business_entities(args.get("query", ""))
        if action == "get_question_definition":
            definition = get_question_definition(args.get("qid"))
            return {"status": "ready", "definition": definition} if definition else {"status": "not_found"}
        if action == "resolve_terminology":
            return self.resolve_terminology(args.get("query", ""))
        if action == "get_vaccine_info":
            return self.get_vaccine_info(args.get("vaccine", ""))
        if action == "get_campaign_info":
            return self.get_campaign_info(args.get("campaign_type", ""))
        if action == "get_formula":
            return self.get_formula(args.get("calculation_type", ""))
        if action == "get_operational_threshold":
            return self.get_operational_threshold(args.get("context", ""))
        if action == "get_special_populations":
            return self.get_special_populations(args.get("province", ""))
        if action == "get_health_context":
            return self.get_health_context(args.get("query", ""))
        raise ValueError(f"Unknown semantic layer action: {action}")

    def resolve_indicator(self, query: str) -> dict:
        """Resolve a natural language query to matching DHIS2 indicators."""
        query_lower = query.lower()
        matches: list[dict[str, Any]] = []

        for uid, defn in INDICATOR_DEFINITIONS.items():
            score = 0
            for synonym in defn.get("synonyms", []):
                if synonym.lower() in query_lower:
                    score += len(synonym)  # longer match = higher score
            if defn["name"].lower() in query_lower or defn["short_name"].lower() in query_lower:
                score += 50

            if score > 0:
                matches.append({
                    "indicator_id": uid,
                    "name": defn["name"],
                    "short_name": defn["short_name"],
                    "domain": defn["domain"],
                    "unit": defn["unit"],
                    "score": score,
                    "thresholds": defn.get("thresholds"),
                    "definition": defn["definition"],
                })

        matches.sort(key=lambda x: x["score"], reverse=True)
        return {
            "status": "ready",
            "matches": matches[:5],  # top 5
            "best_match": matches[0] if matches else None,
        }

    def get_definition(self, indicator_id: str) -> dict:
        """Get the full definition of an indicator."""
        defn = INDICATOR_DEFINITIONS.get(indicator_id)
        if not defn:
            return {"status": "not_found", "indicator_id": indicator_id}
        return {"status": "ready", "indicator_id": indicator_id, **defn}

    def get_thresholds(self, indicator_id: str) -> dict:
        """Get the thresholds for an indicator."""
        defn = INDICATOR_DEFINITIONS.get(indicator_id)
        if not defn:
            return {"status": "not_found", "indicator_id": indicator_id}
        return {
            "status": "ready",
            "indicator_id": indicator_id,
            "thresholds": defn.get("thresholds"),
            "interpretation": defn.get("interpretation"),
            "inverted": defn.get("inverted", False),
        }

    def classify_question(self, query: str) -> dict:
        """Classify a business question to determine the analysis type and steps."""
        catalog_match = classify_business_question(query)
        if catalog_match["status"] == "ready":
            definition = catalog_match["definition"]
            indicator_ids = definition.get("indicator_ids", [])
            return {
                "status": "ready",
                "qid": catalog_match["qid"],
                "confidence": catalog_match["confidence"],
                "analysis_type": catalog_match["intent"],
                "domain": definition.get("domain"),
                "resolution_mode": definition.get("resolution_mode"),
                "mapping_status": definition.get("mapping_status"),
                "indicators": indicator_ids,
                "indicator_query": definition.get("indicator_query"),
                "steps": definition.get("steps", ["situation"]),
                "render_type": definition.get("render_type", "kpi_answer"),
                "response_contract": self.build_response_contract(definition, query),
                "entities": extract_business_entities(query),
                "indicator_definitions": [
                    {"id": uid, **INDICATOR_DEFINITIONS[uid]}
                    for uid in indicator_ids
                    if uid in INDICATOR_DEFINITIONS
                ],
            }

        query_lower = query.lower()
        best_match = None
        best_score = 0
        for pattern in QUESTION_PATTERNS:
            score = sum(1 for kw in pattern["pattern"] if kw in query_lower)
            if score > best_score:
                best_score = score
                best_match = pattern

        if best_match:
            return {
                "status": "ready",
                "qid": None,
                "confidence": min(0.5 + best_score * 0.1, 0.8),
                "analysis_type": catalog_match["intent"] or best_match["analysis_type"],
                "indicators": best_match["indicators"],
                "steps": best_match["steps"],
                "render_type": None,
                "response_contract": self.build_response_contract(None, query),
                "entities": extract_business_entities(query),
                "indicator_definitions": [
                    {"id": uid, **INDICATOR_DEFINITIONS[uid]}
                    for uid in best_match["indicators"]
                    if uid in INDICATOR_DEFINITIONS
                ],
            }
        return {
            "status": "no_match",
            "qid": None,
            "confidence": 0.0,
            "analysis_type": catalog_match["intent"],
            "indicators": [],
            "steps": ["situation"],
            # None → the planner maps the analytical intent (trend, comparison,
            # ranking…) to the right render type instead of forcing KPI cards.
            "render_type": None,
            "response_contract": self.build_response_contract(None, query),
            "entities": extract_business_entities(query),
        }

    def build_response_contract(self, definition: dict | None, query: str) -> dict:
        entities = extract_business_entities(query)
        definition = definition or {}
        measurement_type = definition.get("measurement_type") or entities["measurement_type"]
        fields = ["direct_answer", "indicator", "period", "geography", "source", "data_quality", "limitations"]
        if measurement_type in ("proportion", "rate"):
            fields[1:1] = ["numerator", "denominator"]
        if definition.get("threshold") is not None or entities.get("threshold") is not None:
            fields.append("threshold_comparison")
        if "trend" in definition.get("steps", []):
            fields.append("trend")
        if "ranking" in definition.get("steps", []):
            fields.append("breakdown")
        if "diagnosis" in definition.get("steps", []):
            fields.extend(["associated_factors", "confidence", "causality_limit"])
        return {
            "version": "1.0",
            "required_fields": list(dict.fromkeys(fields)),
            "measurement_type": measurement_type,
            "threshold": entities.get("threshold") if entities.get("threshold") is not None else definition.get("threshold"),
            "comparison_operator": entities.get("comparison_operator") or definition.get("operator"),
            "population": entities.get("population") or definition.get("population"),
            "calculation": definition.get("calculation"),
            "mapping_status": definition.get("mapping_status"),
            "render_type": definition.get("render_type", "kpi_answer"),
            "human_validation_required": entities.get("analysis_depth") == "action",
        }

    def get_causal_links(self, indicator_id: str) -> dict:
        """Return causal links for an indicator: explanatory, associated, consequence.

        Used by the diagnostic engine to build hypotheses and by the analysis
        planner to decide which related indicators to fetch in a multi-indicator
        query.
        """
        defn = INDICATOR_DEFINITIONS.get(indicator_id)
        if not defn:
            return {"status": "not_found", "indicator_id": indicator_id}

        def _resolve(uids: list[str]) -> list[dict[str, Any]]:
            return [
                {"id": uid, "name": INDICATOR_DEFINITIONS[uid]["name"],
                 "short_name": INDICATOR_DEFINITIONS[uid]["short_name"],
                 "domain": INDICATOR_DEFINITIONS[uid]["domain"]}
                for uid in uids if uid in INDICATOR_DEFINITIONS
            ]

        return {
            "status": "ready",
            "indicator_id": indicator_id,
            "indicator_name": defn["name"],
            "explanatory_indicators": _resolve(defn.get("explanatory_indicators", [])),
            "associated_indicators": _resolve(defn.get("associated_indicators", [])),
            "consequence_indicators": _resolve(defn.get("consequence_indicators", [])),
            "questions": defn.get("questions", []),
            "actions": defn.get("actions", []),
            "default_render": defn.get("default_render"),
        }

    def evaluate_threshold(self, indicator_id: str, value: float) -> dict:
        """Evaluate a value against the indicator's thresholds."""
        defn = INDICATOR_DEFINITIONS.get(indicator_id)
        if not defn or not defn.get("thresholds"):
            return {"status": "no_thresholds", "value": value}

        thresholds = defn["thresholds"]
        inverted = defn.get("inverted", False)
        interpretation = defn.get("interpretation", {})

        if inverted:
            # For inverted indicators (dropout, loss): higher = worse
            if value > thresholds.get("critical", float("inf")):
                return {"status": "critical", "value": value, "label": interpretation.get("critical", "Critique")}
            elif value > thresholds.get("warning", float("inf")):
                return {"status": "warning", "value": value, "label": interpretation.get("warning", "Attention")}
            else:
                return {"status": "good", "value": value, "label": interpretation.get("below_target", "Acceptable")}
        else:
            # For normal indicators (coverage): lower = worse
            if value < thresholds.get("critical", 0):
                return {"status": "critical", "value": value, "label": interpretation.get("critical", "Critique")}
            elif value < thresholds.get("warning", 0):
                return {"status": "warning", "value": value, "label": interpretation.get("warning", "Attention")}
            else:
                return {"status": "good", "value": value, "label": interpretation.get("above_target", "Satisfaisant")}

    # ─── Health terminology & domain knowledge ───────────────
    # These methods leverage HEALTH_TERMINOLOGY, VACCINE_TYPES (within
    # HEALTH_TERMINOLOGY), CAMPAIGN_TYPES, CALCULATION_FORMULAS,
    # OPERATIONAL_THRESHOLDS, SPECIAL_POPULATIONS and ADMINISTRATIVE_STRUCTURE
    # extracted from the doc_sante corpus (45 DRC vaccination documents).

    def resolve_terminology(self, query: str) -> dict:
        """Resolve health abbreviations and terms in a user query.

        Scans the query for known abbreviations (VPOb, nVPO2, PFA, LQAS, etc.)
        and returns their full definitions. This helps the agent understand
        domain-specific jargon used in DRC vaccination documents.
        """
        query_lower = query.lower()
        matches: list[dict[str, Any]] = []
        for key, defn in HEALTH_TERMINOLOGY.items():
            # Match abbreviation as a whole word (bounded by non-alphanumeric)
            # e.g. "VPOb" should not match inside "VPObxxx"
            import re
            pattern = r'\b' + re.escape(key) + r'\b'
            if re.search(pattern, query_lower):
                matches.append({"key": key, **defn})

        if not matches:
            return {"status": "no_match", "query": query, "matches": []}
        return {
            "status": "ready",
            "query": query,
            "matches": matches,
            "expanded_terms": {m["key"]: m["full_name"] for m in matches},
        }

    def get_vaccine_info(self, vaccine: str) -> dict:
        """Get detailed information about a vaccine type.

        Looks up vaccine characteristics (doses per vial, PFMD, storage,
        administration mode) from HEALTH_TERMINOLOGY entries with category='vaccine'.
        """
        vaccine_lower = vaccine.lower().strip()
        # Direct key match
        if vaccine_lower in HEALTH_TERMINOLOGY:
            entry = HEALTH_TERMINOLOGY[vaccine_lower]
            if entry.get("category") == "vaccine":
                return {"status": "ready", "vaccine": vaccine, **entry}
        # Search by short_name or full_name
        for key, defn in HEALTH_TERMINOLOGY.items():
            if defn.get("category") != "vaccine":
                continue
            if (defn.get("short_name", "").lower() == vaccine_lower or
                defn.get("full_name", "").lower() == vaccine_lower or
                key == vaccine_lower):
                return {"status": "ready", "vaccine": defn["short_name"], **defn}
        return {"status": "not_found", "vaccine": vaccine}

    def get_campaign_info(self, campaign_type: str) -> dict:
        """Get information about a campaign type (JNV, JLV, riposte, etc.)."""
        ct_lower = campaign_type.lower().strip()
        # Direct key match
        if ct_lower in CAMPAIGN_TYPES:
            return {"status": "ready", **CAMPAIGN_TYPES[ct_lower]}
        # Search by name or short_name
        for key, defn in CAMPAIGN_TYPES.items():
            if (defn.get("short_name", "").lower() == ct_lower or
                defn.get("name", "").lower() == ct_lower or
                key == ct_lower):
                return {"status": "ready", **defn}
        return {"status": "not_found", "campaign_type": campaign_type}

    def get_formula(self, calculation_type: str) -> dict:
        """Get a calculation formula used in vaccination programs.

        Returns the formula, description, thresholds, and source document
        for calculations like taux de perte, facteur de perte, cible VPO, etc.
        """
        ct_lower = calculation_type.lower().strip().replace(" ", "_").replace("-", "_")
        # Direct key match
        if ct_lower in CALCULATION_FORMULAS:
            return {"status": "ready", **CALCULATION_FORMULAS[ct_lower]}
        # Fuzzy search by name
        for key, defn in CALCULATION_FORMULAS.items():
            if ct_lower in key or ct_lower in defn.get("name", "").lower():
                return {"status": "ready", **defn}
        return {"status": "not_found", "calculation_type": calculation_type}

    def get_operational_threshold(self, context: str) -> dict:
        """Get operational thresholds for campaign evaluation.

        Returns thresholds for LQAS, revaccination, ECM identification,
        vaccine loss, and monitoring criteria.
        """
        ctx_lower = context.lower().strip()
        # Direct key match
        if ctx_lower in OPERATIONAL_THRESHOLDS:
            return {"status": "ready", **OPERATIONAL_THRESHOLDS[ctx_lower]}
        # Search by name or keywords
        for key, defn in OPERATIONAL_THRESHOLDS.items():
            if (ctx_lower in key or
                ctx_lower in defn.get("name", "").lower() or
                ctx_lower in defn.get("description", "").lower()):
                return {"status": "ready", **defn}
        return {"status": "not_found", "context": context}

    def get_special_populations(self, province: str = "") -> dict:
        """Get special population categories, optionally filtered by province.

        Returns population types (nomads, miners, fishermen, displaced, etc.)
        with their associated provinces and recommended strategies.
        """
        if not province:
            return {
                "status": "ready",
                "populations": [
                    {"key": k, **v}
                    for k, v in SPECIAL_POPULATIONS.items()
                ],
            }
        province_lower = province.lower().strip()
        matching: list[dict[str, Any]] = []
        for key, defn in SPECIAL_POPULATIONS.items():
            provinces = defn.get("provinces", [])
            if provinces == "Toutes les 26 provinces":
                matching.append({"key": key, **defn})
            elif isinstance(provinces, list):
                if any(province_lower in p.lower() for p in provinces):
                    matching.append({"key": key, **defn})
        return {
            "status": "ready",
            "province": province,
            "populations": matching,
        }

    def get_health_context(self, query: str) -> dict:
        """Get comprehensive health context for a user query.

        Combines terminology resolution, campaign info, formulas, and
        operational thresholds relevant to the query. Used by the agent
        to enrich responses with domain knowledge from DRC vaccination documents.
        """
        context: dict[str, Any] = {"status": "ready", "query": query}

        # Resolve terminology
        term_result = self.resolve_terminology(query)
        if term_result["status"] == "ready":
            context["terminology"] = term_result["matches"]

        # Detect campaign references
        query_lower = query.lower()
        for key, defn in CAMPAIGN_TYPES.items():
            if (defn.get("short_name", "").lower() in query_lower or
                key in query_lower):
                context["campaign_type"] = defn
                break

        # Detect calculation references
        calc_keywords = {
            "taux_perte": ["taux de perte", "perte vaccin", "wastage", "gaspi"],
            "facteur_perte": ["facteur de perte", "facteur perte"],
            "cible_vpo": ["cible vpo", "population cible", "0-59 mois", "0-59"],
            "taux_abandon": ["abandon", "dropout", "taux d'abandon"],
            "taux_satisfaction": ["satisfaction", "taux de satisfaction"],
            "couverture_vaccinale": ["couverture vaccinale", "taux de couverture"],
        }
        relevant_formulas: list[dict[str, Any]] = []
        for calc_key, keywords in calc_keywords.items():
            if any(kw in query_lower for kw in keywords):
                if calc_key in CALCULATION_FORMULAS:
                    relevant_formulas.append(CALCULATION_FORMULAS[calc_key])
        if relevant_formulas:
            context["formulas"] = relevant_formulas

        # Detect LQAS / revaccination / ECM references
        if "lqas" in query_lower:
            context["lqas_80"] = OPERATIONAL_THRESHOLDS.get("lqas_80")
            context["lqas_90"] = OPERATIONAL_THRESHOLDS.get("lqas_90")
        if "revaccination" in query_lower or "revacciner" in query_lower:
            context["revaccination"] = OPERATIONAL_THRESHOLDS.get("revaccination_10pct")
        if "ecm" in query_lower or "chroniquement manqu" in query_lower:
            context["ecm_criteria"] = OPERATIONAL_THRESHOLDS.get("ecm_criteres")
        if "zéro dose" in query_lower or "zero dose" in query_lower:
            context["zero_dose"] = HEALTH_TERMINOLOGY.get("zero_dose")

        return context
