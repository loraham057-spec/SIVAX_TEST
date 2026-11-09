from __future__ import annotations

import unittest

from app.agents.clarification_engine import (
    apply_clarification_answer,
    assess_completeness,
    decide,
    detect_ambiguities,
    suggest_followups,
)


class AssessCompletenessTests(unittest.TestCase):
    def test_complete_when_qid_and_slots_present(self):
        entities = {
            "antigens": ["penta3"],
            "periods": ["202501", "202502"],
            "geography": "Kinshasa",
            "threshold": 80.0,
        }
        result = assess_completeness(entities, "proportion_couverture_penta3_seuil")
        self.assertTrue(result["complete"])
        self.assertEqual(result["missing_slots"], [])
        self.assertEqual(result["inferred_defaults"], {})

    def test_missing_indicator_is_hard_required(self):
        result = assess_completeness({"periods": ["202501"]}, None)
        self.assertFalse(result["complete"])
        self.assertIn("indicator", result["missing_slots"])

    def test_missing_period_and_geography_yield_defaults(self):
        result = assess_completeness({"antigens": ["bcg"]}, None)
        self.assertTrue(result["complete"])
        self.assertEqual(result["inferred_defaults"]["period"], "LAST_12_MONTHS")
        self.assertEqual(result["inferred_defaults"]["geography"], "national")

    def test_threshold_defaults_from_catalog(self):
        entities = {"antigens": ["penta3"], "periods": ["202501"], "geography": "national"}
        result = assess_completeness(entities, "proportion_couverture_penta3_seuil")
        self.assertTrue(result["complete"])
        self.assertEqual(result["inferred_defaults"].get("threshold"), 80.0)

    def test_trace_records_every_slot(self):
        result = assess_completeness({"antigens": ["bcg"]}, None)
        slots = {item["slot"] for item in result["trace"]}
        self.assertIn("indicator", slots)
        self.assertIn("period", slots)
        self.assertIn("geography", slots)


class DetectAmbiguitiesTests(unittest.TestCase):
    def test_partial_kasai_is_ambiguous(self):
        ambiguities = detect_ambiguities("couverture penta3 au Kasaï", {"antigens": ["penta3"]})
        geo = [a for a in ambiguities if a["slot"] == "geography"]
        self.assertEqual(len(geo), 1)
        labels = [o["label"] for o in geo[0]["options"]]
        self.assertIn("Kasaï-Central", labels)

    def test_full_province_name_not_ambiguous(self):
        ambiguities = detect_ambiguities(
            "couverture penta3 au Kasaï Central", {"antigens": ["penta3"]}
        )
        self.assertEqual([a for a in ambiguities if a["slot"] == "geography"], [])

    def test_zero_dose_without_count_or_proportion(self):
        ambiguities = detect_ambiguities("les enfants zéro dose en 2025", {})
        slots = [a["slot"] for a in ambiguities]
        self.assertIn("measurement_type", slots)

    def test_zero_dose_with_nombre_not_ambiguous(self):
        ambiguities = detect_ambiguities("le nombre d'enfants zéro dose en 2025", {})
        self.assertEqual([a for a in ambiguities if a["slot"] == "measurement_type"], [])

    def test_les_cas_without_type(self):
        ambiguities = detect_ambiguities("donne-moi les cas de paludisme", {})
        slots = [a["slot"] for a in ambiguities]
        self.assertIn("measurement_type", slots)

    def test_penta_without_dose_when_coverage(self):
        ambiguities = detect_ambiguities(
            "quelle est la couverture penta ?", {"antigens": ["penta"]}
        )
        slots = [a["slot"] for a in ambiguities]
        self.assertIn("antigen_dose", slots)


class DecideTests(unittest.TestCase):
    def test_proceed_when_everything_specified(self):
        entities = {
            "antigens": ["penta3"],
            "periods": ["202501"],
            "geography": "Kinshasa",
        }
        decision = decide("couverture penta3 à Kinshasa en janvier 2025", entities)
        self.assertEqual(decision["action"], "PROCEED")

    def test_proceed_with_defaults_when_period_missing(self):
        entities = {"antigens": ["penta3"], "geography": "Kinshasa"}
        decision = decide("couverture penta3 à Kinshasa", entities)
        self.assertEqual(decision["action"], "PROCEED_WITH_DEFAULTS")
        self.assertEqual(decision["assumptions"]["period"], "LAST_12_MONTHS")

    def test_clarify_when_no_indicator(self):
        decision = decide("donne-moi une analyse", {})
        self.assertEqual(decision["action"], "CLARIFY")
        request = decision["clarification_request"]
        self.assertEqual(request["slot"], "indicator")
        self.assertTrue(request["options"])

    def test_clarify_prioritizes_indicator_over_geography(self):
        decision = decide("analyse au Kasaï", {})
        self.assertEqual(decision["action"], "CLARIFY")
        self.assertEqual(decision["clarification_request"]["slot"], "indicator")

    def test_clarify_measurement_for_zero_dose(self):
        entities = {"population": "enfants de 0 à 11 mois sans Penta1"}
        decision = decide("les enfants zéro dose", entities)
        self.assertEqual(decision["action"], "CLARIFY")
        self.assertEqual(decision["clarification_request"]["slot"], "measurement_type")

    def test_inherited_context_prevents_clarification(self):
        # After the context resolver ran, entities contain inherited slots —
        # a follow-up must NOT re-trigger a clarification.
        entities = {
            "indicator_keywords": ["Couverture Penta3"],
            "metric_id": "v9b9aYsA5PM",
            "periods": ["202501", "202502"],
            "geography": "National",
        }
        decision = decide("et pour Kinshasa ?", entities)
        self.assertIn(decision["action"], ("PROCEED", "PROCEED_WITH_DEFAULTS"))

    def test_partial_understanding_in_request(self):
        entities = {"antigens": ["penta"], "geography": "Kinshasa"}
        decision = decide("couverture penta à Kinshasa", entities)
        self.assertEqual(decision["action"], "CLARIFY")
        request = decision["clarification_request"]
        self.assertEqual(request["slot"], "antigen_dose")
        self.assertIn("Kinshasa", request["partial_understanding"])


class ApplyClarificationAnswerTests(unittest.TestCase):
    PENDING = {
        "slot": "measurement_type",
        "question": "Souhaitez-vous un nombre ou une proportion ?",
        "options": [
            {"label": "Nombre d'enfants", "value": "count"},
            {"label": "Proportion (%)", "value": "proportion"},
        ],
        "partial_entities": {"population": "enfants de 0 à 11 mois sans Penta1"},
    }

    def test_matches_option_label(self):
        answer = apply_clarification_answer("le nombre d'enfants", self.PENDING)
        self.assertTrue(answer["matched"])
        self.assertEqual(answer["value"], "count")
        self.assertEqual(answer["entities"]["measurement_type"], "count")
        # Partial entities are preserved
        self.assertIn("population", answer["entities"])

    def test_matches_short_reply(self):
        answer = apply_clarification_answer("proportion", self.PENDING)
        self.assertTrue(answer["matched"])
        self.assertEqual(answer["value"], "proportion")

    def test_unrelated_message_not_matched(self):
        answer = apply_clarification_answer(
            "quelle est la couverture BCG au Nord-Kivu ?", self.PENDING
        )
        self.assertFalse(answer["matched"])

    def test_antigen_dose_both_selected(self):
        pending = {
            "slot": "antigen_dose",
            "options": [
                {"label": "Penta 1", "value": "penta1"},
                {"label": "Penta 3", "value": "penta3"},
                {"label": "Les deux", "value": "penta1,penta3"},
            ],
            "partial_entities": {},
        }
        answer = apply_clarification_answer("les deux", pending)
        self.assertTrue(answer["matched"])
        self.assertEqual(answer["entities"]["antigens"], ["penta1", "penta3"])

    def test_geography_option(self):
        pending = {
            "slot": "geography",
            "options": [
                {"label": "Kasaï", "value": "Kasaï"},
                {"label": "Kasaï-Central", "value": "Kasaï-Central"},
            ],
            "partial_entities": {"antigens": ["penta3"]},
        }
        answer = apply_clarification_answer("Kasaï-Central", pending)
        self.assertTrue(answer["matched"])
        self.assertEqual(answer["entities"]["geography"], "Kasaï-Central")


class SuggestFollowupsTests(unittest.TestCase):
    def test_situation_suggests_breakdown_and_trend(self):
        suggestions = suggest_followups(
            "proportion_couverture_penta3_seuil",
            {"analysis_depth": "situation"},
        )
        self.assertTrue(suggestions)
        self.assertLessEqual(len(suggestions), 3)
        messages = [s["message"] for s in suggestions]
        self.assertTrue(any("province" in m for m in messages))

    def test_province_breakdown_suggests_zone_detail(self):
        suggestions = suggest_followups(
            None, {"analysis_depth": "situation", "breakdown": "province"}
        )
        self.assertEqual(suggestions[0]["message"], "par zone de santé")

    def test_no_duplicates(self):
        suggestions = suggest_followups(
            "proportion_couverture_penta3_seuil", {"analysis_depth": "situation"}
        )
        messages = [s["message"] for s in suggestions]
        self.assertEqual(len(messages), len(set(messages)))


if __name__ == "__main__":
    unittest.main()
