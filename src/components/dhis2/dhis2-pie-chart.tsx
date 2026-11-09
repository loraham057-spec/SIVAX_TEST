"use client";

import { useMemo } from "react";
import { Doughnut } from "react-chartjs-2";
import { doughnutOptions, CHART_PALETTE } from "@/lib/chart-setup";
import { formatDhis2Value, resolveDhis2Name } from "@/lib/dhis2-format";
import type { Dhis2AnalyticsResult } from "@/types";

interface Dhis2PieChartProps {
  result: Dhis2AnalyticsResult;
  topN?: number;
}

export function Dhis2PieChart({ result, topN = 8 }: Dhis2PieChartProps) {
  const { labels, values, total } = useMemo(() => {
    if (!result?.rows || !result?.metaData) {
      return { labels: [] as string[], values: [] as number[], total: 0 };
    }

    const dxItems = result.metaData.dimensions.dx ?? [];
    const dxId = dxItems[0];
    if (!dxId) return { labels: [] as string[], values: [] as number[], total: 0 };

    const grouped = new Map<string, { name: string; value: number }>();

    for (const row of result.rows) {
      if (row[0] !== dxId) continue;
      const ouId = row[2];
      const value = Number(row[3]);
      if (!Number.isFinite(value)) continue;

      const name = resolveDhis2Name(result.metaData?.items, ouId);
      const existing = grouped.get(ouId);
      if (existing) {
        existing.value += value;
      } else {
        grouped.set(ouId, { name, value });
      }
    }

    const sorted = [...grouped.values()].sort((a, b) => b.value - a.value);

    let final = sorted;
    if (sorted.length > topN) {
      const top = sorted.slice(0, topN);
      const othersTotal = sorted.slice(topN).reduce((sum, item) => sum + item.value, 0);
      if (othersTotal > 0) {
        top.push({ name: `Autres (${sorted.length - topN})`, value: othersTotal });
      }
      final = top;
    }

    return {
      labels: final.map((d) => d.name),
      values: final.map((d) => d.value),
      total: final.reduce((s, d) => s + d.value, 0),
    };
  }, [result, topN]);

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          hoverBackgroundColor: labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length] + "D0"),
          borderWidth: 2,
          borderColor: "rgba(255, 255, 255, 0.8)",
        },
      ],
    }),
    [labels, values],
  );

  if (values.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        Données insuffisantes pour le camembert
      </div>
    );
  }

  if (total <= 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        Aucune valeur positive à représenter
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Répartition</h3>
        <span className="text-xs text-muted-foreground">Total : {formatDhis2Value(total)}</span>
      </div>
      <div className="flex items-center justify-center">
        <div className="h-64 w-full max-w-md">
          <Doughnut data={chartData} options={doughnutOptions()} />
        </div>
      </div>
    </div>
  );
}
