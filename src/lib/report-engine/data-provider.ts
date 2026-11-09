/**
 * ReportDataProvider — retrieves the data required by a report plan.
 *
 * The LLM never accesses the database directly: this module controls
 * every query. Data comes from the SIVAX warehouse snapshot
 * (fact_indicator_values via queryEtlAnalytics) — the same source as the
 * analytics pages — with a single-attempt live DHIS2 fallback per
 * missing indicator. Metrics with no data are flagged unavailable —
 * never invented. Requested periods are clamped to the current month;
 * actual data coverage is reported for transparency.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAnalyticsAdvanced, fetchOrgUnits } from "@/lib/dhis2";
import { fetchLastSync, queryEtlAnalytics } from "@/lib/etl-analytics";
import {
  getReportType,
  requirementIndicatorIds,
  type ReportDataRequirement,
} from "./registry";
import type { ReportPlan } from "./types";

const NATIONAL_OU = "ymGeqzoPhN3";
const NATIONAL_SCOPE_WORDS = new Set([
  "rdc", "drc", "congo", "national", "republique democratique du congo", "pays",
]);

export interface ReportScope {
  id: string;
  name: string;
  level: number;
  /** False when the requested place could not be matched to an org unit. */
  resolved: boolean;
  /** The raw scope text requested by the user/planner. */
  query?: string;
}

export interface MetricData {
  requirement: ReportDataRequirement;
  metricId?: string;
  metricName?: string;
  available: boolean;
  /** Monthly values for the scope itself (sorted by period YYYYMM). */
  trend: { period: string; value: number }[];
  /** Aggregates per sub-unit (province/zone) over the covered periods. */
  geo: { id: string; name: string; value: number }[];
  source?: string;
}

export interface ReportData {
  scope: ReportScope;
  /** Periods requested by the plan (clamped to the current month). */
  periods: string[];
  /** Periods for which at least one metric has data. */
  coveredPeriods: string[];
  /** Most recent period with data, if any. */
  latestPeriod?: string;
  /** When the warehouse snapshot was last synced. */
  syncedAt?: string;
  metrics: MetricData[];
  sources: string[];
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function currentMonthCode(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Convert a plan period ({start,end} as YYYY-MM) to DHIS2 monthly codes,
 * excluding months after the current one (no future/projection rows).
 */
export function planPeriods(plan: ReportPlan): string[] {
  const [sy, sm] = plan.period.start.split("-").map(Number);
  const [ey, em] = plan.period.end.split("-").map(Number);
  const cap = currentMonthCode();
  const periods: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const code = `${y}${String(m).padStart(2, "0")}`;
    if (code <= cap) periods.push(code);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    if (periods.length >= 36) break;
  }
  return periods;
}

/**
 * Resolve the geographic scope to an org unit.
 * Matching is accent- and hyphen-insensitive ("Haut-Katanga" matches
 * "hk Haut Katanga Province"). Returns `resolved: false` with the
 * national fallback when nothing matches — callers must surface it.
 */
export async function resolveScope(scopeName?: string): Promise<ReportScope> {
  const national: ReportScope = { id: NATIONAL_OU, name: "RDC (National)", level: 1, resolved: true };
  const query = scopeName?.trim();
  if (!query) return national;

  const normalized = normalizeText(query);
  if (!normalized || NATIONAL_SCOPE_WORDS.has(normalized)) return { ...national, query };

  const tokens = normalized.split(" ").filter((t) => t.length >= 2);
  const patterns = [`%${query}%`, ...(tokens.length ? [`%${tokens.join("%")}%`] : [])];

  try {
    const sb = createSupabaseAdminClient();
    for (const pattern of patterns) {
      const { data } = await sb
        .from("dim_org_units")
        .select("id,name,level")
        .ilike("name", pattern)
        .lte("level", 3)
        .order("level", { ascending: true })
        .limit(1);
      if (data && data[0]) {
        return { id: data[0].id, name: data[0].name, level: data[0].level, resolved: true, query };
      }
    }
  } catch {
    // warehouse unavailable — try DHIS2
  }

  try {
    const { organisationUnits } = await fetchOrgUnits({ search: query });
    const match = organisationUnits
      .filter((ou) => (ou.level ?? 99) <= 3)
      .sort((a, b) => (a.level ?? 99) - (b.level ?? 99))[0];
    if (match) return { id: match.id, name: match.name, level: match.level ?? 2, resolved: true, query };
  } catch {
    // scope not resolvable
  }
  return { ...national, resolved: false, query };
}

interface FactRow { indicatorId: string; period: string; orgUnitId: string; value: number }

interface FactSet {
  rows: FactRow[];
  names: Record<string, string>;
  source: Map<string, string>;
}

/** Fetch all needed indicators in one snapshot read + per-indicator live fallback. */
async function fetchFacts(
  indicatorIds: string[],
  periods: string[],
  scope: ReportScope,
  childLevel: number | undefined,
): Promise<FactSet> {
  const rows: FactRow[] = [];
  const names: Record<string, string> = {};
  const source = new Map<string, string>();

  try {
    const etl = await queryEtlAnalytics({ indicatorIds, periods, orgUnitId: scope.id, childLevel });
    if (etl) {
      for (const row of etl.analytics.rows) {
        const value = Number(row[3]);
        if (!Number.isFinite(value)) continue;
        rows.push({ indicatorId: row[0], period: row[1], orgUnitId: row[2], value });
        source.set(row[0], "Entrepôt SIVAX (ETL DHIS2/SIGL)");
      }
      Object.entries(etl.analytics.metaData.items).forEach(([id, item]) => {
        names[id] = item.name;
      });
    }
  } catch {
    // snapshot unreachable — fall through to live DHIS2 below
  }

  // Single-attempt live DHIS2 fallback for indicators absent from the snapshot.
  const present = new Set(rows.map((r) => r.indicatorId));
  const missing = indicatorIds.filter((id) => !present.has(id));
  if (missing.length > 0) {
    await Promise.all(missing.map(async (id) => {
      try {
        const analytics = await fetchAnalyticsAdvanced({
          dx: [id],
          pe: periods,
          ou: scope.id,
          targetOrgUnitLevel: childLevel,
        });
        for (const row of analytics.rows) {
          const value = Number(row[3]);
          if (!Number.isFinite(value)) continue;
          rows.push({ indicatorId: row[0], period: row[1], orgUnitId: row[2], value });
        }
        if (analytics.rows.length > 0) source.set(id, "DHIS2 — SNIS RDC (temps réel)");
        Object.entries(analytics.metaData.items).forEach(([key, item]) => {
          names[key] = names[key] ?? item.name;
        });
      } catch {
        // indicator stays unavailable
      }
    }));
  }

  return { rows, names, source };
}

type SeriesMap = Map<string, Map<string, number>>; // period → (orgUnit → value)

function seriesFor(facts: FactSet, indicatorId: string, allowedOus: Set<string>): SeriesMap {
  const map: SeriesMap = new Map();
  for (const row of facts.rows) {
    if (row.indicatorId !== indicatorId) continue;
    if (!allowedOus.has(row.orgUnitId)) continue;
    const byOu = map.get(row.period) ?? new Map<string, number>();
    // The snapshot has one row per (indicator, period, org unit); keep last.
    byOu.set(row.orgUnitId, row.value);
    map.set(row.period, byOu);
  }
  return map;
}

function buildMetric(
  requirement: ReportDataRequirement,
  facts: FactSet,
  scope: ReportScope,
  subUnits: { id: string; name: string }[],
): MetricData {
  const empty: MetricData = { requirement, available: false, trend: [], geo: [] };
  if (requirement.unavailableReason) return empty;

  const allowed = new Set([scope.id, ...subUnits.map((u) => u.id)]);
  const unitName = (id: string) => subUnits.find((u) => u.id === id)?.name ?? facts.names[id] ?? id;

  const compute = (period: string, ou: string): number | null => {
    if (requirement.ratio) {
      const num = seriesCache.get(requirement.ratio.num)?.get(period)?.get(ou);
      const den = seriesCache.get(requirement.ratio.den)?.get(period)?.get(ou);
      if (num === undefined || den === undefined || den === 0) return null;
      return (num / den) * (requirement.ratio.factor ?? 1);
    }
    return seriesCache.get(requirement.indicatorId!)?.get(period)?.get(ou) ?? null;
  };

  const seriesCache = new Map<string, SeriesMap>();
  const ids = requirement.ratio ? [requirement.ratio.num, requirement.ratio.den] : [requirement.indicatorId!];
  for (const id of ids) seriesCache.set(id, seriesFor(facts, id, allowed));

  const periods = [...new Set(ids.flatMap((id) => [...(seriesCache.get(id)?.keys() ?? [])]))].sort();

  // Trend at the scope itself
  const trend: { period: string; value: number }[] = [];
  for (const period of periods) {
    const value = compute(period, scope.id);
    if (value !== null) trend.push({ period, value: Math.round(value * 100) / 100 });
  }

  // Geographic aggregation per sub-unit over the covered periods:
  // percentages/ratios → mean of monthly values (ratios: ratio of sums),
  // counts → sum.
  const geo: { id: string; name: string; value: number }[] = [];
  for (const unit of subUnits) {
    if (requirement.ratio) {
      let num = 0;
      let den = 0;
      for (const period of periods) {
        const n = seriesCache.get(requirement.ratio.num)?.get(period)?.get(unit.id);
        const d = seriesCache.get(requirement.ratio.den)?.get(period)?.get(unit.id);
        if (n !== undefined && d !== undefined) { num += n; den += d; }
      }
      if (den > 0) geo.push({ id: unit.id, name: unitName(unit.id), value: Math.round((num / den) * (requirement.ratio.factor ?? 1) * 100) / 100 });
    } else {
      const values = periods
        .map((p) => seriesCache.get(requirement.indicatorId!)?.get(p)?.get(unit.id))
        .filter((v): v is number => v !== undefined);
      if (values.length === 0) continue;
      const value = requirement.unit === "percent"
        ? values.reduce((s, v) => s + v, 0) / values.length
        : values.reduce((s, v) => s + v, 0);
      geo.push({ id: unit.id, name: unitName(unit.id), value: Math.round(value * 100) / 100 });
    }
  }
  geo.sort((a, b) => b.value - a.value);

  if (trend.length === 0 && geo.length === 0) return empty;

  const sourceId = requirement.indicatorId ?? requirement.ratio?.num;
  return {
    requirement,
    metricId: requirement.indicatorId ?? (requirement.ratio ? `${requirement.ratio.num}/${requirement.ratio.den}` : undefined),
    metricName: requirement.indicatorId ? facts.names[requirement.indicatorId] : requirement.label,
    available: true,
    trend,
    geo,
    source: (sourceId && facts.source.get(sourceId)) ?? "Entrepôt SIVAX (ETL DHIS2/SIGL)",
  };
}

/** Fetch all data required by the plan's report type. */
export async function fetchReportData(plan: ReportPlan): Promise<ReportData> {
  const definition = getReportType(plan.reportType);
  const scope = await resolveScope(plan.geographicScope);
  const periods = planPeriods(plan);
  const indicatorIds = requirementIndicatorIds(definition.requiredData);
  const childLevel = scope.level < 3 ? scope.level + 1 : undefined;

  const [facts, syncedAt] = await Promise.all([
    fetchFacts(indicatorIds, periods, scope, childLevel),
    fetchLastSync().catch(() => undefined),
  ]);

  const subUnits = childLevel
    ? [...new Set(facts.rows.filter((r) => r.orgUnitId !== scope.id).map((r) => r.orgUnitId))]
        .map((id) => ({ id, name: facts.names[id] ?? id }))
    : [];

  const metrics = definition.requiredData.map((req) => buildMetric(req, facts, scope, subUnits));

  const coveredPeriods = [...new Set(metrics.flatMap((m) => m.trend.map((t) => t.period)))].sort();
  const sources = [...new Set(metrics.filter((m) => m.available && m.source).map((m) => m.source as string))];

  return {
    scope,
    periods,
    coveredPeriods,
    latestPeriod: coveredPeriods[coveredPeriods.length - 1],
    syncedAt: syncedAt ?? undefined,
    metrics,
    sources,
  };
}
