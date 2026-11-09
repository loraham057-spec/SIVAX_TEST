"use client";

/**
 * Page 1 — Vue d'ensemble / Executive
 *
 * Tableau de bord synthétique pour le décideur :
 *   1. KPI cards (Penta3, BCG, Abandon, Sous-vaccinés)
 *   2. Score composite PEV (jauge)
 *   3. Carte de situation Penta3 (choroplèthe)
 *   4. Top 5 / Bottom 5 zones de santé
 *   5. Alertes actives
 */

import { useEffect, useMemo, useState } from "react";
import { Gauge, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDashboardFilters } from "@/store/dashboard-filters-store";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { Dhis2KpiGrid } from "@/components/dhis2/dhis2-kpi-grid";
import { Dhis2ChoroplethMap } from "@/components/dhis2/dhis2-choropleth-map";
import {
  PageHeader,
  SectionCard,
  SourceBar,
  StatusBadge,
  useMultiIndicatorAnalytics,
} from "@/components/dashboard/pages/_shared";
import { cn } from "@/lib/utils";
import type { AlertItem } from "@/types";

const EXECUTIVE_INDICATORS = [
  "v9b9aYsA5PM", // Couverture Penta3
  "cWJXYKCXrLx", // Couverture BCG
  "MULXtL8iom8", // Abandon Penta1-Penta3
  "RMHgIqfBG7N", // Enfants sous-vaccinés
];

interface ProvinceDatum {
  org_unit_id: string;
  org_unit_name: string;
  indicator_id: string;
  latest_value: number;
  unit: string;
}

export function ExecutivePage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  const { filter, setFilter, resetFilters } = useDashboardFilters();
  const { result, loading } = useMultiIndicatorAnalytics({
    indicatorIds: EXECUTIVE_INDICATORS,
    filter,
  });

  // Province-level data for ranking + risk score
  const [provinces, setProvinces] = useState<ProvinceDatum[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/provinces?domain=vaccination")
      .then((r) => r.json())
      .then((data) => active && setProvinces(data ?? []))
      .catch(() => active && setProvinces([]));
    fetch("/api/alerts")
      .then((r) => r.json())
      .then((data) => active && setAlerts(data ?? []))
      .catch(() => active && setAlerts([]));
    return () => {
      active = false;
    };
  }, []);

  // ─── Composite score (national, from latest KPI values) ───
  const compositeScore = useMemo(() => {
    if (!result?.rows || !result?.metaData) return null;
    const latest = (dxId: string) => {
      const rows = result.rows
        .filter((r) => r[0] === dxId)
        .sort((a, b) => a[1].localeCompare(b[1]));
      return rows[rows.length - 1] ? Number(rows[rows.length - 1][3]) : undefined;
    };
    const penta3 = latest("v9b9aYsA5PM");
    const bcg = latest("cWJXYKCXrLx");
    const dropout = latest("MULXtL8iom8");
    const sv = latest("RMHgIqfBG7N");
    let sum = 0;
    let weight = 0;
    if (penta3 !== undefined) { sum += (penta3 / 100) * 0.30; weight += 0.30; }
    if (bcg !== undefined) { sum += (bcg / 100) * 0.15; weight += 0.15; }
    if (dropout !== undefined) { sum += (1 - Math.min(dropout / 30, 1)) * 0.25; weight += 0.25; }
    if (sv !== undefined) { sum += 0.10; weight += 0.10; } // sous-vaccinés: count, normalize later
    return weight > 0 ? Math.round((sum / weight) * 100) : null;
  }, [result]);

  // ─── Top 5 / Bottom 5 zones by Penta3 ───
  const ranking = useMemo(() => {
    return provinces
      .filter((p) => p.indicator_id === "v9b9aYsA5PM")
      .sort((a, b) => b.latest_value - a.latest_value);
  }, [provinces]);
  const top5 = ranking.slice(0, 5);
  const bottom5 = ranking.slice(-5).reverse();

  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={Gauge}
        accent="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
        title={t("pages.executive.title")}
        description={t("pages.executive.description")}
      />

      <SourceBar onReset={resetFilters} resetLabel={tPages("reset")} />

      <Dhis2FilterBar filter={filter} onChange={setFilter} />

      {/* KPI cards */}
      <Dhis2KpiGrid result={result} loading={loading} />

      {/* Composite score + Alerts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CompositeScoreCard score={compositeScore} />
        <AlertsCard
          alerts={alerts}
          criticalCount={criticalAlerts.length}
          warningCount={warningAlerts.length}
        />
      </div>

      {/* Map + Top/Bottom ranking */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title={tPages("executive.situationMap")} subtitle={tPages("executive.penta3ByProvince")}>
          <div className="h-[360px]">
            <Dhis2ChoroplethMap result={result} loading={loading} />
          </div>
        </SectionCard>
        <div className="space-y-4">
          <RankingCard title={tPages("executive.top5")} rows={top5} />
          <RankingCard title={tPages("executive.bottom5")} rows={bottom5} />
        </div>
      </div>
    </div>
  );
}

function CompositeScoreCard({ score }: { score: number | null }) {
  const tPages = useTranslations("analyticsPageContent");
  const level = score === null ? null : score >= 70 ? "critical" : score >= 50 ? "high" : score >= 30 ? "moderate" : "low";
  const levelLabel = level === "critical" ? tPages("executive.riskCritical")
    : level === "high" ? tPages("executive.riskHigh")
    : level === "moderate" ? tPages("executive.riskModerate")
    : level === "low" ? tPages("executive.riskLow")
    : "—";
  const levelColor = level === "critical" ? "text-rose-600"
    : level === "high" ? "text-amber-600"
    : level === "moderate" ? "text-blue-600"
    : level === "low" ? "text-emerald-600"
    : "text-muted-foreground";
  const arcColor = level === "critical" ? "#DC2626"
    : level === "high" ? "#F59E0B"
    : level === "moderate" ? "#174A8B"
    : level === "low" ? "#16A34A"
    : "#94a3b8";

  // Semi-circular gauge (SVG)
  const radius = 70;
  const circumference = Math.PI * radius; // half circle
  const dash = score !== null ? (score / 100) * circumference : 0;

  return (
    <SectionCard title={tPages("executive.compositeScore")} subtitle={tPages("executive.compositeDesc")}>
      <div className="flex flex-col items-center justify-center py-4">
        <svg width="180" height="100" viewBox="0 0 180 100">
          <path
            d={`M 10 90 A ${radius} ${radius} 0 0 1 170 90`}
            fill="none"
            stroke="rgba(148,163,184,0.2)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          {score !== null && (
            <path
              d={`M 10 90 A ${radius} ${radius} 0 0 1 170 90`}
              fill="none"
              stroke={arcColor}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
            />
          )}
        </svg>
        <p className="-mt-6 text-3xl font-bold">{score !== null ? score : "—"}</p>
        <p className={cn("mt-1 text-xs font-medium", levelColor)}>{levelLabel}</p>
      </div>
    </SectionCard>
  );
}

function AlertsCard({
  alerts,
  criticalCount,
  warningCount,
}: {
  alerts: AlertItem[];
  criticalCount: number;
  warningCount: number;
}) {
  const tPages = useTranslations("analyticsPageContent");
  return (
    <SectionCard title={tPages("executive.activeAlerts")}>
      <div className="mb-3 flex gap-3 text-xs">
        <span className="flex items-center gap-1 text-rose-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {criticalCount} {tPages("executive.critical")}
        </span>
        <span className="flex items-center gap-1 text-amber-600">
          <AlertTriangle className="h-3.5 w-3.5" />
          {warningCount} {tPages("executive.warning")}
        </span>
      </div>
      {alerts.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {tPages("executive.noAlerts")}
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.slice(0, 5).map((alert) => (
            <div
              key={alert.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-xs",
                alert.severity === "critical"
                  ? "border-rose-500/40 bg-rose-500/10"
                  : "border-amber-500/40 bg-amber-500/10",
              )}
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{alert.title}</p>
                <p className="mt-0.5 text-muted-foreground">{alert.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function RankingCard({
  title,
  rows,
}: {
  title: string;
  rows: ProvinceDatum[];
}) {
  return (
    <SectionCard title={title}>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">—</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => {
            const status = r.latest_value >= 90 ? "good" : r.latest_value >= 60 ? "warning" : "critical";
            return (
              <div key={r.org_unit_id} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-muted-foreground">{i + 1}</span>
                <span className="flex-1 truncate font-medium">{r.org_unit_name}</span>
                <span className="font-bold">{r.latest_value.toFixed(1)}{r.unit === "percent" ? "%" : ""}</span>
                <StatusBadge status={status} label={status === "good" ? "✓" : status === "warning" ? "!" : "✕"} />
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
