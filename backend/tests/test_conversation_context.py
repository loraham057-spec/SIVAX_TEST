from __future__ import annotations

import unittest

from app.agents.conversation_context import (
    classify_followup,
    is_followup,
    resolve_context,
)


def _ctx(**overrides):
    base = {
        "metric_id": "v9b9aYsA5PM",
        "metric_name": "Couverture Penta3",
        "org_unit_id": "ymGeqzoPhN3",
        "org_unit_name": "National",
        "periods": ["202501", "202502", "202503"],
        "breakdown": None,
        "geographic_levels": None,
        "target_org_unit_level": None,
        "measurement_type": "proportion",
        "population": "children_under_1",
        "threshold": 80.0,
        "comparison_operator": ">=",
        "antigens": ["penta3"],
        "periodicity": "monthly",
        "analysis_depth": "standard",
    }
    base.update(overrides)
    return base


class IsFollowupTests(unittest.TestCase):
    def test_short_ellipsis_is_followup(self):
        self.assertTrue(is_followup("et a Kinshasa ?"))

    def test_jusqua_is_followup(self):
        self.assertTrue(is_followup("jusqu'a juillet"))

    def test_pareil_is_followup(self):
        self.assertTrue(is_followup("pareil pour le Kongo"))

    def test_compare_is_followup(self):
        self.assertTrue(is_followup("compare avec le Nord-Kivu"))

    def test_et_les_deux_is_followup(self):
        self.assertTrue(is_followup("et les deux ?"))

    def test_full_question_is_not_followup(self):
        self.assertFalse(is_followup(
            "Quelle est la proportion de ZS ayant une couverture Penta3 >= 80% en 2025 ?"
        ))


class ResolveContextTests(unittest.TestCase):
    def test_no_previous_context_returns_entities_untouched(self):
        entities = {"indicator_keywords": ["Penta3"]}
        resolved, summary = resolve_context("et pour Kinshasa ?", entities, None)
        self.assertEqual(resolved, entities)
        self.assertEqual(summary, "")

    def test_inherits_indicator_from_previous(self):
        resolved, _ = resolve_context("montre l evolution", {}, _ctx())
        self.assertEqual(resolved["indicator_keywords"], ["Couverture Penta3"])
        self.assertEqual(resolved["metric_id"], "v9b9aYsA5PM")

    def test_inherits_geography_when_not_specified(self):
        resolved, _ = resolve_context("montre l evolution", {}, _ctx())
        self.assertEqual(resolved["geography"], "National")
        self.assertEqual(resolved["org_unit_id"], "ymGeqzoPhN3")

    def test_explicit_geography_replaces_previous(self):
        resolved, _ = resolve_context("et pour Kinshasa ?", {}, _ctx())
        self.assertEqual(resolved["geography"], "Kinshasa")
        self.assertNotIn("org_unit_id", resolved)

    def test_single_period_inheritance_keeps_scalar_safe(self):
        ctx = _ctx(periods=["202503"])
        resolved, _ = resolve_context("montre la tendance", {}, ctx)
        self.assertEqual(resolved["periods"], ["202503"])
        self.assertNotIsInstance(resolved.get("period"), list)

    def test_multi_period_inheritance_does_not_corrupt_period(self):
        resolved, _ = resolve_context("montre la tendance", {}, _ctx())
        self.assertEqual(resolved["periods"], ["202501", "202502", "202503"])
        # period must never be a list
        self.assertNotIsInstance(resolved.get("period"), list)

    def test_explicit_period_override(self):
        resolved, _ = resolve_context("en avril 2025", {}, _ctx())
        self.assertEqual(resolved["periods"], ["202504"])

    def test_jusqua_extends_previous_periods(self):
        resolved, _ = resolve_context("jusqu a juillet", {}, _ctx())
        self.assertEqual(resolved["periods"], ["202501", "202502", "202503", "202504", "202505", "202506", "202507"])

    def test_depuis_extends_previous_periods(self):
        resolved, _ = resolve_context("depuis janvier", {}, _ctx())
        self.assertEqual(resolved["periods"], ["202501", "202502", "202503"])

    def test_breakdown_by_province(self):
        resolved, _ = resolve_context("par province", {}, _ctx())
        self.assertEqual(resolved["breakdown"], "province")
        self.assertEqual(resolved["target_org_unit_level"], 2)
        self.assertEqual(resolved["geography"], "national")

    def test_breakdown_by_zone(self):
        resolved, _ = resolve_context("par zone de sante", {}, _ctx())
        self.assertEqual(resolved["breakdown"], "health_zone")
        self.assertEqual(resolved["target_org_unit_level"], 3)

    def test_comparison_baseline_recorded(self):
        resolved, _ = resolve_context("compare avec le Kongo Central", {}, _ctx())
        self.assertEqual(resolved["comparison_mode"], "previous_analysis")
        baseline = resolved["comparison_baseline"]
        self.assertEqual(baseline["metric_id"], "v9b9aYsA5PM")
        self.assertEqual(baseline["org_unit_id"], "ymGeqzoPhN3")

    def test_year_only_generates_twelve_periods(self):
        resolved, _ = resolve_context("en 2024", {}, _ctx())
        self.assertEqual(resolved["periods"], [f"2024{m:02d}" for m in range(1, 13)])

    def test_inherits_threshold_and_measurement_type(self):
        resolved, _ = resolve_context("montre la tendance", {}, _ctx())
        self.assertEqual(resolved["threshold"], 80.0)
        self.assertEqual(resolved["measurement_type"], "proportion")

    def test_explicit_entities_override_inherited(self):
        entities = {"indicator_keywords": ["BCG"], "metric_id": "cWJXYKCXrLx"}
        resolved, _ = resolve_context("et pour Kinshasa ?", entities, _ctx())
        self.assertEqual(resolved["indicator_keywords"], ["BCG"])
        self.assertEqual(resolved["metric_id"], "cWJXYKCXrLx")

    def test_resolution_trace_present(self):
        resolved, _ = resolve_context("et pour Kinshasa ?", {}, _ctx())
        trace = resolved["context_resolution"]["trace"]
        self.assertTrue(any(item["field"] == "geography" for item in trace))
        self.assertEqual(resolved["context_resolution"]["version"], "2.0")

    def test_empty_context_handled(self):
        resolved, summary = resolve_context("et pour Kinshasa ?", {}, {})
        # No previous data to inherit, but geography override still applies
        self.assertEqual(resolved.get("geography"), "Kinshasa")


if __name__ == "__main__":
    unittest.main()
