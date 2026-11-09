"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  TrendingUp,
  TrendingDown,
  Syringe,
  Users,
  PackageCheck,
  Activity,
  MapPin,
  Target,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDhis2PeriodShort, formatDhis2Value, resolveDhis2Name } from "@/lib/dhis2-format";
import {
  getThreshold,
  getThresholdStatus,
  thresholdBorder,
  thresholdTextColor,
  type ThresholdStatus,
} from "@/lib/kpi-thresholds";
import type { Dhis2AnalyticsResult } from "@/types";

/**
 * Returns YYYYMM period ids for the current and previous calendar months.
 * DHIS2 monthly data is typically incomplete during the current month and
 * the first weeks of the following month, so we exclude both from the
 * delta calculation to avoid misleading trends.
 */
function incompletePeriods(): string[] {
  const now = new Date();
  const cur = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = `${prevDate.getFullYear()}${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  return [cur, prev];
}

const ICON_MAP: Record<string, LucideIcon> = {
  syringe: Syringe,
  users: Users,
  package: PackageCheck,
  activity: Activity,
};

interface Dhis2KpiGridProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
}

/**
 * Build a compact SVG sparkline polyline from a list of numeric values.
 * Returns an SVG path string (points attribute) sized 100×28.
 */
function buildSparkline(values: number[]): string {
  if (values.length < 2) return "";
  const w = 100;
  const h = 28;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Dhis2KpiGrid({ result, loading }: Dhis2KpiGridProps) {
  const t = useTranslations("dhis2");

  const kpis = useMemo(() => {
    if (!result?.rows || !result?.metaData) return [];

    const dxItems = result.metaData.dimensions.dx ?? [];
    const ouItems = result.metaData.dimensions.ou ?? [];
    const orgUnitCount = ouItems.length;

    return dxItems.slice(0, 4).map((dxId) => {
      const name = resolveDhis2Name(result.metaData?.items, dxId);
      const exclude = incompletePeriods();
      const rows = result.rows
        .filter((r) => r[0] === dxId && !exclude.includes(r[1]))
        .sort((a, b) => a[1].localeCompare(b[1]));

      const latest = rows[rows.length - 1];
      const previous = rows[rows.length - 2];

      const currentValue = latest ? Number(latest[3]) : 0;
      const previousValue = previous ? Number(previous[3]) : undefined;

      // Delta vs previous month
      let delta: number | null = null;
      if (previousValue !== undefined && previousValue !== 0) {
        delta = ((currentValue - previousValue) / previousValue) * 100;
      }

      // Period statistics
      const allValues = rows.map((r) => Number(r[3])).filter((v) => !isNaN(v));
      const avg = allValues.length > 0 ? allValues.reduce((s, v) => s + v, 0) / allValues.length : 0;
      const minVal = allValues.length > 0 ? Math.min(...allValues) : 0;
      const maxVal = allValues.length > 0 ? Math.max(...allValues) : 0;
      const periodCount = allValues.length;

      // Sparkline data (last 12 points max)
      const sparkValues = allValues.slice(-12);

      // Gap to OMS threshold
      const threshold = getThreshold(name);
      let gapToTarget: number | null = null;
      if (threshold) {
        gapToTarget = currentValue - threshold.good;
      }

      return {
        id: dxId,
        label: name,
        value: formatDhis2Value(currentValue),
        rawValue: currentValue,
        previousValue: previousValue !== undefined ? formatDhis2Value(previousValue) : null,
        delta: delta === null ? null : Number(delta.toFixed(1)),
        period: latest?.[1] ?? null,
        avg: formatDhis2Value(avg),
        rawAvg: avg,
        minVal: formatDhis2Value(minVal),
        maxVal: formatDhis2Value(maxVal),
        periodCount,
        orgUnitCount,
        sparkline: buildSparkline(sparkValues),
        thresholdTarget: threshold?.good ?? null,
        gapToTarget,
      };
    });
  }, [result]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-xl border bg-card shadow-sm"
          />
        ))}
      </div>
    );
  }

  if (kpis.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        {t("noDataFilters")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {kpis.map((kpi) => {
        const Icon = ICON_MAP[kpi.id] ?? Activity;
        const hasDelta = kpi.delta !== null;
        const positive = (kpi.delta ?? 0) >= 0;
        const thresholdStatus: ThresholdStatus | null = getThresholdStatus(kpi.rawValue, kpi.label);
        const borderClass = thresholdStatus ? thresholdBorder(thresholdStatus) : "";
        const gapNegative = kpi.gapToTarget !== null && kpi.gapToTarget < 0;

        return (
          <div
            key={kpi.id}
            className={cn(
              "flex flex-col rounded-2xl border border-border/80 bg-card p-5 shadow-[0_6px_18px_rgba(23,43,77,0.045)] transition-all hover:-translate-y-0.5 hover:shadow-md",
              borderClass,
            )}
          >
            {/* Header: icon + trend badge */}
            <div className="flex items-center justify-between">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              {hasDelta && (
                <span
                  className={cn(
                    "flex items-center gap-0.5 text-xs font-medium",
                    positive ? "text-emerald-600" : "text-rose-600",
                  )}
                >
                  {positive ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  {Math.abs(kpi.delta as number)}%
                </span>
              )}
            </div>

            {/* Value + label */}
            <p className="mt-3 text-3xl font-extrabold tracking-tight">{kpi.value}</p>
            <p className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-muted-foreground">
              {kpi.label}
            </p>

            {/* Sparkline */}
            {kpi.sparkline && (
              <div className="mt-2">
                <svg width="100%" height="28" viewBox="0 0 100 28" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id={`spark-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <polygon
                    points={`2,28 ${kpi.sparkline} 98,28`}
                    fill={`url(#spark-${kpi.id})`}
                    className={cn(
                      thresholdStatus === "good" ? "text-emerald-500" :
                      thresholdStatus === "warning" ? "text-amber-500" :
                      thresholdStatus === "critical" ? "text-rose-500" :
                      "text-primary",
                    )}
                  />
                  <polyline
                    points={kpi.sparkline}
                    fill="none"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn(
                      thresholdStatus === "good" ? "text-emerald-500" :
                      thresholdStatus === "warning" ? "text-amber-500" :
                      thresholdStatus === "critical" ? "text-rose-500" :
                      "text-primary",
                    )}
                    stroke="currentColor"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            )}

            {/* Analytics footer */}
            <div className="mt-auto space-y-1.5 pt-3 text-xs text-muted-foreground">
              {/* Period + average */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground/70">
                  {kpi.period ? formatDhis2PeriodShort(kpi.period) : "—"}
                </span>
                <span>
                  {t("avgLabel")}: <span className="font-medium text-muted-foreground">{kpi.avg}</span>
                </span>
              </div>

              {/* Min / Max / Periods */}
              <div className="flex items-center justify-between">
                <span>
                  {t("minMaxLabel")}: <span className="font-medium text-muted-foreground">{kpi.minVal} – {kpi.maxVal}</span>
                </span>
                <span>{kpi.periodCount} {t("periodsLabel")}</span>
              </div>

              {/* Org units count */}
              {kpi.orgUnitCount > 1 && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  <span>{kpi.orgUnitCount} {t("orgUnitsLabel")}</span>
                </div>
              )}

              {/* Threshold / gap to target */}
              {thresholdStatus && kpi.thresholdTarget !== null && (
                <div
                  className={cn(
                    "flex items-center gap-1 font-medium",
                    thresholdTextColor(thresholdStatus),
                  )}
                >
                  <Target className="h-3 w-3" />
                  {thresholdStatus === "good" && t("inNorm")}
                  {thresholdStatus === "warning" && t("toWatch")}
                  {thresholdStatus === "critical" && t("critical")}
                  {gapNegative && kpi.gapToTarget !== null && (
                    <span className="ml-0.5">
                      ({Math.abs(kpi.gapToTarget).toFixed(1)} {t("ptsUnderTarget")} {kpi.thresholdTarget}%)
                    </span>
                  )}
                  {!gapNegative && kpi.gapToTarget !== null && kpi.gapToTarget > 0 && (
                    <span className="ml-0.5">
                      (+{kpi.gapToTarget.toFixed(1)} {t("ptsAboveTarget")} {kpi.thresholdTarget}%)
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
