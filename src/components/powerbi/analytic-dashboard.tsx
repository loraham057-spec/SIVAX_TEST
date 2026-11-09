"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  TrendingUp,
  TrendingDown,
  Syringe,
  Users,
  PackageCheck,
  Activity,
  Database,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { dhis2Service } from "@/services";
import { lineChartOptions, primaryColor } from "@/lib/chart-setup";
import { formatDhis2PeriodAxis, formatDhis2PeriodShort } from "@/lib/dhis2-format";
import type { Dhis2StatCard, Dhis2SeriesPoint } from "@/types";

/**
 * Analytic Dashboard
 *
 * Renders analytics natively from DHIS2 data (via the app backend).
 * Data is served from Supabase (ETL sync) with fallback to live DHIS2.
 */

const ICON_MAP: Record<string, LucideIcon> = {
  syringe: Syringe,
  users: Users,
  package: PackageCheck,
  activity: Activity,
};

/** Format a DHIS2 period id (YYYYMM) into a readable French month label. */
function formatPeriod(period: string | null): string {
  return formatDhis2PeriodShort(period);
}

function coverageColor(value: number): string {
  if (value >= 85) return "bg-emerald-500";
  if (value >= 70) return "bg-amber-500";
  return "bg-rose-500";
}

/**
 * Chart.js is ~70 kB and is only needed once the trend data has arrived, which
 * is strictly after the first paint. Loading it on demand keeps it out of the
 * initial bundle without changing what the user sees.
 */
const Line = dynamic(() => import("react-chartjs-2").then((m) => m.Line), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full" />,
});

export function AnalyticDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [cards, setCards] = useState<Dhis2StatCard[]>([]);
  const [series, setSeries] = useState<Dhis2SeriesPoint[]>([]);
  const [source, setSource] = useState<string>("DHIS2");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    dhis2Service
      .getAnalytics()
      .then((res) => {
        if (!active) return;
        setCards(res.cards);
        setSeries(res.series ?? []);
        setSource(res.source);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Erreur de chargement DHIS2");
      })
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const chartData = useMemo(() => {
    const color = primaryColor();
    return {
      labels: series.map((p) => formatDhis2PeriodAxis(p.period)),
      datasets: [
        {
          label: "Paludisme — Cas",
          data: series.map((p) => p.value),
          borderColor: color,
          backgroundColor: (ctx: { chart: { ctx: CanvasRenderingContext2D; chartArea?: { top: number; bottom: number } } }) => {
            const { ctx: canvasCtx, chartArea } = ctx.chart;
            if (!chartArea) return color + "20";
            const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, color + "40");
            gradient.addColorStop(1, color + "00");
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
      ],
    };
  }, [series]);

  if (isLoading) {
    return (
      <div className="h-full overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Database className="h-3.5 w-3.5 text-primary" />
        <span>Données réelles synchronisées depuis {source}</span>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Impossible de charger les statistiques DHIS2 : {error}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((kpi) => {
          const Icon = ICON_MAP[kpi.iconKey] ?? Activity;
          const hasDelta = kpi.delta !== null;
          const positive = (kpi.delta ?? 0) >= 0;
          return (
            <div
              key={kpi.id}
              className="rounded-xl border bg-card p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                {hasDelta && (
                  <span
                    className={cn(
                      "flex items-center gap-0.5 text-xs font-medium",
                      positive ? "text-emerald-600" : "text-rose-600"
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
              <p className="mt-3 text-2xl font-bold tracking-tight">{kpi.value}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{kpi.label}</p>
              {kpi.period && (
                <p className="mt-1 text-[10px] text-muted-foreground/70">{formatPeriod(kpi.period)}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Évolution mensuelle</h3>
            <span className="text-xs text-muted-foreground">Paludisme — 6 derniers mois</span>
          </div>
          {series.length < 2 ? (
            <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">
              Données insuffisantes pour le graphique
            </div>
          ) : (
            <div className="mt-4 h-56 w-full">
              <Line data={chartData} options={lineChartOptions()} />
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Synthèse des indicateurs</h3>
            <span className="text-xs text-muted-foreground">Valeur la plus récente</span>
          </div>
          <div className="space-y-3">
            {cards.map((c) => (
              <div key={c.id}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium line-clamp-1">{c.label}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">{c.value}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", coverageColor(c.unit === "percent" ? c.rawValue : Math.min((c.rawValue / 100000) * 100, 100)))}
                    style={{ width: `${c.unit === "percent" ? c.rawValue : Math.min((c.rawValue / 100000) * 100, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
