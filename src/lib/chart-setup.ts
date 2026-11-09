/**
 * Chart.js shared setup — registers only the components we need and
 * provides reusable option builders with French tooltips and formatting.
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";

import { formatDhis2Period, formatDhis2Value, formatCoveragePercent } from "@/lib/dhis2-format";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

export { ChartJS };

/** Resolve CSS --primary variable to a concrete color (with fallback). */
export function primaryColor(): string {
  if (typeof window === "undefined") return "#174A8B";
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  if (!v) return "#174A8B";
  // HSL values like "222.2 47.4% 11.2%" → wrap in hsl()
  if (v.includes("%")) return `hsl(${v})`;
  return v;
}

/** A palette of distinct colors for multi-series / pie charts. */
export const CHART_PALETTE = [
  "#174A8B", // SIVAX blue
  "#13A89E", // teal
  "#16A34A", // positive
  "#F59E0B", // attention
  "#DC2626", // critical
  "#7C3AED", // AI / analysis
  "#0E7490",
  "#64748B",
  "#C2410C",
  "#4F46E5",
];

/** Common base options for all charts: responsive, no legend by default. */
export function baseOptions(): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
  };
}

/** Tooltip label callback that formats the value in French locale. */
export function valueTooltipCallback(
  this: unknown,
  context: TooltipItem<"line" | "bar" | "doughnut">,
): string {
  const raw = context.parsed.y ?? context.parsed;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return "—";
  return formatDhis2Value(num);
}

/** Tooltip label callback that formats the value as a coverage percentage. */
export function percentTooltipCallback(
  this: unknown,
  context: TooltipItem<"line" | "bar" | "doughnut">,
): string {
  const raw = context.parsed.y ?? context.parsed;
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num)) return "—";
  return formatCoveragePercent(num);
}

/** Tooltip title callback that converts YYYYMM → "juillet 2025". */
export function periodTooltipTitleCallback(
  this: unknown,
  contexts: TooltipItem<"line" | "bar">[],
): string {
  const label = contexts[0]?.label ?? "";
  if (/^\d{6}$/.test(label)) return formatDhis2Period(label);
  return label;
}

/** Build line chart options with French tooltips and grid styling. */
export function lineChartOptions(yLabel = "Valeur"): ChartOptions<"line"> {
  return {
    ...(baseOptions() as ChartOptions<"line">),
    interaction: { mode: "index", intersect: false },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 13 }, color: "#64748b" },
      },
      y: {
        grid: { color: "rgba(148, 163, 184, 0.12)" },
        ticks: {
          font: { size: 13 },
          color: "#64748b",
          callback: function (value) {
            const n = Number(value);
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
            return String(value);
          },
        },
        title: { display: true, text: yLabel, font: { size: 13 }, color: "#64748b" },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        padding: 12,
        cornerRadius: 8,
        titleFont: { size: 13, weight: "bold" as const },
        bodyFont: { size: 13 },
        callbacks: {
          title: periodTooltipTitleCallback as (ctx: TooltipItem<"line">[]) => string,
          label: valueTooltipCallback as (ctx: TooltipItem<"line">) => string,
        },
      },
    },
  };
}

/** Build bar chart options with French tooltips. */
export function barChartOptions(yLabel = "Valeur"): ChartOptions<"bar"> {
  return {
    ...(baseOptions() as ChartOptions<"bar">),
    interaction: { mode: "index", intersect: false },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 13 }, color: "#64748b" },
      },
      y: {
        grid: { color: "rgba(148, 163, 184, 0.12)" },
        ticks: {
          font: { size: 13 },
          color: "#64748b",
          callback: function (value) {
            const n = Number(value);
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
            return String(value);
          },
        },
        title: { display: true, text: yLabel, font: { size: 13 }, color: "#64748b" },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        padding: 12,
        cornerRadius: 8,
        titleFont: { size: 13, weight: "bold" as const },
        bodyFont: { size: 13 },
        callbacks: {
          title: periodTooltipTitleCallback as (ctx: TooltipItem<"bar">[]) => string,
          label: valueTooltipCallback as (ctx: TooltipItem<"bar">) => string,
        },
      },
    },
  };
}

/** Build horizontal bar chart options. */
export function horizontalBarOptions(): ChartOptions<"bar"> {
  return {
    ...(baseOptions() as ChartOptions<"bar">),
    indexAxis: "y" as const,
    interaction: { mode: "index", intersect: false },
    scales: {
      x: {
        grid: { color: "rgba(148, 163, 184, 0.12)" },
        ticks: {
          font: { size: 13 },
          color: "#64748b",
          callback: function (value) {
            const n = Number(value);
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
            return String(value);
          },
        },
      },
      y: {
        grid: { display: false },
        ticks: { font: { size: 13 }, color: "#64748b" },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        padding: 12,
        cornerRadius: 8,
        titleFont: { size: 13, weight: "bold" as const },
        bodyFont: { size: 13 },
        callbacks: {
          label: valueTooltipCallback as (ctx: TooltipItem<"bar">) => string,
        },
      },
    },
  };
}

/** Build doughnut chart options with legend. */
export function doughnutOptions(): ChartOptions<"doughnut"> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "60%",
    plugins: {
      legend: {
        display: true,
        position: "right" as const,
        labels: { font: { size: 13 }, color: "#64748b", boxWidth: 12, padding: 8 },
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.9)",
        padding: 12,
        cornerRadius: 8,
        titleFont: { size: 13, weight: "bold" as const },
        bodyFont: { size: 13 },
        callbacks: {
          label: function (this: unknown, context: TooltipItem<"doughnut">) {
            const label = context.label ?? "";
            const value = context.parsed;
            const num = typeof value === "number" ? value : Number(value);
            const formatted = Number.isFinite(num) ? formatDhis2Value(num) : "—";
            const total = (context.dataset.data as number[]).reduce((s, v) => s + (Number(v) || 0), 0);
            const pct = total > 0 ? ((num / total) * 100).toFixed(1) : "0";
            return `${label}: ${formatted} (${pct}%)`;
          },
        },
      },
    },
  };
}
