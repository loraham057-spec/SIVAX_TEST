"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Bar } from "react-chartjs-2";
import { barChartOptions, primaryColor, percentTooltipCallback, periodTooltipTitleCallback } from "@/lib/chart-setup";
import type { TooltipItem } from "chart.js";
import { formatDhis2PeriodAxis, resolveDhis2Name } from "@/lib/dhis2-format";
import type { Dhis2AnalyticsResult } from "@/types";

interface Dhis2TrendBarChartProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
  /** Selected antigen indicator ID (unused for now, kept for API symmetry). */
  antigenId?: string;
}

export function Dhis2TrendBarChart({ result, loading }: Dhis2TrendBarChartProps) {
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
    return {
      labels,
      datasets: [
        {
          label: indicatorLabel,
          data: values,
          backgroundColor: color + "B0",
          hoverBackgroundColor: color,
          borderRadius: 4,
          borderSkipped: false,
        },
      ],
    };
  }, [labels, values, indicatorLabel]);

  const chartOptions = useMemo(() => {
    const opts = barChartOptions();
    if (opts.plugins?.tooltip?.callbacks) {
      opts.plugins.tooltip.callbacks.label = percentTooltipCallback as (ctx: TooltipItem<"bar">) => string;
      opts.plugins.tooltip.callbacks.title = periodTooltipTitleCallback as (ctx: TooltipItem<"bar">[]) => string;
    }
    return opts;
  }, []);

  if (loading) {
    return <div className="h-80 animate-pulse rounded-2xl border bg-card shadow-sm" />;
  }

  if (values.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center rounded-2xl border bg-card text-[15px] text-muted-foreground">
        Données insuffisantes pour le graphique
      </div>
    );
  }

  return (
    <div className="flex h-80 flex-col rounded-2xl border border-border/80 bg-card p-5 shadow-[0_6px_18px_rgba(23,43,77,0.045)]">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-base font-extrabold tracking-tight">{t("valuesByPeriod")}</h3>
        <span className="text-sm font-medium text-muted-foreground truncate ml-2 max-w-[200px]" title={indicatorLabel}>
          {indicatorLabel}
        </span>
      </div>
      <div className="mt-4 flex-1 min-h-[200px]">
        <Bar data={data} options={chartOptions} />
      </div>
    </div>
  );
}
