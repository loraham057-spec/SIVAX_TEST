"""
Phase 4 — Multi-Layer Diagnostic.

Analyzes a PipelineTrace against the expected ground truth and identifies
the FIRST layer that failed. This pinpoints the root cause:

    Layer 1: INTENT       — was the question classified as ANALYZE?
    Layer 2: EXTRACTION   — were the correct entities extracted?
    Layer 3: CLARIFICATION— did the agent block unnecessarily?
    Layer 4: PLANNING     — were the correct DHIS2 queries planned?
    Layer 5: TOOL         — did the tools return data?
    Layer 6: RESPONSE     — is the response grounded in the data?

Each layer produces a pass/fail with a diagnostic message explaining
exactly what went wrong and (when possible) a suggested fix.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.eval.pipeline_runner import PipelineTrace


@dataclass
class LayerResult:
    """Result of checking one pipeline layer."""
    layer: str  # "intent", "extraction", "clarification", "planning", "tool", "response"
    passed: bool
    message: str
    details: dict[str, Any] | None = None
    suggested_fix: str | None = None


@dataclass
class DiagnosticReport:
    """Full diagnostic for one test case."""
    question: str
    strategy: str
    overall_passed: bool
    first_failure_layer: str | None  # None if all passed
    layers: list[LayerResult]
    trace: PipelineTrace

    @property
    def error_category(self) -> str:
        """The category of the first failing layer, or 'pass' if all passed."""
        if self.first_failure_layer:
            return self.first_failure_layer
        return "pass"

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "strategy": self.strategy,
            "overall_passed": self.overall_passed,
            "first_failure_layer": self.first_failure_layer,
            "error_category": self.error_category,
            "layers": [
                {"layer": l.layer, "passed": l.passed, "message": l.message,
                 "suggested_fix": l.suggested_fix}
                for l in self.layers
            ],
        }


def _normalize_id(s: str | None) -> str:
    """Normalize an ID for comparison (strip prefixes like 'cWJXYKCXrLx.REPORTING_RATE')."""
    if not s:
        return ""
    return str(s).split(".")[0].strip().lower()


def _check_intent(trace: PipelineTrace) -> LayerResult:
    """Layer 1: Was the question classified as ANALYZE?"""
    if trace.intent in ("ANALYZE", "CHALLENGE"):
        return LayerResult("intent", True, f"intent={trace.intent}, confidence={trace.confidence:.2f}")
    if trace.error:
        return LayerResult("intent", False, f"Pipeline error: {trace.error}",
                           suggested_fix="Check pipeline execution for exceptions")
    return LayerResult(
        "intent", False,
        f"Expected ANALYZE, got intent={trace.intent}",
        suggested_fix="Improve intent classification prompt — add this question as a positive ANALYZE example",
    )


def _check_extraction(trace: PipelineTrace) -> LayerResult:
    """Layer 2: Were the correct entities extracted?

    Note: the agent extracts indicator_keywords (text) and antigens, not
    resolved DHIS2 IDs. Resolution happens in the planner. So we check
    semantic relevance here — did the extracted keywords relate to the
    expected indicator? Exact ID matching happens at the planning layer.
    """
    expected = trace.expected
    entities = trace.extracted_entities

    issues = []

    # ── Indicator (semantic check, not ID match) ──
    expected_ind_label = (expected.get("indicator_label") or "").lower()
    expected_ind_id = _normalize_id(expected.get("indicator_id"))
    extracted_keywords = entities.get("indicator_keywords") or []
    extracted_antigens = entities.get("antigens") or []
    extracted_metric_id = _normalize_id(entities.get("metric_id"))

    # If the agent already resolved a metric_id, check it
    if extracted_metric_id and expected_ind_id:
        if expected_ind_id not in extracted_metric_id and extracted_metric_id not in expected_ind_id:
            issues.append(f"metric_id: expected {expected_ind_id}, got {extracted_metric_id}")
    elif extracted_keywords or extracted_antigens:
        # Check semantic relevance: do the extracted keywords overlap with
        # the expected indicator label?
        all_extracted = " ".join(str(k) for k in extracted_keywords).lower()
        all_extracted += " " + " ".join(str(a) for a in extracted_antigens).lower()
        # Extract significant words from the expected label
        expected_words = set(w for w in expected_ind_label.split() if len(w) >= 3)
        extracted_words = set(w for w in all_extracted.split() if len(w) >= 3)
        overlap = expected_words & extracted_words
        if not overlap and expected_words:
            issues.append(
                f"indicator keywords don't match expected '{expected_ind_label[:40]}'"
            )
    else:
        issues.append("no indicator keywords or antigens extracted")

    # ── Geography (semantic check) ──
    expected_ou = _normalize_id(expected.get("org_unit_id"))
    expected_ou_name = (expected.get("org_unit_name") or "").lower()
    extracted_ou = _normalize_id(entities.get("org_unit_id"))
    geo_text = (entities.get("geography") or "").lower()

    if extracted_ou and expected_ou:
        if expected_ou not in extracted_ou and extracted_ou not in expected_ou:
            issues.append(f"org_unit: expected {expected_ou}, got {extracted_ou}")
    elif geo_text and expected_ou_name:
        # Check if the geography text is semantically related to the expected name
        expected_geo_words = set(w for w in expected_ou_name.split() if len(w) >= 3)
        extracted_geo_words = set(w for w in geo_text.split() if len(w) >= 3)
        overlap = expected_geo_words & extracted_geo_words
        if not overlap and expected_geo_words:
            issues.append(
                f"geography '{geo_text[:30]}' doesn't match expected '{expected_ou_name[:30]}'"
            )
    else:
        issues.append("no geography extracted")

    # ── Period ──
    expected_period = str(expected.get("period", ""))
    extracted_periods = entities.get("periods") or entities.get("period") or []
    if isinstance(extracted_periods, str):
        extracted_periods = [extracted_periods]
    if expected_period and extracted_periods:
        # Check if the expected period is in the extracted periods
        found_period = False
        for ep in extracted_periods:
            if isinstance(ep, str) and expected_period in ep:
                found_period = True
                break
        if not found_period:
            issues.append(f"period: expected {expected_period}, got {extracted_periods}")

    if issues:
        return LayerResult(
            "extraction", False,
            "; ".join(issues),
            details={"expected": expected, "extracted": entities},
            suggested_fix="Add this question as a few-shot example in the context_analysis LLM prompt with correct entity extraction",
        )
    return LayerResult("extraction", True, "All entities semantically matched")


def _check_clarification(trace: PipelineTrace) -> LayerResult:
    """Layer 3: Did the agent block with an unnecessary clarification?"""
    if trace.clarification_action == "CLARIFY":
        req = trace.clarification_request or {}
        slot = req.get("slot", "unknown")
        return LayerResult(
            "clarification", False,
            f"Agent blocked with clarification on slot '{slot}' — expected to proceed",
            details={"clarification_request": req},
            suggested_fix=f"Review clarification rules for slot '{slot}' — this question should not trigger a clarification",
        )
    return LayerResult("clarification", True,
                       f"action={trace.clarification_action or 'PROCEED'}")


def _check_planning(trace: PipelineTrace) -> LayerResult:
    """Layer 4: Were the correct DHIS2 queries planned?"""
    actions = trace.planned_actions
    if not actions:
        if trace.clarification_action == "CLARIFY":
            return LayerResult("planning", True, "Skipped — clarification blocked before planning")
        return LayerResult("planning", False, "No actions were planned",
                           suggested_fix="Check planner — question was not blocked but no actions generated")
    return LayerResult("planning", True, f"{len(actions)} actions planned")


def _check_tool(trace: PipelineTrace) -> LayerResult:
    """Layer 5: Did the tools return data?"""
    results = trace.tool_results
    if not results:
        if trace.clarification_action == "CLARIFY":
            return LayerResult("tool", True, "Skipped — clarification blocked before execution")
        return LayerResult("tool", False, "No tool results returned",
                           suggested_fix="Check DHIS2 tool execution — query may have wrong parameters")
    # Check if any result has actual data
    has_data = False
    for result in results:
        if isinstance(result, dict):
            status = result.get("status", "")
            if status in ("success", "auto_executed", "completed") and (
                result.get("rows") or result.get("data") or result.get("values")
                or result.get("result") or result.get("table")
            ):
                has_data = True
                break
            # Also check for raw data
            if result.get("data") or result.get("values") or result.get("result"):
                has_data = True
                break
    # If no explicit data found, check if the response text contains
    # numerical data (the tool may have returned data in a different format)
    if not has_data and trace.response_text:
        import re
        # Look for numbers in the response (percentages, counts, etc.)
        numbers = re.findall(r"\b\d+[.,]?\d*\s*%?\b", trace.response_text)
        if len(numbers) >= 2:
            has_data = True
    if not has_data:
        return LayerResult("tool", False, "Tools executed but returned no data",
                           suggested_fix="Check DHIS2 query parameters (indicator, org unit, period) — data exists in Supabase but query returned empty")
    return LayerResult("tool", True, f"{len(results)} tool results with data")


def _check_response(trace: PipelineTrace) -> LayerResult:
    """Layer 6: Is the response grounded in the expected data?"""
    if trace.response_status == "awaiting_clarification":
        return LayerResult("response", True, "Response is a clarification (expected)")
    if not trace.response_text:
        return LayerResult("response", False, "No response text generated",
                           suggested_fix="Check response generation node")
    expected_value = trace.expected.get("value")
    if expected_value is None:
        return LayerResult("response", True, "Response generated (no value to check)")
    # Check if the expected value appears in the response (within tolerance)
    text = trace.response_text
    # Look for the value as a number (e.g. "11.9" or "11,9")
    value_str = str(round(expected_value, 1))
    value_str_comma = value_str.replace(".", ",")
    # Also try integer version
    value_str_int = str(int(round(expected_value)))
    found = value_str in text or value_str_comma in text or value_str_int in text
    if found:
        return LayerResult("response", True,
                           f"Response contains expected value ({expected_value})")
    return LayerResult(
        "response", False,
        f"Expected value {expected_value} not found in response",
        details={"response_excerpt": text[:200]},
        suggested_fix="Check response generation — data was retrieved but the expected value is not mentioned in the response",
    )


def diagnose(trace: PipelineTrace) -> DiagnosticReport:
    """Run all 6 layer checks and produce a diagnostic report.

    The first failing layer is the root cause — fixing it should be
    prioritized over later layers.
    """
    layers = [
        _check_intent(trace),
        _check_extraction(trace),
        _check_clarification(trace),
        _check_planning(trace),
        _check_tool(trace),
        _check_response(trace),
    ]

    first_failure = None
    for layer in layers:
        if not layer.passed:
            first_failure = layer.layer
            break

    return DiagnosticReport(
        question=trace.question,
        strategy=trace.strategy,
        overall_passed=first_failure is None,
        first_failure_layer=first_failure,
        layers=layers,
        trace=trace,
    )
