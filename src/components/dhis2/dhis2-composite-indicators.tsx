"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { resolveDhis2Name, formatDhis2Value } from "@/lib/dhis2-format";
import { buildCompositeIndicators } from "@/lib/composite-indicators";
import type { Dhis2AnalyticsResult } from "@/types";

interface Dhis2CompositeIndicatorsProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
}

function findLatestValue(
  result: Dhis2AnalyticsResult,
  dxId: string,
): number {
  const rows = result.rows
    .filter((r) => r[0] === dxId)
    .sort((a, b) => a[1].localeCompare(b[1]));
  const latest = rows[rows.length - 1];
  return latest ? Number(latest[3]) : 0;
}

function findDxByName(
  result: Dhis2AnalyticsResult,
  searchTerms: string[],
): string | null {
  const dxItems = result.metaData.dimensions.dx ?? [];
  for (const dxId of dxItems) {
    const name = (result.metaData.items[dxId]?.name ?? "").toLowerCase();
    if (searchTerms.some((term) => name.includes(term.toLowerCase()))) {
      return dxId;
    }
  }
  return null;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  good: { bg: "bg-emerald-500/10", text: "text-emerald-600", border: "border-emerald-500/30" },
  warning: { bg: "bg-amber-500/10", text: "text-amber-600", border: "border-amber-500/30" },
  critical: { bg: "bg-rose-500/10", text: "text-rose-600", border: "border-rose-500/30" },
};

export function Dhis2CompositeIndicators({ result, loading }: Dhis2CompositeIndicatorsProps) {
  const t = useTranslations("dhis2");
  const indicators = useMemo(() => {
    if (!result?.rows || !result?.metaData) return [];

    const deathDx = findDxByName(result, ["décès", "death", "deces", "mortalité"]);
    const confirmedDx = findDxByName(result, ["confirmé", "confirmed", "cas confirmé"]);
    const suspectedDx = findDxByName(result, ["suspect", "suspected", "cas suspect"]);
    const vaccinatedDx = findDxByName(result, ["vacciné", "vaccinated", "vaccination", "couverture"]);

    const deaths = deathDx ? findLatestValue(result, deathDx) : undefined;
    const confirmedCases = confirmedDx ? findLatestValue(result, confirmedDx) : undefined;
    const suspected = suspectedDx ? findLatestValue(result, suspectedDx) : undefined;
    const confirmed = confirmedDx ? findLatestValue(result, confirmedDx) : undefined;

    return buildCompositeIndicators({
      deaths,
      confirmedCases,
      suspected,
      confirmed,
    });
  }, [result]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border bg-card shadow-sm" />
        ))}
      </div>
    );
  }

  if (indicators.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {indicators.map((ind) => {
        const colors = ind.thresholdStatus
          ? STATUS_COLORS[ind.thresholdStatus]
          : { bg: "bg-primary/10", text: "text-primary", border: "border-primary/30" };
        return (
          <div
            key={ind.id}
            className={cn(
              "rounded-xl border p-4 shadow-sm",
              colors.bg,
              colors.border,
            )}
          >
            <p className={cn("text-xs font-medium", colors.text)}>
              {ind.label}
            </p>
            <p className="mt-2 text-2xl font-bold tracking-tight">
              {ind.formattedValue}
            </p>
            {ind.thresholdStatus && (
              <p className={cn("mt-1 text-[10px] font-medium", colors.text)}>
                {ind.thresholdStatus === "good" && t("inNorm")}
                {ind.thresholdStatus === "warning" && t("toWatch")}
                {ind.thresholdStatus === "critical" && t("critical")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
