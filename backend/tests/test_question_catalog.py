from __future__ import annotations

import unittest

from langchain_core.messages import HumanMessage

from app.agents.decision_assistant import planner
from app.tools.analysis_planner import AnalysisPlanner
from app.tools.dhis2 import _aggregate_by_period, _build_threshold_proportion
from app.tools.question_catalog import (
    QUESTION_CATALOG,
    classify_business_question,
    extract_business_entities,
)


class QuestionCatalogTests(unittest.TestCase):
    def test_catalog_covers_source_questions(self):
        self.assertEqual(len(QUESTION_CATALOG), 15)
        for qid, definition in QUESTION_CATALOG.items():
            result = classify_business_question(" ".join(definition["patterns"]))
            self.assertEqual(result["qid"], qid)
            self.assertIn("calculation", result["definition"])
            self.assertIn(result["definition"]["mapping_status"], {"validated", "requires_dhis2_validation"})

    def test_classifies_penta3_threshold_proportion(self):
        result = classify_business_question(
            "Quelle est la proportion de ZS ayant une couverture Penta3 >= 80 % ?"
        )
        self.assertEqual(result["qid"], "proportion_couverture_penta3_seuil")
        self.assertEqual(result["intent"], "threshold_proportion")

    def test_distinguishes_zero_dose_count_and_proportion(self):
        count = classify_business_question("Quel est le nombre d'enfants zéro dose dans les ZS ?")
        proportion = classify_business_question("Quelle est la proportion d'enfants zéro dose dans les ZS ?")
        self.assertEqual(count["qid"], "nombre_enfants_zero_dose")
        self.assertEqual(proportion["qid"], "proportion_enfants_zero_dose")

    def test_extracts_business_dimensions(self):
        entities = extract_business_entities(
            "Proportion de ZS avec disponibilité BCG, Penta et PCV-13 >= 80 % par trimestre"
        )
        self.assertEqual(entities["measurement_type"], "proportion")
        self.assertEqual(entities["comparison_operator"], "gte")
        self.assertEqual(entities["threshold"], 80.0)
        self.assertEqual(entities["periodicity"], "quarterly")
        self.assertIn("health_zone", entities["geographic_levels"])
        self.assertEqual(set(entities["antigens"]), {"bcg", "penta", "pcv13"})

    def test_extracts_period_range_and_slash_operator(self):
        entities = extract_business_entities(
            "Couverture Penta3 >/= 80 % de mars à juillet 2025"
        )
        self.assertEqual(entities["comparison_operator"], "gte")
        self.assertEqual(
            entities["periods"],
            ["202503", "202504", "202505", "202506", "202507"],
        )

    def test_period_aggregation_does_not_sum_rates(self):
        cells = [
            {"period": "202501", "value": 80.0},
            {"period": "202501", "value": 60.0},
        ]
        self.assertEqual(_aggregate_by_period(cells, "rate")["202501"], 70.0)
        self.assertEqual(_aggregate_by_period(cells, "count")["202501"], 140.0)

    def test_threshold_proportion_uses_latest_unique_reporting_units(self):
        derived = _build_threshold_proportion(
            [
                {"period": "202501", "org_unit_id": "A", "value": 50.0},
                {"period": "202502", "org_unit_id": "A", "value": 80.0},
                {"period": "202502", "org_unit_id": "A", "value": 85.0},
                {"period": "202502", "org_unit_id": "B", "value": 70.0},
            ],
            80.0,
            "gte",
        )
        self.assertIsNotNone(derived)
        self.assertEqual(derived["period"], "202502")
        self.assertEqual(derived["numerator"], 1)
        self.assertEqual(derived["denominator"], 2)
        self.assertEqual(derived["value"], 50.0)

    def test_planner_creates_one_action_per_requested_antigen(self):
        plan = AnalysisPlanner().create_plan({
            "question": "Quel est le taux de perte BCG, Penta et PCV-13 en 2025 ?",
            "entities": {},
        })
        self.assertEqual(plan["qid"], "taux_perte_vaccins")
        self.assertEqual(len(plan["executable_actions"]), 3)
        self.assertEqual(
            [action["args"]["antigens"][0] for action in plan["executable_actions"]],
            ["bcg", "penta", "pcv13"],
        )

    def test_agent_analysis_path_uses_deterministic_planner(self):
        result = planner({
            "messages": [HumanMessage(content="Proportion de ZS avec Penta3 >= 80 % en mars 2025")],
            "intent": "ANALYZE",
            "entities": {
                "geography": "provinces",
                "periods": ["202503"],
                "geographic_levels": ["health_zone"],
                "breakdown": "health_zone",
            },
            "last_analysis_context": None,
        })
        self.assertEqual(result["qid"], "proportion_couverture_penta3_seuil")
        self.assertEqual(result["actions"][0]["args"]["orgUnitId"], "ymGeqzoPhN3")
        self.assertEqual(result["actions"][0]["args"]["targetOrgUnitLevel"], 3)
        self.assertIn("response_contract", result)

    def test_planner_builds_deterministic_action_and_contract(self):
        plan = AnalysisPlanner().create_plan({
            "question": "Quelle est la proportion de ZS ayant une couverture Penta3 >= 80 % ?",
            "entities": {"period": "202503", "geography": "provinces"},
        })
        self.assertEqual(plan["qid"], "proportion_couverture_penta3_seuil")
        self.assertEqual(plan["analysis_type"], "threshold_proportion")
        self.assertEqual(plan["response_contract"]["threshold"], 80.0)
        action = plan["executable_actions"][0]
        self.assertEqual(action["action"], "run_dhis2_analysis")
        self.assertEqual(action["args"]["periods"], ["202503"])
        self.assertEqual(action["args"]["metricId"], "v9b9aYsA5PM")
        self.assertEqual(action["args"]["comparisonOperator"], "gte")
        self.assertEqual(action["args"]["renderType"], "ranking_answer")


if __name__ == "__main__":
    unittest.main()
