"use client";

/**
 * Shared building blocks for the analytics pages (cibles, performance,
 * supply, coldchain, wastage, dataquality, management, surveillance).
 *
 * These primitives keep each page component compact while reusing the
 * existing DHIS2 chart components (Dhis2KpiGrid, Dhis2TrendChart, …) which
 * all consume a single `Dhis2AnalyticsResult`.
 *
 * Data strategy (shared by every page):
 *   - One POST /api/dhis2/page-data per page: all indicators, the selected
 *     unit itself + its direct children, read from the ETL snapshot.
 *   - DHIS2 live fallback (single call, one attempt) only when the snapshot
 *     has nothing for this scope or a dataset filter is active.
 *   - Responses are cached in memory per (page, filter) so switching pages
 *     or coming back to a filter is instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, Info, RotateCcw, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { FilterSelect } from "@/components/ui/filter-select";
import { dhis2Service } from "@/services";
import { Line } from "react-chartjs-2";
import { useDashboardFilters } from "@/store/dashboard-filters-store";
import { excludeOrgUnit, latestByOrgUnit, latestPeriod, onlyOrgUnit } from "@/lib/dhis2-analytics";
import { clampFilter } from "@/lib/dhis2-filters";
import { formatDhis2PeriodAxis, formatDhis2PeriodShort, formatDhis2Value } from "@/lib/dhis2-format";
import { CHART_PALETTE } from "@/lib/chart-setup";
import { thresholdStatus, type ThresholdPair } from "@/lib/pev/thresholds";
import type { Dhis2AnalyticsResult, Dhis2FilterState } from "@/types";

// ─── Data hook: multi-indicator analytics ───────────────────────────────

const ROOT_OU = "ymGeqzoPhN3"; // RDC (national)
const LIVE_SOURCE_LABEL = "DHIS2 — SNIS RDC (live)";
const CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;

interface UseMultiIndicatorOptions {
  /** Indicator DHIS2 UIDs of the page. */
  indicatorIds: string[];
  /** Shared filter state (org unit, period). */
  filter: Dhis2FilterState;
  /** When true, skip fetching (e.g. custom period without dates). */
  enabled?: boolean;
  /** Descendant level to load instead of the direct children (e.g. 3 = every zone under the country). */
  childLevel?: number;
}

export interface MultiIndicatorState {
  /** Full result: selected unit + its children. */
  result: Dhis2AnalyticsResult | null;
  /** Rows of the selected unit only — KPI cards and trends. */
  focus: Dhis2AnalyticsResult | null;
  /** Rows of the children only — tables, maps, rankings. */
  children: Dhis2AnalyticsResult | null;
  loading: boolean;
  error: string | null;
  /** Human readable origin of the data (ETL snapshot vs live DHIS2). */
  source: string;
  /** Most recent period present in the data, or null. */
  latestPeriod: string | null;
  /** When the ETL snapshot was last written (ISO), null for live data. */
  syncedAt: string | null;
  /** Data loaded for the selected unit but none for its children. */
  childrenMissing: boolean;
  /** Parent of each descendant (ETL snapshot only). */
  parents: Record<string, string>;
}

interface Loaded {
  result: Dhis2AnalyticsResult;
  source: string;
  latestPeriod: string | null;
  syncedAt: string | null;
  parents?: Record<string, string>;
}

const EMPTY_PARENTS: Record<string, string> = {};
const clientCache = new Map<string, { expiresAt: number; value: Loaded }>();

function cacheKey(indicatorIds: string[], f: Dhis2FilterState, childLevel?: number): string {
  return JSON.stringify([
    indicatorIds, f.orgUnitId, f.orgUnitLevel, f.dataSetId, f.periodPreset, f.customPeriodStart, f.customPeriodEnd, childLevel,
  ]);
}

async function fetchFromEtl(indicatorIds: string[], f: Dhis2FilterState, childLevel?: number): Promise<Loaded | null> {
  const res = await fetch("/api/dhis2/page-data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      indicatorIds,
      orgUnitId: f.orgUnitId,
      orgUnitLevel: f.orgUnitLevel,
      periodPreset: f.periodPreset,
      customPeriodStart: f.customPeriodStart,
      customPeriodEnd: f.customPeriodEnd,
      childLevel,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    found?: boolean; source?: string; latestPeriod?: string; syncedAt?: string | null; analytics?: Dhis2AnalyticsResult;
    parents?: Record<string, string>;
  };
  if (!json.found || !json.analytics) return null;
  return {
    result: json.analytics,
    source: json.source ?? "Supabase (ETL sync)",
    latestPeriod: json.latestPeriod ?? null,
    syncedAt: json.syncedAt ?? null,
    parents: json.parents,
  };
}

async function fetchLive(indicatorIds: string[], f: Dhis2FilterState, descendantLevel?: number): Promise<Loaded> {
  const childLevel = descendantLevel ?? (f.orgUnitLevel < 5 ? f.orgUnitLevel + 1 : undefined);
  let dataElements = indicatorIds;
  if (f.dataSetId) {
    const dataSet = await dhis2Service.getDataSet(f.dataSetId);
    dataElements = dataSet.dataSetElements?.map((item) => item.dataElement.id) ?? indicatorIds;
  }
  const result = await dhis2Service.getFilteredAnalytics({
    ...f,
    targetOrgUnitLevel: childLevel,
    dataElements,
    antigeId: undefined,
  });
  return { result, source: LIVE_SOURCE_LABEL, latestPeriod: latestPeriod(result), syncedAt: null };
}

/**
 * Load every indicator of a page for the current filter, ETL snapshot first,
 * live DHIS2 as a last resort. The returned `focus`/`children` slices feed
 * the existing chart components without changing them.
 */
export function useMultiIndicatorAnalytics({
  indicatorIds,
  filter,
  enabled = true,
  childLevel,
}: UseMultiIndicatorOptions): MultiIndicatorState {
  const [state, setState] = useState<{ loaded: Loaded | null; loading: boolean; error: string | null }>({
    loaded: null,
    loading: true,
    error: null,
  });
  const hasLoadedOnce = useRef(false);
  const requestSeq = useRef(0);
  const idsKey = indicatorIds.join(";");

  const load = useCallback(
    async (nextFilter: Dhis2FilterState) => {
      const ids = idsKey.split(";").filter(Boolean);
      const seq = ++requestSeq.current;
      const stillCurrent = () => seq === requestSeq.current;

      if (nextFilter.periodPreset === "CUSTOM" && (!nextFilter.customPeriodStart || !nextFilter.customPeriodEnd)) {
        setState({ loaded: null, loading: false, error: null });
        return;
      }

      const key = cacheKey(ids, nextFilter, childLevel);
      const hit = clientCache.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        setState({ loaded: hit.value, loading: false, error: null });
        return;
      }

      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        // Datasets hold raw data elements the ETL does not sync: live only.
        const loaded =
          (nextFilter.dataSetId ? null : await fetchFromEtl(ids, nextFilter, childLevel).catch(() => null)) ??
          (await fetchLive(ids, nextFilter, childLevel));
        clientCache.set(key, { value: loaded, expiresAt: Date.now() + CLIENT_CACHE_TTL_MS });
        if (stillCurrent()) setState({ loaded, loading: false, error: null });
      } catch (err) {
        if (stillCurrent()) {
          setState({ loaded: null, loading: false, error: err instanceof Error ? err.message : "Erreur de chargement" });
        }
      }
    },
    [idsKey, childLevel],
  );

  useEffect(() => {
    if (!enabled) return;
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      void load(filter);
      return;
    }
    const timer = window.setTimeout(() => void load(filter), 350);
    return () => window.clearTimeout(timer);
  }, [enabled, filter, load]);

  const result = state.loaded?.result ?? null;
  const focus = useMemo(() => onlyOrgUnit(result, filter.orgUnitId), [result, filter.orgUnitId]);
  const children = useMemo(() => excludeOrgUnit(result, filter.orgUnitId), [result, filter.orgUnitId]);

  return {
    result,
    focus,
    children,
    loading: state.loading,
    error: state.error,
    source: state.loaded?.source ?? "DHIS2 — SNIS RDC",
    latestPeriod: state.loaded?.latestPeriod ?? null,
    syncedAt: state.loaded?.syncedAt ?? null,
    childrenMissing: !state.loading && !!result && !children && filter.orgUnitLevel < 5,
    parents: state.loaded?.parents ?? EMPTY_PARENTS,
  };
}

// ─── Page filter scope ───────────────────────────────────────────────────

const LEVEL_KEYS: Record<number, string> = { 1: "country", 2: "province", 3: "zone", 4: "aire", 5: "fosa" };

/**
 * Shared filter clamped to the deepest level the page's data exists at. The
 * store keeps the deeper selection for the other pages; `reset` keeps the
 * coverage page's antigen.
 */
export function usePageFilter(maxLevel = 5) {
  const { filter: raw, setFilter, resetScope } = useDashboardFilters();
  const filter = useMemo(() => clampFilter(raw, maxLevel), [raw, maxLevel]);
  return { filter, setFilter, reset: resetScope, clamped: filter !== raw, maxLevel };
}

/** Singular / plural name of the level below the selected unit. */
export function useChildLevelNames(orgUnitLevel: number) {
  const t = useTranslations("analyticsPageContent.levels");
  const key = LEVEL_KEYS[Math.min(orgUnitLevel + 1, 5)];
  return { one: t(`${key}.one`), many: t(`${key}.many`) };
}

/**
 * Explains why per-unit sections are empty: selection clamped to the page's
 * deepest level, FOSA without children, or children absent from the snapshot
 * (it is synced down to the health zones only).
 */
export function ScopeNotice({
  filter,
  state,
  clamped = false,
  maxLevel = 5,
}: {
  filter: Dhis2FilterState;
  state?: Pick<MultiIndicatorState, "loading" | "childrenMissing">;
  clamped?: boolean;
  maxLevel?: number;
}) {
  const t = useTranslations("analyticsPageContent");
  const children = useChildLevelNames(filter.orgUnitLevel);
  const messages: string[] = [];
  if (clamped) messages.push(t("scope.maxLevel", { level: t(`levels.${LEVEL_KEYS[maxLevel]}.one`) }));
  if (state && !state.loading) {
    if (filter.orgUnitLevel >= 5) messages.push(t("scope.fosa"));
    else if (state.childrenMissing) messages.push(t("scope.childrenMissing", { units: children.many }));
  }
  if (messages.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-800 dark:text-sky-300">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-0.5">
        {messages.map((m) => <p key={m}>{m}</p>)}
      </div>
    </div>
  );
}

/**
 * Label for the SourceBar: "Source — données au juil. 2026 — synchronisé le
 * 11/10/2026 à 21:46" (translated). The sync date tells users how old the
 * snapshot is; the period alone does not (the last complete month is always
 * ~6 weeks back).
 */
export function useDescribeSource() {
  const t = useTranslations("analyticsPageContent");
  const locale = useLocale();
  return useCallback(
    (source: string, period: string | null, syncedAt?: string | null): string => {
      const parts = [source];
      if (period) parts.push(t("sourceDataAt", { period: formatDhis2PeriodShort(period) }));
      if (syncedAt) {
        const d = new Date(syncedAt);
        if (!Number.isNaN(d.getTime())) {
          parts.push(t("sourceSyncedAt", {
            date: d.toLocaleDateString(locale),
            time: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }),
          }));
        }
      }
      return parts.join(" — ");
    },
    [t, locale],
  );
}

// ─── UI primitives ───────────────────────────────────────────────────────

/** Page header: icon tile + title + description. */
export function PageHeader({
  icon: Icon,
  title,
  description,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  accent: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", accent)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

/** Titled section card wrapper. */
export function SectionCard({
  title,
  subtitle,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-sm", className)}>
      {(title || subtitle) && (
        <div className="mb-3 flex shrink-0 items-center justify-between">
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
        </div>
      )}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

/** Graceful empty state for pages whose DHIS2 data is not yet synced. */
export function EmptyState({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50 text-muted-foreground">
        <Icon className="h-7 w-7" />
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

/** Labelled dropdown, laid out inline as a `Dhis2FilterBar` child. */
export function FilterDropdown({
  icon: Icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </label>
      <FilterSelect
        options={options.map((o) => ({ value: o.id, label: o.name }))}
        value={value}
        onChange={onChange}
        placeholder={label}
        minWidth={180}
        className="w-full sm:w-auto"
      />
    </div>
  );
}

/** Source + reset action bar (mirrors the coverage page). */
export function SourceBar({
  source = "DHIS2 — SNIS RDC",
  onReset,
  resetLabel,
}: {
  source?: string;
  onReset?: () => void;
  resetLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Database className="h-3.5 w-3.5 text-primary" />
        <span>{source}</span>
      </div>
      {onReset && (
        <button
          onClick={onReset}
          className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {resetLabel ?? "Réinitialiser"}
        </button>
      )}
    </div>
  );
}

/** Colored status badge (good / warning / critical / neutral). */
export function StatusBadge({
  status,
  label,
}: {
  status: "good" | "warning" | "critical" | "neutral";
  label: string;
}) {
  const colors: Record<string, string> = {
    good: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    warning: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    critical: "bg-rose-500/10 text-rose-600 border-rose-500/30",
    neutral: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", colors[status])}>
      {label}
    </span>
  );
}

/** Placeholder KPI card for pages whose data is not yet synced. */
export function KpiPlaceholder({
  icon: Icon,
  label,
  desc,
  target,
}: {
  icon: LucideIcon;
  label: string;
  desc: string;
  target: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4 shadow-sm opacity-70">
      <div className="flex items-center justify-between">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[10px] text-muted-foreground">{target}</span>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-muted-foreground">—</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight font-medium">{label}</p>
      <p className="mt-1 text-[10px] text-muted-foreground/70">{desc}</p>
    </div>
  );
}

/** Card for an indicator the SNIS does not collect (never shows a fake value). */
export function UnavailableCard({
  icon: Icon,
  title,
  message,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed bg-muted/20 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

/** Line chart of several series of the selected unit over time. */
export function MultiTrendChart({
  result,
  loading,
  title,
  subtitle,
  unit = "",
}: {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
  title: string;
  subtitle?: string;
  unit?: string;
}) {
  const data = useMemo(() => {
    if (!result) return null;
    const periods = [...(result.metaData.dimensions.pe ?? [])].sort();
    const dx = result.metaData.dimensions.dx ?? [];
    return {
      labels: periods.map(formatDhis2PeriodAxis),
      datasets: dx.map((id, i) => {
        const byPe = new Map(result.rows.filter((r) => r[0] === id).map((r) => [r[1], Number(r[3])]));
        const color = CHART_PALETTE[i % CHART_PALETTE.length];
        return {
          label: result.metaData.items[id]?.name ?? id,
          data: periods.map((p) => byPe.get(p) ?? null),
          borderColor: color,
          backgroundColor: color,
          tension: 0.3,
          pointRadius: 2,
          spanGaps: true,
        };
      }),
    };
  }, [result]);

  return (
    <SectionCard title={title} subtitle={subtitle}>
      <div className="h-72 w-full">
        {loading ? (
          <div className="h-full animate-pulse rounded-lg bg-muted/40" />
        ) : data && data.datasets.length > 0 ? (
          <Line
            data={data}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: true, position: "bottom" as const, labels: { font: { size: 13 }, boxWidth: 12 } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.formattedValue}${unit}` } },
              },
              scales: { y: { beginAtZero: true } },
            }}
          />
        ) : (
          <p className="flex h-full items-center justify-center text-xs text-muted-foreground">—</p>
        )}
      </div>
    </SectionCard>
  );
}

export interface ChildColumn {
  id: string;
  label: string;
  format?: (value: number) => string;
  status?: (value: number) => "good" | "warning" | "critical" | null;
}

/**
 * One row per child unit with its latest complete value for each column,
 * sorted by the first column (descending unless `ascending`).
 */
export function ChildrenTable({
  result,
  excludeOrgUnit,
  columns,
  loading,
  title,
  ascending = false,
  mode = "latest",
  unitLabel = "Unité",
}: {
  result: Dhis2AnalyticsResult | null;
  excludeOrgUnit: string;
  columns: ChildColumn[];
  loading: boolean;
  title: string;
  ascending?: boolean;
  /** "latest": last complete month per unit; "sum": total over the period (counts). */
  mode?: "latest" | "sum";
  unitLabel?: string;
}) {
  const { rows, period } = useMemo(() => {
    const byOu = new Map<string, { name: string; values: Record<string, number> }>();
    let latest = "";
    for (const col of columns) {
      if (mode === "sum") {
        for (const [dx, pe, ou, raw] of result?.rows ?? []) {
          const v = Number(raw);
          if (dx !== col.id || ou === excludeOrgUnit || !Number.isFinite(v)) continue;
          const entry = byOu.get(ou) ?? { name: result?.metaData.items[ou]?.name ?? ou, values: {} };
          entry.values[col.id] = (entry.values[col.id] ?? 0) + v;
          byOu.set(ou, entry);
          if (pe > latest) latest = pe;
        }
        continue;
      }
      for (const l of latestByOrgUnit(result, col.id, { exclude: [excludeOrgUnit] })) {
        const entry = byOu.get(l.ouId) ?? { name: l.name, values: {} };
        entry.values[col.id] = l.value;
        byOu.set(l.ouId, entry);
        if (l.period > latest) latest = l.period;
      }
    }
    const key = columns[0]?.id;
    const sorted = [...byOu.values()].sort((a, b) => {
      const va = a.values[key] ?? -Infinity;
      const vb = b.values[key] ?? -Infinity;
      return ascending ? va - vb : vb - va;
    });
    return { rows: sorted, period: latest };
  }, [result, columns, excludeOrgUnit, ascending, mode]);

  if (loading) return <div className="h-48 animate-pulse rounded-xl border bg-card shadow-sm" />;

  return (
    <SectionCard title={title} subtitle={mode === "latest" && period ? formatDhis2PeriodShort(period) : undefined}>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">—</p>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{unitLabel}</th>
                {columns.map((c) => (
                  <th key={c.id} className="pb-2 pr-4 font-medium">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{r.name}</td>
                  {columns.map((c) => {
                    const v = r.values[c.id];
                    const st = v === undefined ? null : c.status?.(v) ?? null;
                    return (
                      <td
                        key={c.id}
                        className={cn(
                          "py-2 pr-4",
                          st === "good" && "text-emerald-600",
                          st === "warning" && "text-amber-600",
                          st === "critical" && "font-medium text-rose-600",
                        )}
                      >
                        {v === undefined ? "—" : c.format ? c.format(v) : formatDhis2Value(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

export const formatPercent = (v: number) => `${v.toFixed(1)} %`;

/** Simple value card for period totals and computed rates. */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  status,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  status?: "good" | "warning" | "critical" | null;
  loading?: boolean;
}) {
  if (loading) return <div className="h-32 animate-pulse rounded-xl border bg-card shadow-sm" />;
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-card p-4 shadow-sm",
        status === "good" && "border-emerald-500/40",
        status === "warning" && "border-amber-500/40",
        status === "critical" && "border-rose-500/40",
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">{label}</p>
      {hint && <p className="mt-1 text-[10px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

/** Threshold-based status from a numeric value (PEV three-band rule). */
export function statusFromThreshold(
  value: number,
  thresholds: ThresholdPair,
  higherIsBetter = true,
): "good" | "warning" | "critical" {
  return thresholdStatus(value, thresholds, higherIsBetter);
}

export { ROOT_OU };
