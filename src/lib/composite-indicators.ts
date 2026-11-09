export interface CompositeIndicator {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  unit: "percent" | "ratio";
  thresholdStatus: "good" | "warning" | "critical" | null;
}

export function caseFatalityRate(deaths: number, confirmedCases: number): number {
  if (confirmedCases === 0) return 0;
  return (deaths / confirmedCases) * 100;
}

export function vaccinationCoverage(
  vaccinated: number,
  targetPopulation: number,
): number {
  if (targetPopulation === 0) return 0;
  return (vaccinated / targetPopulation) * 100;
}

export function suspectedToConfirmedRatio(
  suspected: number,
  confirmed: number,
): number {
  if (confirmed === 0) return 0;
  return suspected / confirmed;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatRatio(value: number): string {
  return `${value.toFixed(2)}:1`;
}

function fatalityThreshold(value: number): "good" | "warning" | "critical" {
  if (value <= 5) return "good";
  if (value <= 10) return "warning";
  return "critical";
}

function coverageThreshold(value: number): "good" | "warning" | "critical" {
  if (value >= 85) return "good";
  if (value >= 70) return "warning";
  return "critical";
}

export function buildCompositeIndicators(params: {
  deaths?: number;
  confirmedCases?: number;
  vaccinated?: number;
  targetPopulation?: number;
  suspected?: number;
  confirmed?: number;
}): CompositeIndicator[] {
  const indicators: CompositeIndicator[] = [];

  if (params.deaths !== undefined && params.confirmedCases !== undefined) {
    const cfr = caseFatalityRate(params.deaths, params.confirmedCases);
    indicators.push({
      id: "cfr",
      label: "Taux de létalité",
      value: cfr,
      formattedValue: formatPercent(cfr),
      unit: "percent",
      thresholdStatus: fatalityThreshold(cfr),
    });
  }

  if (params.vaccinated !== undefined && params.targetPopulation !== undefined) {
    const cov = vaccinationCoverage(
      params.vaccinated,
      params.targetPopulation,
    );
    indicators.push({
      id: "coverage",
      label: "Taux de couverture vaccinale",
      value: cov,
      formattedValue: formatPercent(cov),
      unit: "percent",
      thresholdStatus: coverageThreshold(cov),
    });
  }

  if (params.suspected !== undefined && params.confirmed !== undefined) {
    const ratio = suspectedToConfirmedRatio(params.suspected, params.confirmed);
    indicators.push({
      id: "suspected_confirmed",
      label: "Ratio suspects/confirmés",
      value: ratio,
      formattedValue: formatRatio(ratio),
      unit: "ratio",
      thresholdStatus: null,
    });
  }

  return indicators;
}
