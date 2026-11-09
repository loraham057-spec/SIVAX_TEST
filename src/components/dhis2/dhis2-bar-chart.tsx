"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Bar } from "react-chartjs-2";
import { horizontalBarOptions, CHART_PALETTE } from "@/lib/chart-setup";
import { resolveDhis2Name } from "@/lib/dhis2-format";
import type { Dhis2AnalyticsResult } from "@/types";

interface Dhis2BarChartProps {
  result: Dhis2AnalyticsResult;
  topN?: number;
  /** Sum the units beyond topN into an "Autres" bar; false for rates. */
  aggregateOthers?: boolean;
}

export function Dhis2BarChart({ result, topN = 15, aggregateOthers = true }: Dhis2BarChartProps) {
  const t = useTranslations("dhis2");
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
      if (aggregateOthers && othersTotal > 0) {
        top.push({ name: `Autres (${sorted.length - topN})`, value: othersTotal });
      }
      final = top;
    }

    return {
      labels: final.map((d) => d.name),
      values: final.map((d) => d.value),
      total: final.reduce((s, d) => s + d.value, 0),
    };
  }, [result, topN, aggregateOthers]);

  const data = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: t("value"),
          data: values,
          backgroundColor: labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length] + "B0"),
          hoverBackgroundColor: labels.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
          borderRadius: 4,
        },
      ],
    }),
    [labels, values],
  );

  if (values.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        Données insuffisantes pour le graphique en barres
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Classement par unité géographique</h3>
        <span className="text-xs text-muted-foreground">{labels.length} entrées</span>
      </div>
      <div className="h-[400px] w-full overflow-y-auto">
        <Bar
          data={data}
          options={{
            ...horizontalBarOptions(),
            maintainAspectRatio: false,
          }}
        />
      </div>
    </div>
  );
}
