"use client";

/**
 * Page 3 — Performance & Équité
 *
 *   1. Sélecteur d'indicateur + barre de synthèse (unités sous seuil, écart, ratio)
 *   2. Top 10 (histogramme) + analyse d'équité (Min/Q1/Méd/Q3/Max + ratio)
 *   3. Où agir en priorité : zones sous le seuil par province / enfants à
 *      rattraper (niveau national uniquement : le fond de carte ne contient
 *      que les provinces)
 *   4. Classement complet des unités enfants
 *
 * Toutes les sections lisent la même valeur cumulée sur la période filtrée,
 * pour les enfants directs de l'unité sélectionnée :
 *   - couverture : moyenne des taux mensuels annualisés pondérée par les jours
 *     (= Σ numérateurs / Σ dénominateurs à cible annuelle constante) ;
 *   - abandon : (Σ doses Penta1 − Σ doses Penta3) / Σ doses Penta1.
 * Une couverture > 100 % ou un abandon négatif est une donnée suspecte
 * (dénominateur, rapportage) : signalée, exclue du classement et de l'équité.
 * Seuils : src/lib/pev/thresholds.json (OMS IA2030).
 */

import { useCallback, useMemo, useState } from "react";
import { Activity, Scale } from "lucide-react";
import { Bar } from "react-chartjs-2";
import { useTranslations } from "next-intl";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import {
  FilterDropdown,
  PageHeader,
  ScopeNotice,
  SectionCard,
  SourceBar,
  StatusBadge,
  useChildLevelNames,
  useDescribeSource,
  usePageFilter,
  statusFromThreshold,
  useMultiIndicatorAnalytics,
} from "@/components/dashboard/pages/_shared";
import type { MapStatus } from "@/components/dhis2/dhis2-choropleth-map";
import {
  PENTA1_DOSES,
  PENTA3_DOSES,
  PerformanceActionCard,
  cumulativeIndicator,
  type PerfIndicator,
} from "@/components/dashboard/pages/performance-action-card";
import type { CumulativeValue } from "@/lib/dhis2-analytics";
import { formatDhis2PeriodRange } from "@/lib/dhis2-format";
import { PEV_THRESHOLDS, isSuspectValue } from "@/lib/pev/thresholds";
import { cn } from "@/lib/utils";

// VAP4 (malaria vaccine, phased introduction) is not ranked here: a province
// that has not introduced it yet would show up as "critical".
const PERF_INDICATORS: PerfIndicator[] = [
  { id: "v9b9aYsA5PM", name: "Penta3", kind: "coverage" },
  { id: "k26tJ22Ncpd", name: "Penta1", kind: "coverage" },
  { id: "cWJXYKCXrLx", name: "BCG", kind: "coverage" },
  { id: "OKaDG2t6LtN", name: "VAR1", kind: "coverage" },
  { id: "MULXtL8iom8", name: "Abandon Penta1-Penta3", kind: "dropout" },
];
const PERF_INDICATOR_IDS = [...PERF_INDICATORS.map((i) => i.id), PENTA1_DOSES, PENTA3_DOSES];

type Status = Exclude<MapStatus, null>;
const STATUS_TEXT: Record<Status, string> = {
  good: "text-emerald-600",
  warning: "text-amber-600",
  critical: "text-rose-600",
  suspect: "text-violet-600",
};
const STATUS_BG: Record<Status, string> = {
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-rose-500",
  suspect: "bg-violet-500",
};
const STATUS_HEX: Record<Status, string> = { good: "#16A34A", warning: "#F59E0B", critical: "#DC2626", suspect: "#7C3AED" };

function quartile(values: number[]) {
  if (values.length === 0) return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  const lower = s.slice(0, mid);
  const upper = s.slice(mid + (s.length % 2 ? 1 : 0));
  return {
    min: s[0],
    q1: lower.length ? lower[Math.floor(lower.length / 2)] : s[0],
    median,
    q3: upper.length ? upper[Math.floor(upper.length / 2)] : s[s.length - 1],
    max: s[s.length - 1],
  };
}

export function PerformancePage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  const tDhis2 = useTranslations("dhis2");
  // A FOSA has no children to rank: the page stops at the aire de santé.
  const { filter, setFilter, reset, clamped, maxLevel } = usePageFilter(4);
  const describeSource = useDescribeSource();
  const units = useChildLevelNames(filter.orgUnitLevel);
  const [selected, setSelected] = useState(PERF_INDICATORS[0].id);

  const analytics = useMultiIndicatorAnalytics({
    indicatorIds: PERF_INDICATOR_IDS,
    filter,
  });
  const { children, result, loading, error, source, latestPeriod, syncedAt } = analytics;

  const current = PERF_INDICATORS.find((i) => i.id === selected) ?? PERF_INDICATORS[0];
  const inverted = current.kind === "dropout";
  const threshold = PEV_THRESHOLDS[current.kind];
  const statusOf = useCallback(
    (v: number): Status =>
      isSuspectValue(v, current.kind) ? "suspect" : statusFromThreshold(v, PEV_THRESHOLDS[current.kind], current.kind !== "dropout"),
    [current.kind],
  );

  // Cumulative value of each child over the filtered period.
  const values = useMemo<CumulativeValue[]>(
    () => cumulativeIndicator(children ?? result, current, [filter.orgUnitId]),
    [children, result, current, filter.orgUnitId],
  );

  // Valid values best → worst; suspect values are listed apart.
  const ranking = useMemo(
    () => values.filter((v) => statusOf(v.value) !== "suspect").sort((a, b) => (inverted ? a.value - b.value : b.value - a.value)),
    [values, statusOf, inverted],
  );
  const suspects = useMemo(() => values.filter((v) => statusOf(v.value) === "suspect"), [values, statusOf]);

  const belowThreshold = ranking.filter((p) => statusOf(p.value) === "critical");

  const equity = useMemo(() => {
    const stats = quartile(ranking.map((r) => r.value));
    const gap = stats.max - stats.min;
    const ratio = stats.min > 0 ? stats.max / stats.min : Infinity;
    return { stats, gap, ratio };
  }, [ranking]);

  const top10Data = useMemo(() => {
    const top = ranking.slice(0, 10);
    return {
      labels: top.map((p) => p.name),
      datasets: [{
        label: current.name,
        data: top.map((p) => p.value),
        backgroundColor: top.map((p) => STATUS_HEX[statusOf(p.value)]),
        borderWidth: 0,
      }],
    };
  }, [ranking, current, statusOf]);

  const first = values.reduce<string>((acc, v) => (!acc || v.first < acc ? v.first : acc), "");
  const last = values.reduce<string>((acc, v) => (v.last > acc ? v.last : acc), "");
  const periodLabel = first ? tPages("performance.cumulative", { period: formatDhis2PeriodRange(first, last) }) : "";
  const unitPeriod = (v: CumulativeValue) =>
    v.first !== first || v.last !== last ? formatDhis2PeriodRange(v.first, v.last) : null;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={Scale}
        accent="bg-blue-500/10 text-blue-600 dark:text-blue-400"
        title={t("pages.performance.title")}
        description={t("pages.performance.description")}
      />

      <SourceBar source={describeSource(source, latestPeriod, syncedAt)} onReset={reset} resetLabel={tPages("reset")} />
      <Dhis2FilterBar filter={filter} onChange={setFilter} maxLevel={maxLevel}>
        <FilterDropdown
          icon={Activity}
          label={tDhis2("indicator")}
          options={PERF_INDICATORS}
          value={selected}
          onChange={setSelected}
        />
      </Dhis2FilterBar>
      <ScopeNotice filter={filter} state={analytics} clamped={clamped} maxLevel={maxLevel} />

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-card p-3 text-xs">
        <span className="font-medium">{current.name}</span>
        <span className="text-muted-foreground">
          {ranking.length} {units.many} — {tPages("performance.threshold")}: {threshold.warning}{inverted ? "% (max)" : "% (min)"}
          {periodLabel && ` — ${periodLabel}`}
        </span>
        <span className="font-medium text-rose-600">
          {belowThreshold.length} {tPages("performance.belowThreshold")}
        </span>
        {suspects.length > 0 && (
          <span className="font-medium text-violet-600">{tPages("performance.suspectCount", { count: suspects.length })}</span>
        )}
        <span className="text-muted-foreground">
          {tPages("performance.gap")}: {equity.gap.toFixed(1)} — {tPages("performance.ratio")}: {equity.ratio === Infinity ? "∞" : equity.ratio.toFixed(1)}x
        </span>
      </div>

      {/* Top 10 chart + Equity stats */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title={tPages("performance.top10", { units: units.many, indicator: current.name })}>
          <div className="h-72 w-full">
            {loading ? (
              <div className="h-full animate-pulse rounded-lg bg-muted/40" />
            ) : (
              <Bar
                data={top10Data}
                options={{
                  indexAxis: "y" as const,
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: { x: { beginAtZero: true } },
                }}
              />
            )}
          </div>
        </SectionCard>

        <SectionCard title={tPages("performance.equityAnalysis", { indicator: current.name })}>
          <div className="grid grid-cols-5 gap-2 text-center">
            {([
              ["Min", equity.stats.min, "text-rose-600"],
              ["Q1", equity.stats.q1, ""],
              ["Méd", equity.stats.median, "text-primary"],
              ["Q3", equity.stats.q3, ""],
              ["Max", equity.stats.max, "text-emerald-600"],
            ] as const).map(([label, val, color]) => (
              <div key={label}>
                <p className="text-[10px] text-muted-foreground">{label}</p>
                <p className={cn("text-sm font-bold", color)}>{val.toFixed(1)}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs">
            <span className="text-muted-foreground">
              {tPages("performance.gap")}: {equity.gap.toFixed(1)} — {tPages("performance.ratio")}: {equity.ratio === Infinity ? "∞" : equity.ratio.toFixed(1)}x
            </span>
            <StatusBadge
              status={equity.ratio > 3 ? "critical" : equity.ratio > 2 ? "warning" : "good"}
              label={equity.ratio > 3 ? tPages("performance.inequalityCritical") : equity.ratio > 2 ? tPages("performance.inequalityModerate") : tPages("performance.equityAcceptable")}
            />
          </div>
        </SectionCard>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {tPages(inverted ? "performance.methodDropout" : "performance.methodCoverage")}
      </p>

      {/* Where to act — the base map only has provinces */}
      {filter.orgUnitLevel === 1 && (
        <PerformanceActionCard
          filter={filter}
          indicator={current}
          provinces={children ?? result}
          loading={loading}
          statusOf={statusOf}
        />
      )}

      {/* Full ranking table */}
      <SectionCard title={tPages("performance.fullRanking", { units: units.many })} subtitle={periodLabel}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">#</th>
                <th className="pb-2 pr-4 font-medium">{units.one}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("performance.value")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("performance.status")}</th>
                <th className="pb-2 font-medium">{tPages("performance.bar")}</th>
              </tr>
            </thead>
            <tbody>
              {[...ranking, ...suspects].map((p, i) => {
                const status = statusOf(p.value);
                const barWidth = inverted
                  ? Math.min((Math.max(p.value, 0) / (threshold.warning * 2)) * 100, 100)
                  : Math.min(p.value, 100);
                const label = {
                  good: tPages("performance.satisfactory"),
                  warning: tPages("performance.attention"),
                  critical: tPages("performance.criticalStatus"),
                  suspect: tPages("performance.suspect"),
                }[status];
                const span = unitPeriod(p);
                return (
                  <tr key={p.ouId} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground">{status === "suspect" ? "—" : i + 1}</td>
                    <td className="py-2 pr-4 font-medium">
                      {p.name}
                      {span && <span className="ml-1 text-[10px] text-muted-foreground">({span})</span>}
                    </td>
                    <td className="py-2 pr-4">{p.value.toFixed(1)}%</td>
                    <td className={cn("py-2 pr-4 font-medium", STATUS_TEXT[status])}>{label}</td>
                    <td className="py-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                        <div className={cn("h-full rounded-full", STATUS_BG[status])} style={{ width: `${barWidth}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && values.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">—</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
