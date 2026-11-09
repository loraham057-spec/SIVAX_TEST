/**
 * Server-side reads of the ETL snapshot (Supabase `fact_indicator_values`).
 *
 * One call returns, for a set of indicators and explicit periods, the rows of
 * the selected org unit itself (KPI cards, trend) plus its descendants at the
 * requested level (table, map, ranking) in the canonical DHIS2 analytics
 * shape. Results are memoised in-process for a few minutes: the snapshot only
 * changes once a day when the ETL runs.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { withDimensions } from "@/lib/dhis2-analytics";
import type { Dhis2AnalyticsResult } from "@/types";

export const ETL_SOURCE_LABEL = "Supabase (ETL sync)";

/** PostgREST caps a single response at 1000 rows; page through larger sets. */
const PAGE = 1000;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface OrgUnit { id: string; name: string | null; level: number | null; parent_id?: string | null }

const cache = new Map<string, { expiresAt: number; value: EtlAnalytics | null }>();

export interface EtlQuery {
  indicatorIds: string[];
  /** Explicit period codes (YYYYMM or YYYY). */
  periods: string[];
  orgUnitId: string;
  /** Hierarchy level of the descendants to include (omit for the unit alone). */
  childLevel?: number;
}

export interface EtlAnalytics {
  analytics: Dhis2AnalyticsResult;
  /** Most recent period present (data freshness). */
  latestPeriod: string;
  parentOrgUnitId: string;
  /** Parent of each descendant (e.g. province of each zone), when descendants were requested. */
  parents?: Record<string, string>;
}

let lastSync: { expiresAt: number; value: string | null } | null = null;

/**
 * When the snapshot was last written: end of the latest ETL run that loaded
 * rows (a run that timed out still loaded its completed stages).
 */
export async function fetchLastSync(): Promise<string | null> {
  if (lastSync && lastSync.expiresAt > Date.now()) return lastSync.value;
  const sb = createSupabaseAdminClient();
  const { data } = await sb
    .from("etl_runs")
    .select("finished_at")
    .eq("source", "dhis2")
    .gt("rows_loaded", 0)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const value = (data?.finished_at as string | undefined) ?? null;
  lastSync = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function fetchOrgUnit(id: string): Promise<OrgUnit | null> {
  const sb = createSupabaseAdminClient();
  const { data } = await sb.from("dim_org_units").select("id,name,level").eq("id", id).maybeSingle();
  return (data as OrgUnit | null) ?? null;
}

/** Descendants of `parentId` at `level` (direct children via parent_id, deeper via path). */
export async function fetchDescendants(parentId: string, level: number, parentLevel?: number): Promise<OrgUnit[]> {
  const sb = createSupabaseAdminClient();
  const parentLvl = parentLevel ?? (await fetchOrgUnit(parentId))?.level ?? null;
  const base = sb.from("dim_org_units").select("id,name,level,parent_id");
  // Grandchildren (e.g. every zone of the country): by parent id, much
  // faster than a LIKE on the path.
  const grandParents = parentLvl !== null && level === parentLvl + 2
    ? (await fetchDescendants(parentId, parentLvl + 1, parentLvl)).map((c) => c.id)
    : null;
  const query = parentLvl !== null && level === parentLvl + 1
    ? base.eq("parent_id", parentId)
    : grandParents
      ? base.in("parent_id", grandParents)
      : base.eq("level", level).like("path", `%${parentId}/%`);
  const out: OrgUnit[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...((data as OrgUnit[]) ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function fetchFacts(indicatorIds: string[], periods: string[], orgUnitIds: string[]) {
  const sb = createSupabaseAdminClient();
  const rows: { indicator_id: string; org_unit_id: string; period: string; value: number }[] = [];
  // `.in()` is serialised into the URL; keep each request well under the limit.
  const OU_CHUNK = 200;
  for (let i = 0; i < orgUnitIds.length; i += OU_CHUNK) {
    const chunk = orgUnitIds.slice(i, i + OU_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("fact_indicator_values")
        .select("indicator_id,org_unit_id,period,value")
        .eq("source", "dhis2")
        .in("indicator_id", indicatorIds)
        .in("period", periods)
        .in("org_unit_id", chunk)
        .order("period", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }
  return rows;
}

/**
 * Read the ETL snapshot. Returns null when no row matches (caller decides
 * whether to fall back to live DHIS2).
 */
export async function queryEtlAnalytics(q: EtlQuery): Promise<EtlAnalytics | null> {
  const key = JSON.stringify([q.indicatorIds, q.periods, q.orgUnitId, q.childLevel ?? 0]);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const value = await queryEtlAnalyticsUncached(q);
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

async function queryEtlAnalyticsUncached(q: EtlQuery): Promise<EtlAnalytics | null> {
  if (q.indicatorIds.length === 0 || q.periods.length === 0) return null;
  const sb = createSupabaseAdminClient();

  const indicatorsQuery = sb.from("dim_indicators").select("id,label").in("id", q.indicatorIds);
  const parent = await fetchOrgUnit(q.orgUnitId);
  const children = q.childLevel ? await fetchDescendants(q.orgUnitId, q.childLevel, parent?.level ?? undefined) : [];
  const units = new Map<string, OrgUnit>([[q.orgUnitId, parent ?? { id: q.orgUnitId, name: null, level: null }]]);
  for (const c of children) units.set(c.id, c);

  const [facts, { data: indicators }] = await Promise.all([
    fetchFacts(q.indicatorIds, q.periods, [...units.keys()]),
    indicatorsQuery,
  ]);
  if (facts.length === 0) return null;

  const items: Record<string, { name: string }> = {};
  for (const id of q.indicatorIds) {
    items[id] = { name: indicators?.find((i) => i.id === id)?.label ?? id };
  }
  for (const u of units.values()) {
    if (facts.some((f) => f.org_unit_id === u.id)) items[u.id] = { name: u.name && u.name !== u.id ? u.name : u.id };
  }

  const rows = facts.map((f) => [f.indicator_id, f.period, f.org_unit_id, String(f.value)]);
  const analytics = withDimensions({ rows, metaData: { items, dimensions: {} } }, q.indicatorIds);
  const latest = rows.reduce((acc, r) => (r[1] > acc ? r[1] : acc), "");
  const parents: Record<string, string> = {};
  for (const c of children) if (c.parent_id && items[c.id]) parents[c.id] = c.parent_id;
  return {
    analytics,
    latestPeriod: latest,
    parentOrgUnitId: q.orgUnitId,
    ...(Object.keys(parents).length ? { parents } : {}),
  };
}
