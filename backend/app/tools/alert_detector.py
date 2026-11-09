"""Alert detector — detects early warnings based on indicator trends and
threshold breaches.

The alert detector compares current indicator values against:
1. A historical baseline (configurable window, default: previous 3 periods)
2. Configurable thresholds (decline magnitude, dropout level, stock-out duration)

Alert types implemented (per ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §7.2.6):
- COVERAGE_DECLINE: coverage drops by more than `coverage_decline_threshold`
  compared to the baseline average.
- DROPOUT_SPIKE: dropout rate exceeds `dropout_critical_threshold`.
- TREND_REVERSAL: a previously improving trend reverses for >= 2 periods.
- THRESHOLD_BREACH: an indicator crosses its critical threshold from the
  semantic layer.

Each alert carries a severity (info / warning / critical) and a confidence
level based on the number of periods observed and the magnitude of the change.

Source: ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §7.2.6
"""

from __future__ import annotations

from typing import Any

from app.tools.semantic_layer import SemanticLayer, INDICATOR_DEFINITIONS


# Default alert thresholds (configurable via args)
DEFAULT_ALERT_THRESHOLDS: dict[str, Any] = {
    # Coverage decline: alert if current < baseline - threshold (percentage points)
    "coverage_decline_threshold": 5.0,
    "coverage_decline_critical_threshold": 10.0,
    # Dropout spike: alert if dropout > threshold
    "dropout_warning_threshold": 10.0,
    "dropout_critical_threshold": 15.0,
    # Trend reversal: number of consecutive declining periods to trigger
    "trend_reversal_periods": 2,
    # Minimum periods of history required to compute a baseline
    "min_baseline_periods": 3,
}


def _baseline_average(history: list[float]) -> float | None:
    """Compute the average of the historical baseline values."""
    if len(history) < DEFAULT_ALERT_THRESHOLDS["min_baseline_periods"]:
        return None
    return sum(history) / len(history)


def _trend_direction(values: list[float]) -> str:
    """Determine the trend direction of a series.

    Returns "up", "down", or "flat" based on the sign of the slope
    estimated by comparing the first and last third of the series.
    """
    n = len(values)
    if n < 2:
        return "flat"
    third = max(1, n // 3)
    first_avg = sum(values[:third]) / third
    last_avg = sum(values[-third:]) / third
    diff = last_avg - first_avg
    # Use a small tolerance proportional to the magnitude
    tol = max(abs(first_avg) * 0.02, 0.1)
    if diff > tol:
        return "up"
    if diff < -tol:
        return "down"
    return "flat"


class AlertDetector:
    """Detects early warnings based on indicator trends and threshold breaches."""

    def execute(self, action: str, args: dict) -> dict:
        if action == "detect_alerts":
            return self.detect_alerts(args)
        raise ValueError(f"Unknown alert detector action: {action}")

    def detect_alerts(self, args: dict) -> dict:
        """Detect alerts for one or more indicators across periods.

        Args:
            args: {
                "indicator_id": str (DHIS2 UID),
                "org_unit_id": str,
                "org_unit_name": str,
                "series": list of {"period": "YYYYMM", "value": float}
                    ordered chronologically (oldest first),
                "thresholds": dict (optional override of DEFAULT_ALERT_THRESHOLDS),
            }

        Returns:
            {
                "status": "ready",
                "indicator_id": str,
                "org_unit_id": str,
                "org_unit_name": str,
                "alerts": list of {
                    "type": "COVERAGE_DECLINE" | "DROPOUT_SPIKE" | "TREND_REVERSAL" | "THRESHOLD_BREACH",
                    "severity": "info" | "warning" | "critical",
                    "message": str,
                    "current_value": float,
                    "baseline_value": float | None,
                    "period": str,
                    "confidence": {"score": float, "label": str},
                },
                "summary": str,
            }
        """
        sem = SemanticLayer()
        indicator_id = args.get("indicator_id")
        org_unit_id = args.get("org_unit_id", "")
        org_unit_name = args.get("org_unit_name", "")
        series = args.get("series", [])
        thresholds = {**DEFAULT_ALERT_THRESHOLDS, **(args.get("thresholds") or {})}

        if not indicator_id or not series:
            return {"status": "no_data", "message": "indicator_id et series requis"}

        defn = INDICATOR_DEFINITIONS.get(indicator_id, {})
        indicator_name = defn.get("short_name", indicator_id)
        inverted = defn.get("inverted", False)

        # Sort series chronologically
        series = sorted(series, key=lambda x: x.get("period", ""))
        values = [s.get("value") for s in series if s.get("value") is not None]
        periods = [s.get("period") for s in series if s.get("value") is not None]

        if len(values) < 2:
            return {
                "status": "insufficient_data",
                "message": f"Seulement {len(values)} période(s) disponible(s), minimum 2 requis",
            }

        current_value = values[-1]
        current_period = periods[-1]
        history = values[:-1]
        baseline = _baseline_average(history)

        alerts: list[dict[str, Any]] = []

        def _confidence(score: float) -> dict[str, Any]:
            if score >= 0.7:
                label = "élevée"
            elif score >= 0.4:
                label = "moyenne"
            elif score >= 0.2:
                label = "faible"
            else:
                label = "très faible"
            return {"score": round(score, 2), "label": label}

        # ─── 1. Threshold breach (semantic layer critical threshold) ───
        threshold_eval = sem.evaluate_threshold(indicator_id, current_value)
        if threshold_eval["status"] == "critical":
            alerts.append({
                "type": "THRESHOLD_BREACH",
                "severity": "critical",
                "message": (
                    f"{indicator_name} = {current_value} pour {org_unit_name} "
                    f"en {current_period} — sous le seuil critique "
                    f"({threshold_eval.get('label', '')})"
                ),
                "current_value": current_value,
                "baseline_value": baseline,
                "period": current_period,
                "confidence": _confidence(0.9),
            })
        elif threshold_eval["status"] == "warning":
            alerts.append({
                "type": "THRESHOLD_BREACH",
                "severity": "warning",
                "message": (
                    f"{indicator_name} = {current_value} pour {org_unit_name} "
                    f"en {current_period} — sous le seuil d'attention "
                    f"({threshold_eval.get('label', '')})"
                ),
                "current_value": current_value,
                "baseline_value": baseline,
                "period": current_period,
                "confidence": _confidence(0.8),
            })

        # ─── 2. Coverage decline vs baseline ───
        if baseline is not None and not inverted:
            decline = baseline - current_value
            decline_threshold = thresholds["coverage_decline_threshold"]
            decline_critical = thresholds["coverage_decline_critical_threshold"]
            if decline >= decline_critical:
                alerts.append({
                    "type": "COVERAGE_DECLINE",
                    "severity": "critical",
                    "message": (
                        f"Baisse critique de {indicator_name} : {current_value} vs "
                        f"baseline {baseline:.1f} (chute de {decline:.1f} points) "
                        f"pour {org_unit_name} en {current_period}"
                    ),
                    "current_value": current_value,
                    "baseline_value": round(baseline, 2),
                    "period": current_period,
                    "confidence": _confidence(min(0.95, 0.6 + decline / 30)),
                })
            elif decline >= decline_threshold:
                alerts.append({
                    "type": "COVERAGE_DECLINE",
                    "severity": "warning",
                    "message": (
                        f"Baisse de {indicator_name} : {current_value} vs "
                        f"baseline {baseline:.1f} (chute de {decline:.1f} points) "
                        f"pour {org_unit_name} en {current_period}"
                    ),
                    "current_value": current_value,
                    "baseline_value": round(baseline, 2),
                    "period": current_period,
                    "confidence": _confidence(min(0.85, 0.5 + decline / 30)),
                })

        # ─── 3. Dropout spike (for inverted indicators like dropout rate) ───
        if inverted and defn.get("unit") == "percent":
            dropout_warning = thresholds["dropout_warning_threshold"]
            dropout_critical = thresholds["dropout_critical_threshold"]
            if current_value >= dropout_critical:
                alerts.append({
                    "type": "DROPOUT_SPIKE",
                    "severity": "critical",
                    "message": (
                        f"{indicator_name} = {current_value}% pour {org_unit_name} "
                        f"en {current_period} — au-dessus du seuil critique ({dropout_critical}%)"
                    ),
                    "current_value": current_value,
                    "baseline_value": round(baseline, 2) if baseline else None,
                    "period": current_period,
                    "confidence": _confidence(0.9),
                })
            elif current_value >= dropout_warning:
                alerts.append({
                    "type": "DROPOUT_SPIKE",
                    "severity": "warning",
                    "message": (
                        f"{indicator_name} = {current_value}% pour {org_unit_name} "
                        f"en {current_period} — au-dessus du seuil d'attention ({dropout_warning}%)"
                    ),
                    "current_value": current_value,
                    "baseline_value": round(baseline, 2) if baseline else None,
                    "period": current_period,
                    "confidence": _confidence(0.8),
                })

        # ─── 4. Trend reversal ───
        if len(values) >= thresholds["trend_reversal_periods"] + 1:
            recent = values[-(thresholds["trend_reversal_periods"] + 1):]
            # Check if the trend was improving then reversed
            prior_trend = _trend_direction(values[:-1])
            recent_trend = _trend_direction(recent)
            # For non-inverted indicators: "up" is good, "down" is a reversal
            # For inverted indicators: "down" is good, "up" is a reversal
            good_direction = "down" if inverted else "up"
            bad_direction = "up" if inverted else "down"
            if prior_trend == good_direction and recent_trend == bad_direction:
                alerts.append({
                    "type": "TREND_REVERSAL",
                    "severity": "warning",
                    "message": (
                        f"Renversement de tendance pour {indicator_name} à {org_unit_name} : "
                        f"la tendance s'améliorait ({prior_trend}) puis s'est dégradée ({recent_trend}) "
                        f"sur les {thresholds['trend_reversal_periods']} dernières périodes"
                    ),
                    "current_value": current_value,
                    "baseline_value": round(baseline, 2) if baseline else None,
                    "period": current_period,
                    "confidence": _confidence(0.6),
                })

        # ─── Summary ───
        if not alerts:
            summary = (
                f"Aucune alerte détectée pour {indicator_name} à {org_unit_name} "
                f"sur la période {current_period}."
            )
        else:
            n_critical = sum(1 for a in alerts if a["severity"] == "critical")
            n_warning = sum(1 for a in alerts if a["severity"] == "warning")
            parts = []
            if n_critical:
                parts.append(f"{n_critical} alerte(s) critique(s)")
            if n_warning:
                parts.append(f"{n_warning} alerte(s) d'attention")
            summary = (
                f"{len(alerts)} alerte(s) pour {indicator_name} à {org_unit_name} : "
                + ", ".join(parts)
            )

        return {
            "status": "ready",
            "indicator_id": indicator_id,
            "indicator_name": indicator_name,
            "org_unit_id": org_unit_id,
            "org_unit_name": org_unit_name,
            "alerts": alerts,
            "summary": summary,
            "thresholds_used": thresholds,
        }
