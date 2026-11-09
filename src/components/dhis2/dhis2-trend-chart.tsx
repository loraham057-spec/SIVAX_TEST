"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Line } from "react-chartjs-2";
import type { ChartDataset } from "chart.js";
import { lineChartOptions, primaryColor, percentTooltipCallback, periodTooltipTitleCallback } from "@/lib/chart-setup";
import type { TooltipItem } from "chart.js";
import { formatDhis2PeriodAxis, resolveDhis2Name } from "@/lib/dhis2-format";
import { getThreshold } from "@/lib/kpi-thresholds";
import type { Dhis2AnalyticsResult } from "@/types";

function hslToRgba(hsl: string, alpha: number): string {
  const match = hsl.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)/);
  if (!match) return hsl;
  const h = parseFloat(match[1]) / 360;
  const s = parseFloat(match[2]) / 100;
  const l = parseFloat(match[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface Dhis2TrendChartProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
  /** Selected antigen indicator ID (for threshold line). */
  antigenId?: string;
}

export function Dhis2TrendChart({ result, loading }: Dhis2TrendChartProps) {
  const t = useTranslations("dhis2");
  const { labels, values, indicatorLabel } = useMemo(() => {
    if (!result?.rows || !result?.metaData) {
      return { labels: [] as string[], values: [] as number[], indicatorLabel: t("indicator") };
    }

    const dxItems = result.metaData.dimensions.dx ?? [];
    if (dxItems.length === 0) return { labels: [], values: [], indicatorLabel: t("indicator") };

    const dxId = dxItems[0];
    const rows = result.rows
      .filter((r) => r[0] === dxId)
      .sort((a, b) => a[1].localeCompare(b[1]));

    return {
      labels: rows.map((r) => formatDhis2PeriodAxis(r[1])),
      values: rows.map((r) => Number(r[3])),
      indicatorLabel: resolveDhis2Name(result.metaData?.items, dxId),
    };
  }, [result]);

  const data = useMemo(() => {
    const color = primaryColor();
    const threshold = indicatorLabel ? getThreshold(indicatorLabel) : null;
    const datasets: ChartDataset<"line", number[]>[] = [
      {
        label: indicatorLabel,
        data: values,
        borderColor: color,
        backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
          const { ctx: canvasCtx, chartArea } = ctx.chart;
          if (!chartArea) return color;
          const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, hslToRgba(color, 0.25));
          gradient.addColorStop(1, hslToRgba(color, 0));
          return gradient;
        },
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: color,
        pointBorderColor: "#fff",
        pointBorderWidth: 1.5,
        borderWidth: 2,
      },
    ];

    // OMS threshold line (dashed)
    if (threshold) {
      datasets.push({
        label: `Seuil OMS (${threshold.good}%)`,
        data: values.map(() => threshold.good),
        borderColor: "rgba(239, 68, 68, 0.6)",
        borderDash: [6, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 0,
        fill: false,
        tension: 0,
      });
    }

    return { labels, datasets };
  }, [labels, values, indicatorLabel]);

  const chartOptions = useMemo(() => {
    const opts = lineChartOptions();
    // Show legend so the threshold line is labeled
    opts.plugins = opts.plugins ?? {};
    opts.plugins.legend = { display: true, position: "bottom", labels: { font: { size: 13 }, boxWidth: 20, boxHeight: 2 } };
    // Use percent tooltip for coverage values
    if (opts.plugins?.tooltip?.callbacks) {
      opts.plugins.tooltip.callbacks.label = percentTooltipCallback as (ctx: TooltipItem<"line">) => string;
      opts.plugins.tooltip.callbacks.title = periodTooltipTitleCallback as (ctx: TooltipItem<"line">[]) => string;
    }
    return opts;
  }, []);

  if (loading) {
    return <div className="h-80 animate-pulse rounded-2xl border bg-card shadow-sm" />;
  }

  if (values.length < 2) {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border bg-card text-[15px] text-muted-foreground">
        Données insuffisantes pour le graphique
      </div>
    );
  }

  return (
    <div className="flex h-80 flex-col rounded-2xl border border-border/80 bg-card p-5 shadow-[0_6px_18px_rgba(23,43,77,0.045)]">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-base font-extrabold tracking-tight">{t("trendEvolution")}</h3>
        <span className="text-sm font-medium text-muted-foreground truncate ml-2 max-w-[200px]" title={indicatorLabel}>
          {indicatorLabel}
        </span>
      </div>
      <div className="mt-4 flex-1 min-h-0 w-full">
        <Line data={data} options={chartOptions} />
      </div>
    </div>
  );
}
