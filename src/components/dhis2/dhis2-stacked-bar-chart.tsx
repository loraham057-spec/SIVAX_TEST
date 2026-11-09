"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Bar } from "react-chartjs-2";
import { type TooltipItem } from "chart.js";
import { barChartOptions, CHART_PALETTE } from "@/lib/chart-setup";
import { formatDhis2PeriodAxis, formatDhis2Value, resolveDhis2Name } from "@/lib/dhis2-format";
import type { Dhis2AnalyticsResult } from "@/types";

interface Dhis2StackedBarChartProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
  /** False for series whose sum is meaningless (e.g. doses of different antigens). */
  stacked?: boolean;
  title?: string;
}

export function Dhis2StackedBarChart({ result, loading, stacked = true, title }: Dhis2StackedBarChartProps) {
  const t = useTranslations("dhis2");
  const { chartData, labels } = useMemo(() => {
    if (!result?.rows || !result?.metaData) {
      return { chartData: null, labels: [] as string[] };
    }

    const dxItems = result.metaData.dimensions.dx ?? [];
    const peItems = result.metaData.dimensions.pe ?? [];
    const ouItems = result.metaData.dimensions.ou ?? [];

    const hasMultipleDx = dxItems.length > 1;
    const hasMultipleOu = ouItems.length > 1;

    let categoryLabels: string[];
    let categoryIndex: number;

    if (hasMultipleOu) {
      categoryLabels = ouItems.map((id) => resolveDhis2Name(result.metaData?.items, id));
      categoryIndex = 2;
    } else {
      categoryLabels = peItems.map((p) => formatDhis2PeriodAxis(p));
      categoryIndex = 1;
    }

    const datasets = dxItems.map((dxId, idx) => {
      const name = resolveDhis2Name(result.metaData?.items, dxId);
      const data = categoryLabels.map((_, catIdx) => {
        const catId = hasMultipleOu ? ouItems[catIdx] : peItems[catIdx];
        const row = result.rows.find(
          (r) => r[0] === dxId && r[categoryIndex] === catId,
        );
        return row ? Number(row[3]) : 0;
      });

      return {
        label: name,
        data,
        backgroundColor: CHART_PALETTE[idx % CHART_PALETTE.length],
        borderColor: CHART_PALETTE[idx % CHART_PALETTE.length],
        borderWidth: 1,
      };
    });

    return {
      chartData: { labels: categoryLabels, datasets },
      labels: categoryLabels,
    };
  }, [result]);

  if (loading) {
    return (
      <div className="h-72 animate-pulse rounded-xl border bg-card shadow-sm" />
    );
  }

  if (!chartData || labels.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        Données insuffisantes pour le graphique empilé
      </div>
    );
  }

  const options = {
    ...barChartOptions(t("value")),
    scales: {
      ...barChartOptions(t("value")).scales,
      x: {
        ...barChartOptions(t("value")).scales?.x,
        stacked,
      },
      y: {
        ...barChartOptions(t("value")).scales?.y,
        stacked,
      },
    },
    plugins: {
      ...barChartOptions(t("value")).plugins,
      legend: {
        display: true,
        position: "bottom" as const,
        labels: { font: { size: 12 }, color: "#64748b", boxWidth: 10, padding: 6 },
      },
      tooltip: {
        ...barChartOptions(t("value")).plugins?.tooltip,
        callbacks: {
          label: function (context: TooltipItem<"bar">) {
            const label = context.dataset.label ?? "";
            const value = formatDhis2Value(context.parsed.y ?? 0);
            return `${label}: ${value}`;
          },
        },
      },
    },
  };

  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">{title ?? "Répartition par indicateur"}</h3>
        <span className="text-xs text-muted-foreground">{stacked ? "Barres empilées" : "Barres groupées"}</span>
      </div>
      <div className="flex-1 min-h-[256px] w-full">
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}
