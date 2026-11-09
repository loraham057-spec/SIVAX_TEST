"""
Phase 6 — CLI orchestration.

Usage:
    cd backend && venv/bin/python -m app.eval.cli [options]

Options:
    --n N              Number of ground truth samples (default: 30)
    --max-per-gt N     Max questions per ground truth (default: 5)
    --use-llm          Use LLM for additional question variants
    --output FILE      Save report to file (JSON)
    --compare FILE     Compare to previous report (regression detection)
    --indicator ID     Restrict to a specific indicator
    --verbose          Show full traces for failures
    --apply            Auto-apply safe corrections (few-shot, aliases, defaults)
    --loop N           Run eval→correct→re-eval loop N times (default: 1)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any

from app.eval.auto_correct import build_eval_report, EvalReport
from app.eval.diagnostic import diagnose
from app.eval.ground_truth_sampler import sample_ground_truths
from app.eval.pipeline_runner import run_question
from app.eval.question_generator import generate_test_cases


def run_evaluation(
    n: int = 30,
    max_per_gt: int = 5,
    use_llm: bool = False,
    indicator_filter: str | None = None,
    verbose: bool = False,
    apply: bool = False,
) -> EvalReport:
    """Run the full evaluation pipeline."""
    print(f"┌─ Sampling {n} ground truths from Supabase...")
    ground_truths = sample_ground_truths(n=n, indicator_filter=indicator_filter)
    if not ground_truths:
        print("│  ✗ No ground truths sampled — check Supabase connection")
        sys.exit(1)
    print(f"└─ {len(ground_truths)} ground truths sampled")

    print(f"┌─ Generating test cases...")
    test_cases = generate_test_cases(ground_truths, use_llm=use_llm, max_per_gt=max_per_gt)
    print(f"└─ {len(test_cases)} test cases generated")

    print(f"┌─ Running {len(test_cases)} questions through the agent pipeline...")
    reports = []
    traces_json = []
    for i, tc in enumerate(test_cases):
        elapsed_start = time.time()
        trace = run_question(tc)
        report = diagnose(trace)
        reports.append(report)
        traces_json.append(trace.to_dict())
        status = "✓" if report.overall_passed else f"✗ [{report.error_category}]"
        elapsed = time.time() - elapsed_start
        print(f"│  {i+1:3d}/{len(test_cases)} {status} ({elapsed:.1f}s) [{tc.strategy}] {tc.question[:50]}...")
        if not report.overall_passed and verbose:
            for layer in report.layers:
                symbol = "✓" if layer.passed else "✗"
                print(f"│       {symbol} {layer.layer}: {layer.message}")
    print(f"└─ Done")

    report = build_eval_report(reports, traces_json, apply=apply)
    print()
    print(report.summary_text())
    if apply and report.applied:
        print(f"\n→ Applied {len(report.applied)} corrections automatically")
    return report


def run_eval_loop_cli(
    n: int = 30,
    max_per_gt: int = 5,
    use_llm: bool = False,
    indicator_filter: str | None = None,
    verbose: bool = False,
    max_iterations: int = 2,
) -> list[EvalReport]:
    """Run the eval→correct→re-eval loop."""
    reports_history: list[EvalReport] = []

    for i in range(max_iterations):
        print(f"\n{'='*60}")
        print(f"  ITERATION {i+1}/{max_iterations}")
        print(f"{'='*60}")

        apply = i < max_iterations - 1  # Don't apply on the last iteration
        report = run_evaluation(
            n=n, max_per_gt=max_per_gt, use_llm=use_llm,
            indicator_filter=indicator_filter, verbose=verbose,
            apply=apply,
        )
        reports_history.append(report)

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


def compare_reports(current: EvalReport, previous_path: str) -> None:
    """Compare current report to a previous one for regression detection."""
    try:
        with open(previous_path) as f:
            prev = json.load(f)
    except Exception as e:
        print(f"Cannot load previous report: {e}")
        return

    prev_pass_rate = prev.get("pass_rate", 0)
    curr_pass_rate = current.pass_rate
    delta = curr_pass_rate - prev_pass_rate

    print(f"\n=== REGRESSION ANALYSIS ===")
    print(f"Previous pass rate: {prev_pass_rate:.1%}")
    print(f"Current pass rate:   {curr_pass_rate:.1%}")
    print(f"Delta:              {delta:+.1%}")

    if delta < -0.05:
        print(f"⚠ REGRESSION DETECTED — pass rate dropped by {-delta:.1%}")
    elif delta > 0.05:
        print(f"✓ IMPROVEMENT — pass rate increased by {delta:.1%}")
    else:
        print(f"  No significant change")

    # Compare by category
    prev_cats = prev.get("by_category", {})
    curr_cats = current.by_category
    all_cats = set(prev_cats) | set(curr_cats)
    print(f"\nBy category:")
    for cat in sorted(all_cats):
        prev_count = prev_cats.get(cat, 0)
        curr_count = curr_cats.get(cat, 0)
        delta_cat = curr_count - prev_count
        symbol = "↑" if delta_cat > 0 else ("↓" if delta_cat < 0 else "=")
        print(f"  {cat}: {prev_count} → {curr_count} {symbol}")


def main():
    parser = argparse.ArgumentParser(description="Automated agent evaluation")
    parser.add_argument("--n", type=int, default=30, help="Number of ground truth samples")
    parser.add_argument("--max-per-gt", type=int, default=5, help="Max questions per ground truth")
    parser.add_argument("--use-llm", action="store_true", help="Use LLM for question variants")
    parser.add_argument("--output", type=str, help="Save report to JSON file")
    parser.add_argument("--compare", type=str, help="Compare to previous report")
    parser.add_argument("--indicator", type=str, help="Restrict to a specific indicator ID")
    parser.add_argument("--verbose", action="store_true", help="Show full traces for failures")
    parser.add_argument("--apply", action="store_true",
                        help="Auto-apply safe corrections (few-shot, aliases, defaults)")
    parser.add_argument("--loop", type=int, default=1,
                        help="Run eval→correct→re-eval loop N times")
    args = parser.parse_args()

    if args.loop > 1:
        reports_history = run_eval_loop_cli(
            n=args.n, max_per_gt=args.max_per_gt, use_llm=args.use_llm,
            indicator_filter=args.indicator, verbose=args.verbose,
            max_iterations=args.loop,
        )
        report = reports_history[-1]
    else:
        report = run_evaluation(
            n=args.n,
            max_per_gt=args.max_per_gt,
            use_llm=args.use_llm,
            indicator_filter=args.indicator,
            verbose=args.verbose,
            apply=args.apply,
        )

    if args.output:
        report_data = report.to_dict()
        with open(args.output, "w") as f:
            json.dump(report_data, f, indent=2, ensure_ascii=False)
        print(f"\nReport saved to {args.output}")

    if args.compare:
        compare_reports(report, args.compare)


if __name__ == "__main__":
    main()
