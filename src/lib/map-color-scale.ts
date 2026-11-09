export type ColorScaleType = "sequential" | "threshold";

export interface ColorStop {
  value: number;
  color: string;
}

const SEQUENTIAL_COLORS = [
  "#EFF6FF",
  "#DBEAFE",
  "#BFDBFE",
  "#93C5FD",
  "#60A5FA",
  "#3B82F6",
  "#2563EB",
  "#1D4ED8",
  "#174A8B",
];

export function quantileScale(values: number[]): (value: number) => string {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return () => SEQUENTIAL_COLORS[0];

  return (value: number) => {
    if (!Number.isFinite(value)) return "#e5e7eb";
    const idx = sorted.findIndex((v) => v >= value);
    if (idx === -1) return SEQUENTIAL_COLORS[SEQUENTIAL_COLORS.length - 1];
    const bucketIdx = Math.floor(
      (idx / sorted.length) * SEQUENTIAL_COLORS.length,
    );
    return SEQUENTIAL_COLORS[Math.min(bucketIdx, SEQUENTIAL_COLORS.length - 1)];
  };
}

export function thresholdScale(
  stops: ColorStop[],
): (value: number) => string {
  return (value: number) => {
    if (!Number.isFinite(value)) return "#e5e7eb";
    for (let i = stops.length - 1; i >= 0; i--) {
      if (value >= stops[i].value) return stops[i].color;
    }
    return stops[0]?.color ?? "#e5e7eb";
  };
}

export function defaultSequentialScale(
  values: number[],
): (value: number) => string {
  return quantileScale(values);
}

export const LEGEND_COLORS = SEQUENTIAL_COLORS;
