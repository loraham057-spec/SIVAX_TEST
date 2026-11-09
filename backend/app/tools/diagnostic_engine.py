"""Diagnostic engine — identifies factors associated with performance gaps.

Given a set of provinces and their indicator values, the diagnostic engine:
1. Identifies which provinces are below threshold (the "gap")
2. Correlates the primary indicator with secondary indicators (dropout, loss, etc.)
3. Identifies which factors are most associated with poor performance
4. Generates hypotheses about WHY the gap exists
5. Computes a confidence level for each hypothesis based on:
   - Statistical strength (|r|, sample size)
   - Data quality (completeness × promptitude × concordance) when available

IMPORTANT: This engine identifies STATISTICAL ASSOCIATIONS, not causality.
All outputs must be framed as "associated with" or "correlated with",
never as "causes" or "proven". The final interpretation is left to the
human decision-maker. The confidence level is always displayed, never masked.

Source: ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §4, §7.2.7
"""

from __future__ import annotations

import statistics
from typing import Any

from app.tools.semantic_layer import SemanticLayer, INDICATOR_DEFINITIONS


def _pearson_correlation(x: list[float], y: list[float]) -> float:
    """Compute Pearson correlation coefficient. Returns 0 if not enough data."""
    n = min(len(x), len(y))
    if n < 3:
        return 0.0
    x, y = x[:n], y[:n]
    mean_x, mean_y = statistics.mean(x), statistics.mean(y)
    try:
        std_x, std_y = statistics.stdev(x), statistics.stdev(y)
    except statistics.StatisticsError:
        return 0.0
    if std_x == 0 or std_y == 0:
        return 0.0
    cov = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x, y)) / n
    return cov / (std_x * std_y)


def _interpret_correlation(r: float) -> str:
    """Interpret a correlation coefficient."""
    abs_r = abs(r)
    if abs_r >= 0.7:
        strength = "forte"
    elif abs_r >= 0.4:
        strength = "modérée"
    elif abs_r >= 0.2:
        strength = "faible"
    else:
        strength = "négligeable"
    direction = "positive" if r > 0 else "négative"
    return f"corrélation {strength} {direction} (r={r:.2f})"


def _confidence_level(
    correlation: float,
    n_provinces: int,
    data_quality: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Compute a confidence level for a hypothesis.

    The confidence combines:
    - Statistical strength: |r| weighted by sample size
    - Data quality: completeness × promptitude × concordance (0-1 each)
      When data quality is not available, a neutral factor (0.7) is applied
      and the confidence label is downgraded one notch to remain transparent.

    Returns:
        {
            "score": float (0-1),
            "label": "élevée" | "moyenne" | "faible" | "très faible",
            "factors": dict explaining the components,
        }
    """
    abs_r = abs(correlation)

    # Statistical component (0-1): combines correlation strength and sample size
    # |r| >= 0.7 with n >= 15 → near 1.0
    # |r| < 0.2 or n < 5 → near 0
    stat_strength = min(abs_r, 1.0)
    sample_factor = min(n_provinces / 15.0, 1.0)
    stat_score = stat_strength * (0.6 + 0.4 * sample_factor)

    # Data quality component (0-1)
    if data_quality:
        completeness = data_quality.get("completeness", 0.7)
        promptitude = data_quality.get("promptitude", 0.7)
        concordance = data_quality.get("concordance", 0.7)
        dq_score = completeness * promptitude * concordance
        dq_available = True
    else:
        # Neutral factor when data quality metrics are unavailable
        dq_score = 0.7
        dq_available = False

    # Combined confidence
    score = stat_score * dq_score
    score = max(0.0, min(1.0, score))

    # Label — downgraded one notch when data quality is unknown
    if score >= 0.7:
        label = "élevée" if dq_available else "moyenne"
    elif score >= 0.4:
        label = "moyenne" if dq_available else "faible"
    elif score >= 0.2:
        label = "faible"
    else:
        label = "très faible"

    return {
        "score": round(score, 2),
        "label": label,
        "factors": {
            "correlation_strength": round(stat_strength, 2),
            "sample_size": n_provinces,
            "sample_factor": round(sample_factor, 2),
            "statistical_score": round(stat_score, 2),
            "data_quality_score": round(dq_score, 2),
            "data_quality_available": dq_available,
        },
    }


class DiagnosticEngine:
    """Identifies factors associated with vaccination performance gaps."""

    def execute(self, action: str, args: dict) -> dict:
        if action == "diagnose_gaps":
            return self.diagnose_gaps(args)
        raise ValueError(f"Unknown diagnostic engine action: {action}")

    def diagnose_gaps(self, args: dict) -> dict:
        """Diagnose performance gaps across provinces.

        Args:
            args: {
                "primary_indicator": str (DHIS2 UID, e.g. "v9b9aYsA5PM" for Penta3),
                "province_data": list of {
                    "org_unit_id": str,
                    "org_unit_name": str,
                    "values": {indicator_id: value, ...}
                },
                "secondary_indicators": list of str (optional, auto-selected if not provided),
                "data_quality": dict with completeness, promptitude, concordance (0-1, optional)
            }

        Returns:
            {
                "status": "ready",
                "primary_indicator": {...},
                "gaps": list of provinces below threshold,
                "factors": list of { ... "confidence": {...} },
                "hypotheses": list of { "text": str, "confidence": {...} },
                "methodology": str,
            }
        """
        sem = SemanticLayer()
        primary_id = args.get("primary_indicator", "v9b9aYsA5PM")
        province_data = args.get("province_data", [])
        data_quality = args.get("data_quality")  # optional

        if not province_data:
            return {"status": "no_data", "message": "Aucune donnée de province fournie"}

        # Get primary indicator definition
        primary_def = INDICATOR_DEFINITIONS.get(primary_id, {})
        primary_name = primary_def.get("short_name", primary_id)
        primary_thresholds = primary_def.get("thresholds", {})
        inverted = primary_def.get("inverted", False)

        # ─── 1. Identify provinces below threshold (the gap) ───
        critical_threshold = primary_thresholds.get("critical")
        warning_threshold = primary_thresholds.get("warning")
        target = primary_thresholds.get("target")

        gaps: list[dict[str, Any]] = []
        for prov in province_data:
            value = prov.get("values", {}).get(primary_id)
            if value is None:
                continue
            threshold_eval = sem.evaluate_threshold(primary_id, value)
            if threshold_eval["status"] in ("critical", "warning"):
                gaps.append({
                    "org_unit_id": prov["org_unit_id"],
                    "org_unit_name": prov["org_unit_name"],
                    "value": value,
                    "status": threshold_eval["status"],
                    "label": threshold_eval.get("label", ""),
                    "gap_to_target": round(target - value, 1) if target and not inverted else round(value - target, 1) if target else None,
                })

        gaps.sort(key=lambda x: x["value"] if not inverted else -x["value"])

        # ─── 2. Auto-select secondary indicators for correlation ───
        secondary_ids = args.get("secondary_indicators")
        if not secondary_ids:
            # Auto-select: all vaccination indicators except the primary
            secondary_ids = [
                uid for uid in INDICATOR_DEFINITIONS
                if uid != primary_id
                and INDICATOR_DEFINITIONS[uid].get("domain") == "vaccination"
                and INDICATOR_DEFINITIONS[uid].get("unit") in ("percent", "count")
            ][:5]  # limit to 5

        # ─── 3. Compute correlations ───
        primary_values = [
            prov.get("values", {}).get(primary_id)
            for prov in province_data
            if prov.get("values", {}).get(primary_id) is not None
        ]

        factors: list[dict[str, Any]] = []
        for sec_id in secondary_ids:
            sec_values = [
                prov.get("values", {}).get(sec_id)
                for prov in province_data
                if prov.get("values", {}).get(primary_id) is not None
            ]
            # Pair up non-None values
            paired_x, paired_y = [], []
            for prov in province_data:
                pv = prov.get("values", {}).get(primary_id)
                sv = prov.get("values", {}).get(sec_id)
                if pv is not None and sv is not None:
                    paired_x.append(pv)
                    paired_y.append(sv)

            if len(paired_x) < 3:
                continue

            r = _pearson_correlation(paired_x, paired_y)
            sec_def = INDICATOR_DEFINITIONS.get(sec_id, {})
            confidence = _confidence_level(r, len(paired_x), data_quality)
            factors.append({
                "indicator_id": sec_id,
                "name": sec_def.get("short_name", sec_id),
                "correlation": round(r, 3),
                "interpretation": _interpret_correlation(r),
                "direction": "positive" if r > 0 else "negative",
                "n_provinces": len(paired_x),
                "confidence": confidence,
            })

        # Sort by absolute correlation
        factors.sort(key=lambda x: abs(x["correlation"]), reverse=True)

        # ─── 4. Generate hypotheses with confidence levels ───
        hypotheses: list[dict[str, Any]] = []
        for f in factors[:3]:  # top 3 factors
            sec_def = INDICATOR_DEFINITIONS.get(f["indicator_id"], {})
            sec_name = sec_def.get("short_name", f["indicator_id"])
            r = f["correlation"]
            conf = f["confidence"]

            if abs(r) < 0.2:
                continue

            if r < -0.3:
                # Negative correlation: high secondary → low primary
                if sec_def.get("inverted"):
                    text = (
                        f"Les provinces avec un {sec_name} élevé tendent à avoir "
                        f"un {primary_name} plus faible (r={r:.2f}). "
                        f"Cette association suggère que le {sec_name} est un facteur "
                        f"associé à la sous-performance — à investiguer."
                    )
                else:
                    text = (
                        f"Les provinces avec un {sec_name} élevé tendent à avoir "
                        f"un {primary_name} plus faible (r={r:.2f}). "
                        f"Association à explorer pour comprendre le mécanisme."
                    )
            elif r > 0.3:
                text = (
                    f"Les provinces avec un {sec_name} élevé tendent à avoir "
                    f"un {primary_name} plus élevé (r={r:.2f}). "
                    f"Le {sec_name} pourrait être un co-indicateur de bonne performance."
                )
            else:
                continue

            hypotheses.append({
                "text": text,
                "confidence": conf,
                "factor_indicator": sec_name,
                "correlation": r,
            })

        if not hypotheses:
            hypotheses.append({
                "text": (
                    f"Aucune association forte identifiée entre {primary_name} et les "
                    f"indicateurs disponibles. L'écart peut être dû à des facteurs non "
                    f"mesurés dans DHIS2 (logistique, ressources humaines, accessibilité)."
                ),
                "confidence": _confidence_level(0.0, len(province_data), data_quality),
                "factor_indicator": None,
                "correlation": 0.0,
            })

        # Add disclaimer as a final hypothesis entry with minimal confidence
        hypotheses.append({
            "text": (
                "Ces hypothèses sont basées sur des associations statistiques, "
                "non sur des relations causales. Une investigation terrain est nécessaire "
                "pour confirmer les mécanismes."
            ),
            "confidence": {"score": 1.0, "label": "élevée", "factors": {"disclaimer": True}},
            "factor_indicator": None,
            "correlation": None,
        })

        methodology = (
            "Méthode diagnostique:\n"
            f"1. Identification des provinces sous le seuil ({primary_name} < {warning_threshold}%)\n"
            f"2. Calcul de corrélation de Pearson entre {primary_name} et {len(secondary_ids)} indicateurs secondaires\n"
            "3. Génération d'hypothèses basées sur les corrélations significatives (|r| > 0.3)\n"
            "4. Calcul du niveau de confiance par hypothèse (force statistique × qualité des données)\n"
            "Les corrélations n'impliquent pas de causalité. Le niveau de confiance est "
            "toujours affiché et reflète la qualité des données sous-jacentes."
        )

        return {
            "status": "ready",
            "primary_indicator": {
                "id": primary_id,
                "name": primary_name,
                "thresholds": primary_thresholds,
            },
            "total_provinces": len(province_data),
            "provinces_below_threshold": len(gaps),
            "gaps": gaps,
            "factors": factors,
            "hypotheses": hypotheses,
            "methodology": methodology,
        }
