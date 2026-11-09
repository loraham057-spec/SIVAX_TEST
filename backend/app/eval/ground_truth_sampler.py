"""
Phase 1 — Ground Truth Sampler.

Queries Supabase for real (indicator, org_unit, period, value) tuples and
enriches them with human-readable names from dim_indicators / dim_org_units.

The sampler ensures diversity across:
    - Indicator categories (vaccination, stock, reporting rate, …)
    - Org unit levels (province, zone de santé)
    - Periods

Each sample is a "ground truth" — we KNOW the correct answer because we
pulled it from the database. The question generator then creates NL
questions that should produce this answer when run through the agent.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any

from app.tools.supabase_data import _get_client


@dataclass
class GroundTruth:
    """A single data point with known correct answer."""
    indicator_id: str
    indicator_label: str
    org_unit_id: str
    org_unit_name: str
    org_unit_level: int
    period: str  # "202607"
    value: float
    # Metadata for question generation
    antigen: str | None = None  # "bcg", "penta3", … if extractable from label
    province_name: str | None = None  # parent province name for ZS-level rows

    @property
    def period_text(self) -> str:
        """Human-readable period: '202607' → 'juillet 2026'."""
        months_fr = [
            "janvier", "février", "mars", "avril", "mai", "juin",
            "juillet", "août", "septembre", "octobre", "novembre", "décembre",
        ]
        if len(self.period) == 6:
            y, m = self.period[:4], int(self.period[4:])
            if 1 <= m <= 12:
                return f"{months_fr[m - 1]} {y}"
        return self.period

    @property
    def geo_name_clean(self) -> str:
        """Org unit name without the 2-letter DHIS2 prefix."""
        import re
        return re.sub(r"^[a-z]{2}\s+", "", self.org_unit_name)

    @property
    def geo_type(self) -> str:
        """'province' or 'zone de santé'."""
        return "Province" if self.org_unit_level == 2 else "Zone de Santé"


def _extract_antigen(label: str) -> str | None:
    """Extract antigen name from indicator label (e.g. 'BCG', 'Pentavalent 1')."""
    label_lower = label.lower()
    antigens = {
        "bcg": "BCG",
        "pentavalent 1": "Penta1", "penta1": "Penta1", "pentavalent1": "Penta1",
        "pentavalent 3": "Penta3", "penta3": "Penta3", "pentavalent3": "Penta3",
        "polio": "Polio", "vpi": "VPI", "var": "VAR",
        "rougeole": "Rougeole", "measles": "Rougeole",
        "fièvre jaune": "Fièvre jaune", "yellow fever": "Fièvre jaune",
        "tt": "TT",
    }
    for key, antigen in antigens.items():
        if key in label_lower:
            return antigen
    return None


def sample_ground_truths(
    n: int = 50,
    min_value: float = 0.1,
    max_org_level: int = 3,
    indicator_filter: str | None = None,
) -> list[GroundTruth]:
    """Sample n diverse ground truth tuples from Supabase.

    Args:
        n: number of samples
        min_value: minimum value (skip zeros / nulls for coverage questions)
        max_org_level: max org unit level to sample (2=province, 3=ZS)
        indicator_filter: optional indicator_id to restrict to

    Returns:
        list of GroundTruth objects with known correct answers.
    """
    client = _get_client()
    if not client:
        return []

    # ── Load indicators ──
    ind_resp = client.table("dim_indicators").select("id,label").execute()
    indicators = {ind["id"]: ind["label"] for ind in (ind_resp.data or [])}

    # ── Load org units ──
    ou_resp = (
        client.table("dim_org_units")
        .select("id,name,level,province_id")
        .lte("level", max_org_level)
        .execute()
    )
    org_units = {ou["id"]: ou for ou in (ou_resp.data or [])}

    # ── Load province names for ZS-level enrichment ──
    province_names = {}
    for ou in org_units.values():
        if ou["level"] == 2:
            import re
            province_names[ou["id"]] = re.sub(r"^[a-z]{2}\s+", "", ou["name"])

    # ── Sample fact_indicator_values ──
    # Strategy: query a random subset, filter for non-trivial values,
    # ensure diversity across indicators and org units.
    query = (
        client.table("fact_indicator_values")
        .select("indicator_id,org_unit_id,period,value")
        .gte("value", min_value)
    )
    if indicator_filter:
        query = query.eq("indicator_id", indicator_filter)

    # Limit to a large pool, then sample in-memory for diversity
    pool = query.limit(5000).execute()
    rows = pool.data or []
    if not rows:
        return []

    # ── Enrich and deduplicate by (indicator, org_unit, period) ──
    enriched: list[GroundTruth] = []
    seen_keys: set[tuple] = set()
    for row in rows:
        key = (row["indicator_id"], row["org_unit_id"], row["period"])
        if key in seen_keys:
            continue
        ou = org_units.get(row["org_unit_id"])
        if not ou:
            continue
        ind_label = indicators.get(row["indicator_id"], row["indicator_id"])
        province_name = None
        if ou["level"] == 3 and ou.get("province_id"):
            province_name = province_names.get(ou["province_id"])
        gt = GroundTruth(
            indicator_id=row["indicator_id"],
            indicator_label=ind_label,
            org_unit_id=row["org_unit_id"],
            org_unit_name=ou["name"],
            org_unit_level=ou["level"],
            period=row["period"],
            value=float(row["value"]),
            antigen=_extract_antigen(ind_label),
            province_name=province_name,
        )
        enriched.append(gt)
        seen_keys.add(key)

    # ── Diversity sampling ──
    # Ensure we cover different indicators, levels, and periods
    by_indicator: dict[str, list[GroundTruth]] = {}
    for gt in enriched:
        by_indicator.setdefault(gt.indicator_id, []).append(gt)

    # Sample evenly across indicators
    selected: list[GroundTruth] = []
    indicator_ids = list(by_indicator.keys())
    random.shuffle(indicator_ids)
    per_indicator = max(1, n // max(len(indicator_ids), 1))
    for ind_id in indicator_ids:
        candidates = by_indicator[ind_id]
        random.shuffle(candidates)
        selected.extend(candidates[:per_indicator])
        if len(selected) >= n:
            break

    return selected[:n]
