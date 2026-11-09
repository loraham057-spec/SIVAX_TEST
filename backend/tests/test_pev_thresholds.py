"""The AI agent and the dashboard must classify a value the same way."""

import json
from pathlib import Path

import pytest

from app.tools.semantic_layer import INDICATOR_DEFINITIONS, PEV_THRESHOLDS, SemanticLayer

SHARED = Path(__file__).resolve().parents[2] / "src" / "lib" / "pev" / "thresholds.json"


@pytest.mark.skipif(not SHARED.exists(), reason="frontend sources not available")
def test_thresholds_match_the_dashboard():
    shared = json.loads(SHARED.read_text())
    for kind, values in PEV_THRESHOLDS.items():
        assert values == shared[kind], kind


@pytest.mark.parametrize(
    ("indicator", "value", "status"),
    [
        ("v9b9aYsA5PM", 92, "good"),
        ("v9b9aYsA5PM", 90, "good"),
        ("v9b9aYsA5PM", 85, "warning"),
        ("v9b9aYsA5PM", 80, "warning"),
        ("v9b9aYsA5PM", 79.9, "critical"),
        ("cWJXYKCXrLx", 87, "warning"),
        ("MULXtL8iom8", 5, "good"),
        ("MULXtL8iom8", 7, "warning"),
        ("MULXtL8iom8", 10, "warning"),
        ("MULXtL8iom8", 10.1, "critical"),
    ],
)
def test_three_band_classification(indicator, value, status):
    assert INDICATOR_DEFINITIONS[indicator]["thresholds"]
    assert SemanticLayer().evaluate_threshold(indicator, value)["status"] == status
