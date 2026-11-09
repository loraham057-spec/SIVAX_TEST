"""
Phase 5 — Auto-Correction and Improvement.

Analyzes diagnostic reports and applies targeted corrections:

    - extraction_error    → few-shot examples persisted for the LLM prompt
    - clarification_error  → clarification rule adjustments (aliases, thresholds)
    - planning_error      → planner rule suggestions
    - tool_error          → tool parameter fixes
    - response_error      → response template adjustments
    - intent_error         → intent classification examples

Two modes:
    1. SUGGEST (default) — generate reviewable artifacts in the corrections/
       directory. No production code is modified.
    2. APPLY — apply safe, bounded corrections automatically:
       - Few-shot examples → JSON file loaded by context_analysis
       - National/geo aliases → added to geo_resolution.NATIONAL_ALIASES
       - Metric dose defaults → added to metric_resolution
       All applied changes are logged for auditability.

The feedback loop:
    run_eval_loop() → run eval → diagnose → apply corrections → re-run → compare
"""

from __future__ import annotations

import json
import os
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.eval.diagnostic import DiagnosticReport


# ─── Correction artifacts directory ─────────────────────────
_CORRECTIONS_DIR = Path(__file__).parent / "corrections"
_FEW_SHOT_FILE = _CORRECTIONS_DIR / "few_shot_examples.json"
_GEO_ALIASES_FILE = _CORRECTIONS_DIR / "geo_aliases.json"
_METRIC_DEFAULTS_FILE = _CORRECTIONS_DIR / "metric_defaults.json"
_AUDIT_LOG_FILE = _CORRECTIONS_DIR / "audit_log.json"


@dataclass
class CorrectionSuggestion:
    """A suggested fix for a failing test case."""
    error_category: str
    question: str
    suggested_fix: str
    details: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "error_category": self.error_category,
            "question": self.question,
            "suggested_fix": self.suggested_fix,
            "details": self.details,
        }


@dataclass
class AppliedCorrection:
    """A correction that was actually applied to the system."""
    timestamp: str
    correction_type: str  # "few_shot", "geo_alias", "metric_default", "rule_adjustment"
    description: str
    before: Any = None
    after: Any = None
    test_question: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp,
            "correction_type": self.correction_type,
            "description": self.description,
            "before": self.before,
            "after": self.after,
            "test_question": self.test_question,
        }


@dataclass
class EvalReport:
    """Summary report of an evaluation run."""
    total: int
    passed: int
    failed: int
    pass_rate: float
    by_category: dict[str, int]
    by_strategy: dict[str, dict[str, int]]
    corrections: list[CorrectionSuggestion]
    traces: list[dict[str, Any]]
    applied: list[AppliedCorrection] = field(default_factory=list)

    def summary_text(self) -> str:
        lines = [
            f"=== EVAL REPORT ===",
            f"Total: {self.total} | Passed: {self.passed} | Failed: {self.failed} | Pass rate: {self.pass_rate:.1%}",
            f"\nBy error category:",
        ]
        for cat, count in sorted(self.by_category.items(), key=lambda x: -x[1]):
            lines.append(f"  {cat}: {count}")
        lines.append(f"\nBy strategy:")
        for strat, counts in sorted(self.by_strategy.items()):
            lines.append(f"  {strat}: {counts}")
        if self.corrections:
            lines.append(f"\nTop corrections ({len(self.corrections)}):")
            for c in self.corrections[:10]:
                lines.append(f"  [{c.error_category}] {c.question[:60]}...")
                lines.append(f"    → {c.suggested_fix[:100]}")
        if self.applied:
            lines.append(f"\nApplied corrections ({len(self.applied)}):")
            for a in self.applied[:10]:
                lines.append(f"  [{a.correction_type}] {a.description[:80]}")
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "passed": self.passed,
            "failed": self.failed,
            "pass_rate": self.pass_rate,
            "by_category": self.by_category,
            "by_strategy": self.by_strategy,
            "corrections": [c.to_dict() for c in self.corrections],
            "traces": self.traces,
            "applied": [a.to_dict() for a in self.applied],
        }


# ─── Suggestion generation ─────────────────────────────────

def generate_corrections(reports: list[DiagnosticReport]) -> list[CorrectionSuggestion]:
    """Generate correction suggestions from diagnostic reports."""
    corrections = []
    for report in reports:
        if report.overall_passed:
            continue
        layer = report.first_failure_layer
        layer_result = next(
            (l for l in report.layers if l.layer == layer), None
        )
        if not layer_result:
            continue
        corrections.append(CorrectionSuggestion(
            error_category=layer,
            question=report.question,
            suggested_fix=layer_result.suggested_fix or "Manual investigation needed",
            details={
                "message": layer_result.message,
                "strategy": report.strategy,
                "details": layer_result.details,
            },
        ))
    return corrections


# ─── Auto-apply corrections ─────────────────────────────────

def _ensure_dir():
    _CORRECTIONS_DIR.mkdir(parents=True, exist_ok=True)


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    with open(path) as f:
        return json.load(f)


def _save_json(path: Path, data: Any):
    _ensure_dir()
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _append_audit_log(entry: AppliedCorrection):
    log = _load_json(_AUDIT_LOG_FILE) or []
    log.append(entry.to_dict())
    _save_json(_AUDIT_LOG_FILE, log)


def apply_few_shot_example(
    question: str,
    expected_entities: dict[str, Any],
    error_message: str,
) -> AppliedCorrection:
    """Add a few-shot example for the context_analysis LLM prompt.

    The example is persisted to corrections/few_shot_examples.json and can
    be loaded by the context_analysis node to improve entity extraction.
    """
    data = _load_json(_FEW_SHOT_FILE) or {"examples": []}
    example = {
        "question": question,
        "expected_entities": expected_entities,
        "error": error_message,
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    # Avoid duplicates
    if not any(e["question"] == question for e in data["examples"]):
        data["examples"].append(example)
        _save_json(_FEW_SHOT_FILE, data)

    return AppliedCorrection(
        timestamp=datetime.now(timezone.utc).isoformat(),
        correction_type="few_shot",
        description=f"Added few-shot example for: {question[:60]}",
        after=example,
        test_question=question,
    )


def apply_geo_alias(
    alias_text: str,
    org_unit_id: str,
    org_unit_name: str,
) -> AppliedCorrection:
    """Add a geography alias to the corrections store.

    The alias is persisted to corrections/geo_aliases.json and can be
    loaded by geo_resolution to improve geography resolution.
    """
    data = _load_json(_GEO_ALIASES_FILE) or {"aliases": []}
    alias_entry = {
        "alias": alias_text.lower(),
        "org_unit_id": org_unit_id,
        "org_unit_name": org_unit_name,
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    if not any(a["alias"] == alias_text.lower() for a in data["aliases"]):
        data["aliases"].append(alias_entry)
        _save_json(_GEO_ALIASES_FILE, data)

    return AppliedCorrection(
        timestamp=datetime.now(timezone.utc).isoformat(),
        correction_type="geo_alias",
        description=f"Added geo alias '{alias_text}' → {org_unit_name}",
        after=alias_entry,
        test_question="",
    )


def apply_metric_default(
    query_text: str,
    metric_id: str,
    metric_name: str,
    reason: str,
) -> AppliedCorrection:
    """Add a metric default resolution to the corrections store.

    The default is persisted to corrections/metric_defaults.json and can be
    loaded by metric_resolution to improve indicator resolution.
    """
    data = _load_json(_METRIC_DEFAULTS_FILE) or {"defaults": []}
    default_entry = {
        "query": query_text.lower(),
        "metric_id": metric_id,
        "metric_name": metric_name,
        "reason": reason,
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    if not any(d["query"] == query_text.lower() for d in data["defaults"]):
        data["defaults"].append(default_entry)
        _save_json(_METRIC_DEFAULTS_FILE, data)

    return AppliedCorrection(
        timestamp=datetime.now(timezone.utc).isoformat(),
        correction_type="metric_default",
        description=f"Added metric default '{query_text}' → {metric_name}",
        after=default_entry,
        test_question="",
    )


def auto_apply_corrections(
    reports: list[DiagnosticReport],
    apply: bool = True,
) -> list[AppliedCorrection]:
    """Analyze diagnostic reports and apply safe corrections automatically.

    Returns the list of applied corrections (empty if apply=False).
    """
    if not apply:
        return []

    applied: list[AppliedCorrection] = []
    seen_questions: set[str] = set()

    for report in reports:
        if report.overall_passed:
            continue
        if report.question in seen_questions:
            continue
        seen_questions.add(report.question)

        layer = report.first_failure_layer
        trace = report.trace
        expected = trace.expected

        if layer == "extraction":
            # Add few-shot example for the LLM prompt
            applied.append(apply_few_shot_example(
                question=report.question,
                expected_entities={
                    "indicator_keywords": expected.get("indicator_label", ""),
                    "geography": expected.get("org_unit_name", ""),
                    "periods": [expected.get("period", "")],
                },
                error_message=next(
                    (l.message for l in report.layers if l.layer == "extraction"),
                    "",
                ),
            ))

        elif layer == "clarification":
            # Determine what type of clarification was triggered
            clar = trace.clarification_request or {}
            slot = clar.get("slot", "")

            if slot == "geography":
                # The geography was not recognized — add it as an alias
                geo_text = (trace.extracted_entities.get("geography") or "").strip()
                if geo_text and expected.get("org_unit_id"):
                    applied.append(apply_geo_alias(
                        alias_text=geo_text,
                        org_unit_id=expected["org_unit_id"],
                        org_unit_name=expected.get("org_unit_name", ""),
                    ))

            elif slot == "metric":
                # The metric was ambiguous — add a default resolution
                metric_text = " ".join(
                    trace.extracted_entities.get("indicator_keywords") or []
                )
                if metric_text and expected.get("indicator_id"):
                    applied.append(apply_metric_default(
                        query_text=metric_text,
                        metric_id=expected["indicator_id"],
                        metric_name=expected.get("indicator_label", ""),
                        reason="Auto-applied from evaluation: metric was ambiguous",
                    ))

    # Log all applied corrections
    for a in applied:
        _append_audit_log(a)

    return applied


# ─── Load corrections into the agent ────────────────────────

def load_few_shot_examples() -> list[dict[str, Any]]:
    """Load few-shot examples from the corrections store."""
    data = _load_json(_FEW_SHOT_FILE)
    if not data:
        return []
    return data.get("examples", [])


def load_geo_aliases() -> list[dict[str, Any]]:
    """Load geography aliases from the corrections store."""
    data = _load_json(_GEO_ALIASES_FILE)
    if not data:
        return []
    return data.get("aliases", [])


def load_metric_defaults() -> list[dict[str, Any]]:
    """Load metric defaults from the corrections store."""
    data = _load_json(_METRIC_DEFAULTS_FILE)
    if not data:
        return []
    return data.get("defaults", [])


# ─── Report building ────────────────────────────────────────

def build_eval_report(
    reports: list[DiagnosticReport],
    traces: list[dict[str, Any]] | None = None,
    apply: bool = False,
) -> EvalReport:
    """Build a summary report from diagnostic reports.

    If apply=True, also auto-apply safe corrections and include them
    in the report.
    """
    total = len(reports)
    passed = sum(1 for r in reports if r.overall_passed)
    failed = total - passed

    by_category: dict[str, int] = Counter(r.error_category for r in reports)
    by_strategy: dict[str, dict[str, int]] = {}
    for r in reports:
        strat = r.strategy or "unknown"
        if strat not in by_strategy:
            by_strategy[strat] = {"pass": 0, "fail": 0}
        if r.overall_passed:
            by_strategy[strat]["pass"] += 1
        else:
            by_strategy[strat]["fail"] += 1

    corrections = generate_corrections(reports)
    applied = auto_apply_corrections(reports, apply=apply) if apply else []

    return EvalReport(
        total=total,
        passed=passed,
        failed=failed,
        pass_rate=passed / total if total > 0 else 0.0,
        by_category=dict(by_category),
        by_strategy=by_strategy,
        corrections=corrections,
        traces=traces or [],
        applied=applied,
    )


# ─── Feedback loop ──────────────────────────────────────────

def run_eval_loop(
    run_eval_fn,
    max_iterations: int = 2,
) -> list[EvalReport]:
    """Run the evaluation loop: eval → diagnose → apply → re-eval → compare.

    Args:
        run_eval_fn: A function that takes no arguments and returns
                     (list[DiagnosticReport], list[dict traces]).
        max_iterations: Number of eval→correct→re-eval cycles.

    Returns:
        A list of EvalReports, one per iteration, showing the improvement
        over time.
    """
    reports_history: list[EvalReport] = []

    for i in range(max_iterations):
        reports, traces = run_eval_fn()
        apply = i < max_iterations - 1  # Don't apply on the last iteration
        report = build_eval_report(reports, traces, apply=apply)
        reports_history.append(report)

        print(f"\nIteration {i + 1}/{max_iterations}:")
        print(report.summary_text())

        if i < max_iterations - 1 and report.applied:
            print(f"\n  → Applied {len(report.applied)} corrections, re-evaluating...")

    # Show improvement
    if len(reports_history) >= 2:
        first = reports_history[0]
        last = reports_history[-1]
        delta = last.pass_rate - first.pass_rate
        print(f"\n=== IMPROVEMENT ===")
        print(f"  Pass rate: {first.pass_rate:.1%} → {last.pass_rate:.1%} ({'+' if delta >= 0 else ''}{delta:.1%})")
        print(f"  Failed: {first.failed} → {last.failed}")

    return reports_history
