"""
Tests for the evaluation framework (app.eval).

These tests cover:
- Ground-truth sampling structure
- Question generation (templates, misspelling, period variants)
- Pipeline trace structure
- Multi-layer diagnostic first-failure classification
- Auto-correction artifact generation
- Regression comparison
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from app.eval.diagnostic import (
    DiagnosticReport,
    LayerResult,
    diagnose,
)
from app.eval.pipeline_runner import PipelineTrace
from app.eval.question_generator import (
    GroundTruth,
    TestCase,
    _misspell,
    _period_variants,
    generate_test_cases,
)
from app.eval.auto_correct import build_eval_report, EvalReport


# ─── Helpers ───

def _make_gt(**overrides) -> GroundTruth:
    defaults = dict(
        indicator_id="cWJXYKCXrLx",
        indicator_label="Taux de couverture en BCG",
        org_unit_id="dJ3v8xc6ZIK",
        org_unit_name="Lualaba Province",
        org_unit_level=2,
        period="202607",
        value=85.3,
        antigen="BCG",
        province_name=None,
    )
    defaults.update(overrides)
    return GroundTruth(**defaults)


def _make_trace(**overrides) -> PipelineTrace:
    defaults = dict(
        question="Quelle est la couverture BCG dans le Lualaba en juillet 2026 ?",
        strategy="simple",
        intent="ANALYZE",
        confidence=0.90,
        extracted_entities={
            "indicator_keywords": ["BCG", "couverture"],
            "antigens": ["BCG"],
            "geography": "Lualaba",
            "periods": ["202607"],
        },
        clarification_action="PROCEED",
        clarification_request=None,
        planned_actions=[{"tool": "dhis2_analytics", "params": {"dx": "cWJXYKCXrLx"}}],
        tool_results=[{"status": "success", "rows": [{"value": 85.3}]}],
        response_status="complete",
        response_text="La couverture BCG au Lualaba en juillet 2026 est de 85.3%.",
        error=None,
        elapsed_seconds=1.5,
        expected={
            "indicator_id": "cWJXYKCXrLx",
            "indicator_label": "Taux de couverture en BCG",
            "org_unit_id": "dJ3v8xc6ZIK",
            "org_unit_name": "Lualaba Province",
            "period": "202607",
            "value": 85.3,
        },
    )
    defaults.update(overrides)
    return PipelineTrace(**defaults)


# ─── Question Generator Tests ───

class TestMisspell:
    """Test the _misspell function."""

    def test_misspell_changes_string(self):
        result = _misspell("Lualaba")
        assert result != "Lualaba"
        assert len(result) > 0

    def test_misspell_preserves_length_approximately(self):
        original = "Kinshasa"
        result = _misspell(original)
        assert abs(len(result) - len(original)) <= 2

    def test_misspell_short_string(self):
        """Short strings should still produce a result."""
        result = _misspell("BCG")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_misspell_empty_string(self):
        result = _misspell("")
        assert result == ""


class TestPeriodVariants:
    """Test the _period_variants function."""

    def test_period_variants_july_2026(self):
        variants = _period_variants("202607")
        assert "juillet 2026" in variants
        assert "07/2026" in variants
        assert "T3 2026" in variants

    def test_period_variants_january(self):
        variants = _period_variants("202601")
        assert "janvier 2026" in variants

    def test_period_variants_december(self):
        variants = _period_variants("202612")
        assert "décembre 2026" in variants


class TestGenerateTestCases:
    """Test the generate_test_cases function."""

    def test_generates_multiple_strategies(self):
        gt = _make_gt()
        cases = generate_test_cases([gt], max_per_gt=10)
        strategies = {c.strategy for c in cases}
        assert "simple" in strategies
        assert "english" in strategies
        assert "period_var" in strategies

    def test_simple_question_format(self):
        gt = _make_gt()
        cases = generate_test_cases([gt], max_per_gt=10)
        simple = next(c for c in cases if c.strategy == "simple")
        assert "Lualaba" in simple.question
        assert "juillet 2026" in simple.question

    def test_english_question_format(self):
        gt = _make_gt()
        cases = generate_test_cases([gt], max_per_gt=10)
        english = next(c for c in cases if c.strategy == "english")
        assert "Lualaba" in english.question

    def test_misspelled_question_different(self):
        gt = _make_gt()
        cases = generate_test_cases([gt], max_per_gt=10)
        misspelled = [c for c in cases if c.strategy == "misspelled"]
        if misspelled:
            # The misspelled geography should differ from the original
            assert misspelled[0].question != next(
                c.question for c in cases if c.strategy == "simple"
            )

    def test_complex_question_only_for_province(self):
        gt = _make_gt(org_unit_level=2)
        cases = generate_test_cases([gt], max_per_gt=10)
        complex_cases = [c for c in cases if c.strategy == "complex"]
        assert len(complex_cases) >= 1

    def test_complex_question_not_for_zs(self):
        gt = _make_gt(org_unit_level=3)
        cases = generate_test_cases([gt], max_per_gt=10)
        complex_cases = [c for c in cases if c.strategy == "complex"]
        assert len(complex_cases) == 0

    def test_test_case_carries_expected_values(self):
        gt = _make_gt()
        cases = generate_test_cases([gt], max_per_gt=10)
        for tc in cases:
            assert tc.expected_indicator_id == "cWJXYKCXrLx"
            assert tc.expected_org_unit_id == "dJ3v8xc6ZIK"
            assert tc.expected_period == "202607"
            assert tc.expected_value == 85.3

    def test_stock_indicator_uses_le_not_la(self):
        """Non-coverage indicators should use 'le' not 'la couverture'."""
        gt = _make_gt(indicator_label="Penta — Stock disponible utilisable (SDU)")
        cases = generate_test_cases([gt], max_per_gt=10)
        simple = next(c for c in cases if c.strategy == "simple")
        assert "le " in simple.question.lower()
        assert "la couverture" not in simple.question.lower() or "Stock" in simple.question


# ─── Diagnostic Tests ───

class TestDiagnosticIntent:
    """Layer 1: Intent classification."""

    def test_pass_analyze(self):
        trace = _make_trace(intent="ANALYZE")
        report = diagnose(trace)
        assert report.layers[0].passed
        assert report.layers[0].layer == "intent"

    def test_pass_challenge(self):
        trace = _make_trace(intent="CHALLENGE")
        report = diagnose(trace)
        assert report.layers[0].passed

    def test_fail_chat(self):
        trace = _make_trace(intent="CHAT")
        report = diagnose(trace)
        assert not report.layers[0].passed
        assert report.first_failure_layer == "intent"

    def test_fail_pipeline_error(self):
        trace = _make_trace(intent=None, error="TypeError: something")
        report = diagnose(trace)
        assert not report.layers[0].passed
        assert "Pipeline error" in report.layers[0].message


class TestDiagnosticExtraction:
    """Layer 2: Entity extraction (semantic check)."""

    def test_pass_matching_keywords(self):
        trace = _make_trace()
        report = diagnose(trace)
        extraction = report.layers[1]
        assert extraction.passed

    def test_fail_no_keywords(self):
        trace = _make_trace(extracted_entities={"indicator_keywords": [], "antigens": []})
        report = diagnose(trace)
        assert not report.layers[1].passed

    def test_fail_wrong_keywords(self):
        trace = _make_trace(extracted_entities={
            "indicator_keywords": ["rougeole", " rougeole"],
            "antigens": ["rougeole"],
            "geography": "Lualaba",
            "periods": ["202607"],
        })
        report = diagnose(trace)
        assert not report.layers[1].passed
        assert "indicator" in report.layers[1].message.lower()

    def test_pass_metric_id_match(self):
        trace = _make_trace(extracted_entities={
            "indicator_keywords": [],
            "antigens": [],
            "metric_id": "cWJXYKCXrLx",
            "geography": "Lualaba",
            "periods": ["202607"],
        })
        report = diagnose(trace)
        assert report.layers[1].passed

    def test_fail_metric_id_mismatch(self):
        trace = _make_trace(extracted_entities={
            "indicator_keywords": [],
            "antigens": [],
            "metric_id": "wrongId12345",
            "geography": "Lualaba",
            "periods": ["202607"],
        })
        report = diagnose(trace)
        assert not report.layers[1].passed

    def test_pass_geography_overlap(self):
        trace = _make_trace(extracted_entities={
            "indicator_keywords": ["BCG"],
            "antigens": ["BCG"],
            "geography": "Lualaba Province",
            "periods": ["202607"],
        })
        report = diagnose(trace)
        assert report.layers[1].passed

    def test_fail_geography_no_overlap(self):
        trace = _make_trace(extracted_entities={
            "indicator_keywords": ["BCG"],
            "antigens": ["BCG"],
            "geography": "Kinshasa",
            "periods": ["202607"],
        })
        report = diagnose(trace)
        assert not report.layers[1].passed
        assert "geography" in report.layers[1].message.lower()

    def test_fail_period_mismatch(self):
        trace = _make_trace(extracted_entities={
            "indicator_keywords": ["BCG"],
            "antigens": ["BCG"],
            "geography": "Lualaba",
            "periods": ["202608"],
        })
        report = diagnose(trace)
        assert not report.layers[1].passed
        assert "period" in report.layers[1].message.lower()


class TestDiagnosticClarification:
    """Layer 3: Clarification blocking."""

    def test_pass_proceed(self):
        trace = _make_trace(clarification_action="PROCEED")
        report = diagnose(trace)
        assert report.layers[2].passed

    def test_fail_clarify(self):
        trace = _make_trace(
            clarification_action="CLARIFY",
            clarification_request={"slot": "geography"},
        )
        report = diagnose(trace)
        assert not report.layers[2].passed
        assert "geography" in report.layers[2].message

    def test_fail_clarify_metric(self):
        trace = _make_trace(
            clarification_action="CLARIFY",
            clarification_request={"slot": "metric"},
        )
        report = diagnose(trace)
        assert not report.layers[2].passed
        assert "metric" in report.layers[2].message


class TestDiagnosticPlanning:
    """Layer 4: Planning."""

    def test_pass_with_actions(self):
        trace = _make_trace()
        report = diagnose(trace)
        assert report.layers[3].passed

    def test_skip_when_clarification(self):
        trace = _make_trace(clarification_action="CLARIFY",
                            clarification_request={"slot": "geography"},
                            planned_actions=[])
        report = diagnose(trace)
        assert report.layers[3].passed
        assert "Skipped" in report.layers[3].message

    def test_fail_no_actions_no_clarification(self):
        trace = _make_trace(planned_actions=[])
        report = diagnose(trace)
        assert not report.layers[3].passed


class TestDiagnosticTool:
    """Layer 5: Tool execution."""

    def test_pass_with_data(self):
        trace = _make_trace()
        report = diagnose(trace)
        assert report.layers[4].passed

    def test_skip_when_clarification(self):
        trace = _make_trace(clarification_action="CLARIFY",
                            clarification_request={"slot": "geography"},
                            tool_results=[])
        report = diagnose(trace)
        assert report.layers[4].passed

    def test_fail_no_results(self):
        trace = _make_trace(tool_results=[])
        report = diagnose(trace)
        assert not report.layers[4].passed

    def test_fail_empty_results(self):
        trace = _make_trace(tool_results=[{"status": "success", "rows": []}],
                            response_text="Aucune donnée disponible pour cette période.")
        report = diagnose(trace)
        assert not report.layers[4].passed


class TestDiagnosticResponse:
    """Layer 6: Response grounding."""

    def test_pass_value_in_response(self):
        trace = _make_trace()
        report = diagnose(trace)
        assert report.layers[5].passed

    def test_pass_clarification_response(self):
        trace = _make_trace(response_status="awaiting_clarification")
        report = diagnose(trace)
        assert report.layers[5].passed

    def test_fail_value_not_in_response(self):
        trace = _make_trace(response_text="Aucune donnée disponible.")
        report = diagnose(trace)
        assert not report.layers[5].passed

    def test_fail_no_response_text(self):
        trace = _make_trace(response_text="")
        report = diagnose(trace)
        assert not report.layers[5].passed

    def test_pass_value_with_comma(self):
        trace = _make_trace(
            expected={"value": 85.3, "indicator_id": "cWJXYKCXrLx",
                       "indicator_label": "Taux de couverture en BCG",
                       "org_unit_id": "dJ3v8xc6ZIK", "org_unit_name": "Lualaba Province",
                       "period": "202607"},
            response_text="La couverture est de 85,3%.",
        )
        report = diagnose(trace)
        assert report.layers[5].passed

    def test_pass_integer_value(self):
        trace = _make_trace(
            expected={"value": 100.0, "indicator_id": "cWJXYKCXrLx",
                       "indicator_label": "Taux de couverture en BCG",
                       "org_unit_id": "dJ3v8xc6ZIK", "org_unit_name": "Lualaba Province",
                       "period": "202607"},
            response_text="Le taux est de 100%.",
        )
        report = diagnose(trace)
        assert report.layers[5].passed


class TestDiagnosticReport:
    """Test the overall diagnostic report structure."""

    def test_all_pass(self):
        trace = _make_trace()
        report = diagnose(trace)
        assert report.overall_passed
        assert report.first_failure_layer is None
        assert report.error_category == "pass"

    def test_first_failure_is_earliest(self):
        trace = _make_trace(intent="CHAT")
        report = diagnose(trace)
        assert report.first_failure_layer == "intent"
        # Later layers may also fail, but first_failure should be intent
        assert report.error_category == "intent"

    def test_to_dict_structure(self):
        trace = _make_trace()
        report = diagnose(trace)
        d = report.to_dict()
        assert "question" in d
        assert "strategy" in d
        assert "overall_passed" in d
        assert "layers" in d
        assert len(d["layers"]) == 6

    def test_to_dict_json_serializable(self):
        trace = _make_trace()
        report = diagnose(trace)
        d = report.to_dict()
        json.dumps(d)  # Should not raise


# ─── Auto-Correction / Report Tests ───

class TestEvalReport:
    """Test the build_eval_report function."""

    def test_empty_reports(self):
        report = build_eval_report([])
        assert isinstance(report, EvalReport)

    def test_all_pass(self):
        trace = _make_trace()
        reports = [diagnose(trace)] * 5
        report = build_eval_report(reports)
        text = report.summary_text()
        assert "Passed: 5" in text
        assert "Failed: 0" in text

    def test_mixed_results(self):
        pass_trace = _make_trace()
        fail_trace = _make_trace(intent="CHAT")
        reports = [diagnose(pass_trace), diagnose(fail_trace)]
        report = build_eval_report(reports)
        text = report.summary_text()
        assert "Passed: 1" in text
        assert "Failed: 1" in text
        assert "intent" in text

    def test_error_category_breakdown(self):
        traces = [
            _make_trace(),  # pass
            _make_trace(intent="CHAT"),  # intent error
            _make_trace(clarification_action="CLARIFY",
                        clarification_request={"slot": "geography"}),  # clarification error
        ]
        reports = [diagnose(t) for t in traces]
        report = build_eval_report(reports)
        text = report.summary_text()
        assert "intent" in text
        assert "clarification" in text

    def test_strategy_breakdown(self):
        traces = [
            _make_trace(strategy="simple"),
            _make_trace(strategy="english", intent="CHAT"),
        ]
        reports = [diagnose(t) for t in traces]
        report = build_eval_report(reports)
        text = report.summary_text()
        assert "simple" in text
        assert "english" in text

    def test_corrections_list(self):
        fail_trace = _make_trace(intent="CHAT")
        reports = [diagnose(fail_trace)]
        report = build_eval_report(reports)
        assert len(report.corrections) >= 1
        assert report.corrections[0].error_category == "intent"

    def test_to_dict_structure(self):
        trace = _make_trace()
        reports = [diagnose(trace)]
        report = build_eval_report(reports)
        d = report.to_dict()
        assert "total" in d
        assert "passed" in d
        assert "failed" in d
        assert "pass_rate" in d

    def test_to_dict_json_serializable(self):
        trace = _make_trace()
        reports = [diagnose(trace)]
        report = build_eval_report(reports)
        json.dumps(report.to_dict())  # Should not raise


# ─── Regression Comparison Tests ───

class TestRegressionComparison:
    """Test that two reports can be compared for regression detection."""

    def test_no_regression_when_same(self):
        trace = _make_trace()
        reports1 = [diagnose(trace)]
        reports2 = [diagnose(trace)]
        report1 = build_eval_report(reports1)
        report2 = build_eval_report(reports2)
        # Same pass rate = no regression
        assert report1.to_dict()["pass_rate"] == report2.to_dict()["pass_rate"]

    def test_regression_detected_when_pass_rate_drops(self):
        pass_trace = _make_trace()
        fail_trace = _make_trace(intent="CHAT")
        report1 = build_eval_report([diagnose(pass_trace)])
        report2 = build_eval_report([diagnose(fail_trace)])
        assert report2.to_dict()["pass_rate"] < report1.to_dict()["pass_rate"]

    def test_improvement_detected_when_pass_rate_rises(self):
        pass_trace = _make_trace()
        fail_trace = _make_trace(intent="CHAT")
        report1 = build_eval_report([diagnose(fail_trace)])
        report2 = build_eval_report([diagnose(pass_trace)])
        assert report2.to_dict()["pass_rate"] > report1.to_dict()["pass_rate"]


# ─── GroundTruth Dataclass Tests ───

class TestGroundTruth:
    """Test the GroundTruth dataclass."""

    def test_period_text_july(self):
        gt = _make_gt(period="202607")
        assert gt.period_text == "juillet 2026"

    def test_period_text_january(self):
        gt = _make_gt(period="202601")
        assert gt.period_text == "janvier 2026"

    def test_period_text_december(self):
        gt = _make_gt(period="202612")
        assert gt.period_text == "décembre 2026"

    def test_period_text_invalid(self):
        gt = _make_gt(period="invalid")
        assert gt.period_text == "invalid"


# ─── PipelineTrace Structure Tests ───

class TestPipelineTrace:
    """Test the PipelineTrace dataclass structure."""

    def test_trace_has_all_fields(self):
        trace = _make_trace()
        assert hasattr(trace, "question")
        assert hasattr(trace, "intent")
        assert hasattr(trace, "extracted_entities")
        assert hasattr(trace, "clarification_action")
        assert hasattr(trace, "planned_actions")
        assert hasattr(trace, "tool_results")
        assert hasattr(trace, "response_text")
        assert hasattr(trace, "error")
        assert hasattr(trace, "elapsed_seconds")
        assert hasattr(trace, "expected")

    def test_trace_expected_carrythrough(self):
        trace = _make_trace()
        assert trace.expected["indicator_id"] == "cWJXYKCXrLx"
        assert trace.expected["period"] == "202607"


# ─── Auto-Correction Wiring Tests ───

class TestAutoCorrectionWiring:
    """Test that the corrections store is properly wired into the agent."""

    def test_load_few_shot_examples_empty(self):
        from app.eval.auto_correct import load_few_shot_examples
        examples = load_few_shot_examples()
        assert isinstance(examples, list)

    def test_load_geo_aliases_empty(self):
        from app.eval.auto_correct import load_geo_aliases
        aliases = load_geo_aliases()
        assert isinstance(aliases, list)

    def test_load_metric_defaults_empty(self):
        from app.eval.auto_correct import load_metric_defaults
        defaults = load_metric_defaults()
        assert isinstance(defaults, list)

    def test_applied_correction_to_dict(self):
        from app.eval.auto_correct import AppliedCorrection
        ac = AppliedCorrection(
            timestamp="2026-01-01T00:00:00Z",
            correction_type="few_shot",
            description="test",
        )
        d = ac.to_dict()
        assert d["correction_type"] == "few_shot"
        assert d["description"] == "test"

    def test_eval_report_has_applied_field(self):
        trace = _make_trace()
        reports = [diagnose(trace)]
        report = build_eval_report(reports, apply=False)
        assert hasattr(report, "applied")
        assert report.applied == []

    def test_eval_report_to_dict_includes_applied(self):
        trace = _make_trace()
        reports = [diagnose(trace)]
        report = build_eval_report(reports, apply=False)
        d = report.to_dict()
        assert "applied" in d


class TestFuzzyPenaltyFix:
    """Test the phonetic-only penalty in fuzzy_similarity."""

    def test_phonetic_only_penalty_reduces_score(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        # "mutena" vs "mutwanga" — same Soundex but different words
        # Before fix: 1.0, after fix: < 0.7
        score = fuzzy_similarity("mutena", "mutwanga")
        assert score < 0.7, f"Expected < 0.7, got {score}"

    def test_genuine_misspelling_preserved(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        # "lwalaba" vs "lualaba" — genuine misspelling, should stay high
        score = fuzzy_similarity("lwalaba", "lualaba")
        assert score >= 0.8, f"Expected >= 0.8, got {score}"

    def test_exact_match_still_one(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        assert fuzzy_similarity("mutena", "mutena") == 1.0

    def test_congo_not_kongo(self):
        from app.agents.fuzzy_matching import fuzzy_similarity
        # "congo" vs "kongo" — phonetically similar but different
        score = fuzzy_similarity("congo", "kongo")
        assert score < 0.9, f"Expected < 0.9, got {score}"


class TestNationalAliases:
    """Test national-level geography resolution."""

    def test_rdc_resolves_national(self):
        from app.agents.geo_resolution import resolve_geography_smart, NATIONAL_OU
        r = resolve_geography_smart("RDC")
        assert r["status"] == "resolved"
        assert r["org_unit_id"] == NATIONAL_OU

    def test_congo_resolves_national(self):
        from app.agents.geo_resolution import resolve_geography_smart, NATIONAL_OU
        r = resolve_geography_smart("Congo")
        assert r["status"] == "resolved"
        assert r["org_unit_id"] == NATIONAL_OU

    def test_full_name_resolves_national(self):
        from app.agents.geo_resolution import resolve_geography_smart, NATIONAL_OU
        r = resolve_geography_smart("République démocratique du Congo")
        assert r["status"] == "resolved"
        assert r["org_unit_id"] == NATIONAL_OU

    def test_national_stays_generic(self):
        from app.agents.geo_resolution import resolve_geography_smart
        r = resolve_geography_smart("national")
        assert r["status"] == "generic"

    def test_pays_stays_generic(self):
        from app.agents.geo_resolution import resolve_geography_smart
        r = resolve_geography_smart("pays")
        assert r["status"] == "generic"


class TestMetricDoseDefault:
    """Test dose-1 default for coverage indicators.

    These are integration tests — they require a live Supabase connection
    to search_indicators. They skip when Supabase is not available.
    """

    @pytest.fixture(autouse=True)
    def _check_supabase(self):
        from app.tools.supabase_data import search_indicators
        try:
            results = search_indicators("BCG", limit=1)
            if not results:
                pytest.skip("Supabase not available")
        except Exception:
            pytest.skip("Supabase not available")

    def test_couverture_vpi_resolves_dose1(self):
        from app.agents.metric_resolution import resolve_metric_smart
        r = resolve_metric_smart("couverture VPI")
        assert r["status"] == "resolved"
        assert "1" in r.get("metric_name", "").lower() or "VPI 1" in r.get("metric_name", "")

    def test_couverture_penta_resolves_dose1(self):
        from app.agents.metric_resolution import resolve_metric_smart
        r = resolve_metric_smart("couverture Penta")
        assert r["status"] == "resolved"
        assert "1" in r.get("metric_name", "").lower() or "Pentavalent 1" in r.get("metric_name", "")

    def test_vpi_alone_still_ambiguous(self):
        from app.agents.metric_resolution import resolve_metric_smart
        r = resolve_metric_smart("VPI")
        assert r["status"] in ("ambiguous", "not_found")


class TestExactMatchPriority:
    """Test that exact name matches rank higher than fuzzy look-alikes.

    Integration test — requires Supabase.
    """

    @pytest.fixture(autouse=True)
    def _check_supabase(self):
        from app.tools.supabase_data import find_org_unit_candidates
        try:
            results = find_org_unit_candidates("Lualaba")
            if not results:
                pytest.skip("Supabase not available")
        except Exception:
            pytest.skip("Supabase not available")

    def test_fuzzy_capped_below_exact(self):
        from app.tools.supabase_data import find_org_unit_candidates
        # "Makala" should match "Makala ZS" (exact) higher than "Mokala ZS" (fuzzy)
        candidates = find_org_unit_candidates("Makala Zone de Santé")
        if len(candidates) >= 2:
            # The exact match should be first with score 1.0
            assert candidates[0]["score"] == 1.0
            # The fuzzy match should be < 1.0
            if "Mokala" in candidates[1].get("name", ""):
                assert candidates[1]["score"] < 1.0
