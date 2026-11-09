import { PEV_THRESHOLDS } from "@/lib/pev/thresholds";

export type ThresholdStatus = "good" | "warning" | "critical";

export interface KpiThreshold {
  good: number;
  warning: number;
  higherIsBetter: boolean;
}

const DEFAULT_THRESHOLD: KpiThreshold = {
  good: 0,
  warning: 50,
  higherIsBetter: false,
};

const pev = (key: keyof typeof PEV_THRESHOLDS, higherIsBetter: boolean): KpiThreshold => ({
  good: PEV_THRESHOLDS[key].target,
  warning: PEV_THRESHOLDS[key].warning,
  higherIsBetter,
});
const COVERAGE = pev("coverage", true);
const STOCKOUT = pev("stockout", false);
const COMPLETENESS = pev("data_quality", true);

const THRESHOLDS: Record<string, KpiThreshold> = {
  "Taux de létalité": { good: 5, warning: 10, higherIsBetter: false },
  "Case Fatality Rate": { good: 5, warning: 10, higherIsBetter: false },
  "Taux de couverture vaccinale": COVERAGE,
  "Vaccination coverage": COVERAGE,
  "Couverture vaccinale": COVERAGE,
  "Complétude": COMPLETENESS,
  "Promptitude": { good: 80, warning: 70, higherIsBetter: true },
  "% FOSA en rupture": STOCKOUT,
  "Taux de réalisation": { good: 90, warning: 80, higherIsBetter: true },
  "Taux d'exécution": { good: 80, warning: 60, higherIsBetter: true },
  "% facilities in stock-out": STOCKOUT,
  "completion rate": { good: 90, warning: 80, higherIsBetter: true },
  "execution rate": { good: 80, warning: 60, higherIsBetter: true },
};

export function getThreshold(label: string): KpiThreshold | null {
  for (const [key, value] of Object.entries(THRESHOLDS)) {
    if (label.toLowerCase().includes(key.toLowerCase())) return value;
  }
  return null;
}

export function getThresholdStatus(
  value: number,
  label: string,
): ThresholdStatus | null {
  const threshold = getThreshold(label);
  if (!threshold) return null;

  if (threshold.higherIsBetter) {
    if (value >= threshold.good) return "good";
    if (value >= threshold.warning) return "warning";
    return "critical";
  } else {
    if (value <= threshold.good) return "good";
    if (value <= threshold.warning) return "warning";
    return "critical";
  }
}

export function thresholdColor(status: ThresholdStatus): string {
  switch (status) {
    case "good":
      return "bg-emerald-500";
    case "warning":
      return "bg-amber-500";
    case "critical":
      return "bg-rose-500";
  }
}

export function thresholdTextColor(status: ThresholdStatus): string {
  switch (status) {
    case "good":
      return "text-emerald-600";
    case "warning":
      return "text-amber-600";
    case "critical":
      return "text-rose-600";
  }
}

export function thresholdBorder(status: ThresholdStatus): string {
  switch (status) {
    case "good":
      return "border-emerald-500/40";
    case "warning":
      return "border-amber-500/40";
    case "critical":
      return "border-rose-500/40";
  }
}
