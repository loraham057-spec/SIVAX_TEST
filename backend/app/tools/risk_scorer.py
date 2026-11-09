"""Risk scorer — computes a transparent, explainable risk score per
province (Zone de Santé / DPS) based on vaccination indicators.

The score combines:
- Coverage Penta3 (weight: 30%)
- Penta1-Penta3 dropout (weight: 25%)
- Coverage trend (weight: 20%)
- BCG coverage (weight: 15%)
- Sous-vaccinés count (weight: 10%)

Each factor is normalized to [0, 1] and weighted. The final score is [0, 100]
where 100 = maximum risk.

The score is EXPLAINABLE: each factor's contribution is returned so the
user can understand WHY a province is flagged as high-risk.

Source: ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §4 (risk score formula)
"""

from __future__ import annotations

from typing import Any

from app.tools.semantic_layer import SemanticLayer


# Default weights (configurable)
DEFAULT_WEIGHTS: dict[str, float] = {
    "coverage_penta3": 0.30,
    "dropout_penta1_penta3": 0.25,
    "coverage_trend": 0.20,
    "coverage_bcg": 0.15,
    "sous_vaccines": 0.10,
}

# DHIS2 indicator IDs used by the risk score
RISK_INDICATORS = {
    "coverage_penta3": "v9b9aYsA5PM",
    "dropout_penta1_penta3": "MULXtL8iom8",
    "coverage_bcg": "cWJXYKCXrLx",
    "sous_vaccines": "RMHgIqfBG7N",
}


def _normalize_01(value: float, min_val: float, max_val: float) -> float:
    """Normalize a value to [0, 1] range."""
    if max_val == min_val:
        return 0.5
    return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))


def _normalize_inverse_01(value: float, min_val: float, max_val: float) -> float:
    """Normalize inversely: high value → low score (for coverage indicators)."""
    if max_val == min_val:
        return 0.5
    return max(0.0, min(1.0, (max_val - value) / (max_val - min_val)))


class RiskScorer:
    """Computes risk scores per province based on vaccination indicators."""

    def execute(self, action: str, args: dict) -> dict:
        if action == "compute_risk_scores":
            return self.compute_risk_scores(args)
        raise ValueError(f"Unknown risk scorer action: {action}")

    def compute_risk_scores(self, args: dict) -> dict:
        """Compute risk scores for all provinces.

        Args:
            args: {
                "province_data": list of {
                    "org_unit_id": str,
                    "org_unit_name": str,
                    "values": {
                        "v9b9aYsA5PM": float,  # Penta3 coverage
                        "MULXtL8iom8": float,  # Dropout
                        "cWJXYKCXrLx": float,  # BCG coverage
                        "RMHgIqfBG7N": float,  # Sous-vaccinés
                    },
                    "trend": {  # optional: Penta3 trend
                        "first": float,
                        "last": float,
                    }
                },
                "weights": dict (optional, overrides defaults)
            }

        Returns:
            {
                "status": "ready",
                "scores": list of {
                    "org_unit_id": str,
                    "org_unit_name": str,
                    "score": float,  # 0-100
                    "level": "low" | "moderate" | "high" | "critical",
                    "factors": dict of factor contributions,
                    "missing_factors": list of str,
                },
                "weights_used": dict,
                "methodology": str,
            }
        """
        weights = {**DEFAULT_WEIGHTS, **(args.get("weights") or {})}
        province_data = args.get("province_data", [])
        sem = SemanticLayer()

        scores: list[dict[str, Any]] = []
        for prov in province_data:
            values = prov.get("values", {})
            factors: dict[str, dict[str, Any]] = {}
            missing: list[str] = []
            weighted_sum = 0.0
            total_weight = 0.0

            # Factor 1: Coverage Penta3 (inverse: low coverage = high risk)
            penta3 = values.get(RISK_INDICATORS["coverage_penta3"])
            if penta3 is not None:
                # Normalize: 0% coverage → 1.0 risk, 100% coverage → 0.0 risk
                norm = _normalize_inverse_01(penta3, 0, 100)
                contribution = norm * weights["coverage_penta3"]
                threshold_eval = sem.evaluate_threshold(
                    RISK_INDICATORS["coverage_penta3"], penta3
                )
                factors["coverage_penta3"] = {
                    "value": penta3,
                    "normalized": round(norm, 3),
                    "weight": weights["coverage_penta3"],
                    "contribution": round(contribution, 3),
                    "threshold_status": threshold_eval["status"],
                }
                weighted_sum += contribution
                total_weight += weights["coverage_penta3"]
            else:
                missing.append("coverage_penta3")

            # Factor 2: Dropout Penta1-Penta3 (direct: high dropout = high risk)
            dropout = values.get(RISK_INDICATORS["dropout_penta1_penta3"])
            if dropout is not None:
                # Normalize: 0% dropout → 0.0 risk, 30% dropout → 1.0 risk
                norm = _normalize_01(dropout, 0, 30)
                contribution = norm * weights["dropout_penta1_penta3"]
                threshold_eval = sem.evaluate_threshold(
                    RISK_INDICATORS["dropout_penta1_penta3"], dropout
                )
                factors["dropout_penta1_penta3"] = {
                    "value": dropout,
                    "normalized": round(norm, 3),
                    "weight": weights["dropout_penta1_penta3"],
                    "contribution": round(contribution, 3),
                    "threshold_status": threshold_eval["status"],
                }
                weighted_sum += contribution
                total_weight += weights["dropout_penta1_penta3"]
            else:
                missing.append("dropout_penta1_penta3")

            # Factor 3: Coverage trend (declining = high risk)
            trend = prov.get("trend")
            if trend and trend.get("first") and trend.get("last"):
                first, last = trend["first"], trend["last"]
                if first > 0:
                    pct_change = ((last - first) / first) * 100
                    # Normalize: +10% improvement → 0.0 risk, -20% decline → 1.0 risk
                    norm = _normalize_01(-pct_change, -10, 20)
                    contribution = norm * weights["coverage_trend"]
                    factors["coverage_trend"] = {
                        "value": round(pct_change, 1),
                        "normalized": round(norm, 3),
                        "weight": weights["coverage_trend"],
                        "contribution": round(contribution, 3),
                        "threshold_status": "good" if pct_change > 0 else ("warning" if pct_change > -10 else "critical"),
                    }
                    weighted_sum += contribution
                    total_weight += weights["coverage_trend"]
            else:
                missing.append("coverage_trend")

            # Factor 4: BCG coverage (inverse: low = high risk)
            bcg = values.get(RISK_INDICATORS["coverage_bcg"])
            if bcg is not None:
                norm = _normalize_inverse_01(bcg, 0, 100)
                contribution = norm * weights["coverage_bcg"]
                threshold_eval = sem.evaluate_threshold(
                    RISK_INDICATORS["coverage_bcg"], bcg
                )
                factors["coverage_bcg"] = {
                    "value": bcg,
                    "normalized": round(norm, 3),
                    "weight": weights["coverage_bcg"],
                    "contribution": round(contribution, 3),
                    "threshold_status": threshold_eval["status"],
                }
                weighted_sum += contribution
                total_weight += weights["coverage_bcg"]
            else:
                missing.append("coverage_bcg")

            # Factor 5: Sous-vaccinés (direct: high count = high risk)
            sv = values.get(RISK_INDICATORS["sous_vaccines"])
            if sv is not None:
                # Normalize relative to max across all provinces
                # (done in a second pass — for now use absolute threshold)
                norm = _normalize_01(sv, 0, 10000)  # provisional max
                contribution = norm * weights["sous_vaccines"]
                factors["sous_vaccines"] = {
                    "value": sv,
                    "normalized": round(norm, 3),
                    "weight": weights["sous_vaccines"],
                    "contribution": round(contribution, 3),
                }
                weighted_sum += contribution
                total_weight += weights["sous_vaccines"]
            else:
                missing.append("sous_vaccines")

            # Final score: weighted average × 100
            score = (weighted_sum / total_weight * 100) if total_weight > 0 else 50.0

            # Risk level
            if score >= 70:
                level = "critical"
            elif score >= 50:
                level = "high"
            elif score >= 30:
                level = "moderate"
            else:
                level = "low"

            scores.append({
                "org_unit_id": prov.get("org_unit_id"),
                "org_unit_name": prov.get("org_unit_name"),
                "score": round(score, 1),
                "level": level,
                "factors": factors,
                "missing_factors": missing,
            })

        # Sort by score descending (highest risk first)
        scores.sort(key=lambda x: x["score"], reverse=True)

        # Second pass: normalize sous-vaccinés relative to actual max
        sv_values = [s["factors"].get("sous_vaccines", {}).get("value") for s in scores
                     if "sous_vaccines" in s["factors"]]
        if sv_values:
            sv_max = max(sv_values)
            if sv_max > 0:
                for s in scores:
                    if "sous_vaccines" in s["factors"]:
                        sv_val = s["factors"]["sous_vaccines"]["value"]
                        new_norm = min(1.0, sv_val / sv_max)
                        s["factors"]["sous_vaccines"]["normalized"] = round(new_norm, 3)
                        s["factors"]["sous_vaccines"]["contribution"] = round(
                            new_norm * weights["sous_vaccines"], 3
                        )
                # Recompute scores
                for s in scores:
                    weighted_sum = sum(f["contribution"] for f in s["factors"].values())
                    total_w = sum(f["weight"] for f in s["factors"].values())
                    s["score"] = round((weighted_sum / total_w * 100) if total_w > 0 else 50.0, 1)
                    if s["score"] >= 70:
                        s["level"] = "critical"
                    elif s["score"] >= 50:
                        s["level"] = "high"
                    elif s["score"] >= 30:
                        s["level"] = "moderate"
                    else:
                        s["level"] = "low"
                scores.sort(key=lambda x: x["score"], reverse=True)

        methodology = (
            "Score de risque = moyenne pondérée de 5 facteurs normalisés [0-1] × 100:\n"
            f"  - Couverture Penta3 (poids {weights['coverage_penta3']:.0%}): faible couverture = risque élevé\n"
            f"  - Abandon Penta1-Penta3 (poids {weights['dropout_penta1_penta3']:.0%}): abandon élevé = risque élevé\n"
            f"  - Tendance couverture (poids {weights['coverage_trend']:.0%}): baisse = risque élevé\n"
            f"  - Couverture BCG (poids {weights['coverage_bcg']:.0%}): faible couverture = risque élevé\n"
            f"  - Sous-vaccinés (poids {weights['sous_vaccines']:.0%}): nombre élevé = risque élevé\n"
            "Niveaux: 0-29 = faible, 30-49 = modéré, 50-69 = élevé, 70-100 = critique"
        )

        return {
            "status": "ready",
            "scores": scores,
            "weights_used": weights,
            "methodology": methodology,
        }
