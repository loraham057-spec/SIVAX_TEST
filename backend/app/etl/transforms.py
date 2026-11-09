"""Transform layer — normalizes extracted rows for the fact table.

Preserves per-org-unit granularity (national + province levels) so that
the dashboard can show both national KPIs and per-province breakdowns
for risk scoring and equity analysis.
"""

from typing import Any


def transform(rows: list[dict[str, Any]], source: str = "dhis2") -> list[dict[str, Any]]:
    """Normalize and aggregate extracted rows to the fact_indicator_values schema.

    Preserves org_unit granularity: rows at province level are kept as-is
    (one row per indicator + period + org_unit). Rows from the raw fallback
    (per-facility) are aggregated up to their org_unit level.

    For percentage indicators, the aggregation is a MEAN (not sum) —
    summing percentages would produce nonsensical values.
    """
    # Track which indicators are percentages (don't sum them)
    # Import here to avoid circular imports
    try:
        from app.etl.sources.dhis2 import ALL_DEFINITIONS
        percent_indicators = {
            ind["id"] for ind in ALL_DEFINITIONS if ind.get("unit") == "percent"
        }
    except ImportError:
        percent_indicators = set()

    # Group by (indicator_id, period, org_unit) — preserve org_unit granularity
    # For count indicators: sum values
    # For percent indicators: take the mean (they're already computed ratios)
    grouped: dict[tuple[str, str, str], list[float]] = {}
    for row in rows:
        key = (row["indicator_id"], row["period"], row["org_unit"])
        grouped.setdefault(key, []).append(row["value"])

    transformed: list[dict[str, Any]] = []
    for (indicator_id, period, org_unit), values in grouped.items():
        if indicator_id in percent_indicators:
            # Mean of percentage values (avoid summing rates)
            value = sum(values) / len(values) if values else 0
        else:
            # Sum of count values
            value = sum(values)
        transformed.append({
            "source": source,
            "indicator_id": indicator_id,
            "org_unit_id": org_unit,
            "period": period,
            "value": round(value, 2),
        })
    return transformed
