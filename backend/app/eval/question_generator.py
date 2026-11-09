"""
Phase 2 — Question Generator (hybrid: templates + LLM).

For each GroundTruth, generates multiple natural language question
variants that should produce the correct answer when run through the
agent. Each variant tests different aspects of the pipeline:

    - Simple:      "Quelle est la couverture BCG au Lualaba en juillet 2026 ?"
    - Misspelled:  "couverture BCG dans le Lwalaba en juillet 2026"
    - Complex:     "Montre-moi les ZS du Lualaba avec leur couverture BCG en juillet 2026"
    - English:     "BCG coverage in Lualaba, July 2026"
    - Ambiguous:   Uses a partial/ambiguous geography name
    - Period var:  "07/2026", "T3 2026", "juillet 2026"
    - LLM-gen:     LLM-generated natural variants (diverse phrasings)
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass
from typing import Any

from app.eval.ground_truth_sampler import GroundTruth


@dataclass
class TestCase:
    """A generated test question with its expected answer."""
    question: str
    expected_indicator_id: str
    expected_indicator_label: str
    expected_org_unit_id: str
    expected_org_unit_name: str
    expected_period: str
    expected_value: float
    # Which generation strategy was used (for diagnostic)
    strategy: str  # "simple", "misspelled", "complex", "english", "ambiguous", "period_var", "llm_gen"
    # The original ground truth for reference
    ground_truth: GroundTruth


# ─── Template-based generators ───────────────────────────

def _misspell(name: str) -> str:
    """Introduce a plausible misspelling into a place name."""
    if len(name) < 4:
        return name
    s = name
    i = random.randint(1, len(s) - 2)
    strategies = [
        # Swap two adjacent characters
        lambda: s[:i] + s[i + 1] + s[i] + s[i + 2:],
        # Duplicate a character
        lambda: s[:i] + s[i] + s[i:],
        # Drop a character
        lambda: s[:i] + s[i + 1:],
    ]
    strategy = random.choice(strategies)
    try:
        result = strategy()
        return result if result and len(result) >= 3 else name
    except Exception:
        return name


def _period_variants(period: str) -> list[str]:
    """Generate period text variants: '202607' → ['juillet 2026', '07/2026', 'T3 2026', '202607']."""
    months_fr = [
        "janvier", "février", "mars", "avril", "mai", "juin",
        "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    ]
    if len(period) != 6:
        return [period]
    y, m = period[:4], int(period[4:])
    if not (1 <= m <= 12):
        return [period]
    variants = [
        f"{months_fr[m - 1]} {y}",
        f"{m:02d}/{y}",
        f"T{(m - 1) // 3 + 1} {y}",
        period,
    ]
    return variants


def _generate_templates(gt: GroundTruth) -> list[TestCase]:
    """Generate template-based test cases for a ground truth."""
    cases: list[TestCase] = []
    geo = gt.geo_name_clean
    antigen = gt.antigen or gt.indicator_label
    period_text = gt.period_text
    period_variants = _period_variants(gt.period)

    # Determine the right verb for the indicator type
    label_lower = gt.indicator_label.lower()
    if "stock" in label_lower or "sdu" in label_lower or "cmm" in label_lower:
        metric_verb = "le"  # "le stock", "la consommation"
        metric_noun = gt.indicator_label
    elif "abandon" in label_lower:
        metric_verb = "le taux d'abandon"
        metric_noun = antigen
    elif "couverture" in label_lower or "taux" in label_lower:
        metric_verb = "la couverture"
        metric_noun = antigen
    else:
        metric_verb = "la valeur de"
        metric_noun = gt.indicator_label

    base_kwargs = dict(
        expected_indicator_id=gt.indicator_id,
        expected_indicator_label=gt.indicator_label,
        expected_org_unit_id=gt.org_unit_id,
        expected_org_unit_name=gt.org_unit_name,
        expected_period=gt.period,
        expected_value=gt.value,
        ground_truth=gt,
    )

    # ── Simple ──
    cases.append(TestCase(
        question=f"Quel est {metric_verb} {metric_noun} dans {geo} en {period_text} ?",
        strategy="simple", **base_kwargs,
    ))

    # ── Misspelled geography ──
    misspelled_geo = _misspell(geo)
    if misspelled_geo != geo:
        cases.append(TestCase(
            question=f"{metric_verb} {metric_noun} dans {misspelled_geo} en {period_text}",
            strategy="misspelled", **base_kwargs,
        ))

    # ── Complex (ZS listing) ──
    if gt.org_unit_level == 2:
        cases.append(TestCase(
            question=f"Montre-moi les zones de santé de {geo} avec {metric_verb} {metric_noun} en {period_text}",
            strategy="complex", **base_kwargs,
        ))

    # ── English ──
    cases.append(TestCase(
        question=f"What is the {antigen} coverage in {geo} for {period_text}?",
        strategy="english", **base_kwargs,
    ))

    # ── Period variant ──
    alt_period = random.choice([p for p in period_variants if p != period_text])
    cases.append(TestCase(
        question=f"{metric_verb} {metric_noun} {geo} {alt_period}",
        strategy="period_var", **base_kwargs,
    ))

    return cases


# ─── LLM-based generator ─────────────────────────────────

_LLM_SYSTEM_PROMPT = """You are a test question generator for a DHIS2 vaccination analytics agent.
Given a data point (indicator, geography, period, value), generate 3 diverse
natural language questions in French that a healthcare worker might ask.

Rules:
- Vary the phrasing (don't always start with "Quelle est...")
- Include at least one question with a slight misspelling of the geography
- Include at least one question that mentions the geographic level explicitly
  ("zones de santé de X", "province de X")
- Keep questions realistic — a nurse or health district coordinator would ask this
- Return ONE question per line, no numbering, no explanation
"""


def _generate_llm_variants(gt: GroundTruth, llm_invoke=None) -> list[TestCase]:
    """Generate LLM-based question variants.

    Args:
        gt: ground truth data point
        llm_invoke: callable(prompt) -> str. If None, LLM is not used.
    """
    if llm_invoke is None:
        return []

    user_prompt = (
        f"Indicateur: {gt.indicator_label}\n"
        f"Géographie: {gt.geo_name_clean} ({gt.geo_type})\n"
        f"Période: {gt.period_text}\n"
        f"Valeur: {gt.value}%\n"
        f"Génère 3 questions:"
    )
    try:
        response = llm_invoke(user_prompt)
    except Exception:
        return []

    questions = [q.strip() for q in response.strip().split("\n") if q.strip()]
    base_kwargs = dict(
        expected_indicator_id=gt.indicator_id,
        expected_indicator_label=gt.indicator_label,
        expected_org_unit_id=gt.org_unit_id,
        expected_org_unit_name=gt.org_unit_name,
        expected_period=gt.period,
        expected_value=gt.value,
        ground_truth=gt,
    )
    return [
        TestCase(question=q, strategy="llm_gen", **base_kwargs)
        for q in questions[:3]
    ]


# ─── Orchestrator ────────────────────────────────────────

def generate_test_cases(
    ground_truths: list[GroundTruth],
    use_llm: bool = False,
    llm_invoke=None,
    max_per_gt: int = 5,
) -> list[TestCase]:
    """Generate test cases from ground truths.

    Args:
        ground_truths: sampled ground truth tuples
        use_llm: whether to use LLM for additional variants
        llm_invoke: callable(prompt) -> str for LLM generation
        max_per_gt: max test cases per ground truth

    Returns:
        list of TestCase objects.
    """
    all_cases: list[TestCase] = []
    for gt in ground_truths:
        cases = _generate_templates(gt)
        if use_llm:
            cases.extend(_generate_llm_variants(gt, llm_invoke))
        random.shuffle(cases)
        all_cases.extend(cases[:max_per_gt])
    return all_cases
