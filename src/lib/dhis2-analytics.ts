/**
 * Pure helpers shared by the analytics pages and the Supabase-backed API
 * routes. Everything here operates on the canonical `Dhis2AnalyticsResult`
 * shape (`rows = [dx, pe, ou, value]`) and is free of I/O so it can be unit
 * tested.
 */

import type { Dhis2AnalyticsResult } from "@/types";

const CANONICAL_HEADERS: Dhis2AnalyticsResult["headers"] = [
  { name: "dx", column: "Data", valueType: "TEXT", meta: true },
  { name: "pe", column: "Period", valueType: "TEXT", meta: true },
  { name: "ou", column: "Organisation unit", valueType: "TEXT", meta: true },
  { name: "value", column: "Value", valueType: "NUMBER", meta: false },
];

export const MONTHLY_PERIOD = /^\d{6}$/;

function yyyymm(year: number, month: number): string {
  // month may be out of [1, 12]; Date normalises it.
  const d = new Date(Date.UTC(year, month - 1, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * YYYYMM ids for the current and previous calendar months. DHIS2 monthly
 * data is still being reported during that window, so analytics must not
 * treat those months as the "latest" value.
 */
export function incompletePeriods(now = new Date()): string[] {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return [yyyymm(y, m), yyyymm(y, m - 1)];
}

/**
 * Expand relative period keywords (LAST_12_MONTHS, THIS_YEAR, …) to explicit
 * YYYYMM codes. Explicit codes pass through untouched. LAST_N_MONTHS windows
 * end at the last complete month (see `incompletePeriods`), so "6 months"
 * really covers 6 reported months.
 */
export function expandPeriods(periods: string[], now = new Date()): string[] {
  const cy = now.getFullYear();
  const cm = now.getMonth() + 1;
  const lastN = (n: number) => Array.from({ length: n }, (_, i) => yyyymm(cy, cm - i - 2));
  const year = (y: number, upTo = 12) => Array.from({ length: upTo }, (_, i) => yyyymm(y, i + 1));

  const out: string[] = [];
  for (const p of periods) {
    if (MONTHLY_PERIOD.test(p)) { out.push(p); continue; }
    switch (p.toUpperCase()) {
      case "THIS_MONTH": out.push(yyyymm(cy, cm)); break;
      case "LAST_MONTH": out.push(yyyymm(cy, cm - 1)); break;
      case "LAST_COMPLETE_MONTH": out.push(...lastN(1)); break;
      case "LAST_3_MONTHS": out.push(...lastN(3)); break;
      case "LAST_6_MONTHS": out.push(...lastN(6)); break;
      case "LAST_12_MONTHS": out.push(...lastN(12)); break;
      case "THIS_YEAR": out.push(...year(cy, cm)); break;
      case "LAST_YEAR": out.push(...year(cy - 1)); break;
      case "YEAR_OVER_YEAR": out.push(...year(cy, cm), ...year(cy - 1)); break;
    }
  }
  return [...new Set(out)];
}

/** Rebuild the `dimensions` block from the rows that are actually present. */
export function withDimensions(
  result: Omit<Dhis2AnalyticsResult, "headers" | "metaData"> & Partial<Pick<Dhis2AnalyticsResult, "headers" | "metaData">>,
  dxOrder?: string[],
): Dhis2AnalyticsResult {
  const unique = (i: number) => [...new Set(result.rows.map((r) => r[i]).filter(Boolean))];
  const dx = dxOrder ? dxOrder.filter((id) => result.rows.some((r) => r[0] === id)) : unique(0);
  return {
    headers: result.headers ?? CANONICAL_HEADERS,
    metaData: {
      items: result.metaData?.items ?? {},
      dimensions: { ...result.metaData?.dimensions, dx, pe: unique(1).sort(), ou: unique(2).sort() },
    },
    rows: result.rows,
  };
}

/** Keep only the given indicators (preserving the requested order). */
export function pickIndicators(result: Dhis2AnalyticsResult | null, dxIds: string[]): Dhis2AnalyticsResult | null {
  if (!result) return null;
  const rows = result.rows.filter((r) => dxIds.includes(r[0]));
  if (rows.length === 0) return null;
  return withDimensions({ ...result, rows }, dxIds);
}

/** Keep only the rows of a single org unit (the selected unit itself). */
export function onlyOrgUnit(result: Dhis2AnalyticsResult | null, ouId: string): Dhis2AnalyticsResult | null {
  if (!result) return null;
  const rows = result.rows.filter((r) => r[2] === ouId);
  if (rows.length === 0) return null;
  return withDimensions({ ...result, rows }, result.metaData.dimensions.dx);
}

/** Drop the rows of a single org unit (typically the parent of the children). */
export function excludeOrgUnit(result: Dhis2AnalyticsResult | null, ouId: string): Dhis2AnalyticsResult | null {
  if (!result) return null;
  const rows = result.rows.filter((r) => r[2] !== ouId);
  if (rows.length === 0) return null;
  return withDimensions({ ...result, rows }, result.metaData.dimensions.dx);
}

/**
 * Series for the selected unit: the unit's own rows when present, otherwise
 * (live DHIS2 responses without the parent, or units without their own
 * value) nothing — callers must not fabricate a national value by averaging
 * children of heterogeneous size.
 */
export function focusSeries(result: Dhis2AnalyticsResult | null, ouId: string): Dhis2AnalyticsResult | null {
  return onlyOrgUnit(result, ouId);
}

export interface LatestValue {
  ouId: string;
  name: string;
  period: string;
  value: number;
}

/**
 * Latest complete-period value per org unit for one indicator. Periods still
 * being reported (current/previous month) are ignored unless no other period
 * exists for that unit.
 */
export function latestByOrgUnit(
  result: Dhis2AnalyticsResult | null,
  dxId: string,
  options: { exclude?: string[]; now?: Date } = {},
): LatestValue[] {
  if (!result) return [];
  const incomplete = new Set(incompletePeriods(options.now));
  const excluded = new Set(options.exclude ?? []);
  const best = new Map<string, { period: string; value: number; complete: boolean }>();
  for (const [dx, pe, ou, raw] of result.rows) {
    if (dx !== dxId || excluded.has(ou)) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const complete = !incomplete.has(pe);
    const cur = best.get(ou);
    if (!cur || (complete && !cur.complete) || (complete === cur.complete && pe > cur.period)) {
      best.set(ou, { period: pe, value, complete });
    }
  }
  return [...best.entries()].map(([ouId, v]) => ({
    ouId,
    name: result.metaData.items[ouId]?.name ?? ouId,
    period: v.period,
    value: v.value,
  }));
}

export interface CumulativeValue {
  ouId: string;
  name: string;
  value: number;
  /** First and last months that entered the cumulative value. */
  first: string;
  last: string;
  months: number;
}

function daysInMonth(pe: string): number {
  return new Date(Date.UTC(Number(pe.slice(0, 4)), Number(pe.slice(4, 6)), 0)).getUTCDate();
}

/** Complete monthly values per org unit → period → indicator. */
function completeMonthly(
  result: Dhis2AnalyticsResult | null,
  dxIds: string[],
  options: { exclude?: string[]; now?: Date },
): Map<string, Map<string, Map<string, number>>> {
  const incomplete = new Set(incompletePeriods(options.now));
  const excluded = new Set(options.exclude ?? []);
  const out = new Map<string, Map<string, Map<string, number>>>();
  for (const [dx, pe, ou, raw] of result?.rows ?? []) {
    if (!dxIds.includes(dx) || excluded.has(ou) || incomplete.has(pe) || !MONTHLY_PERIOD.test(pe)) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const byPe = out.get(ou) ?? new Map<string, Map<string, number>>();
    const byDx = byPe.get(pe) ?? new Map<string, number>();
    byDx.set(dx, (byDx.get(dx) ?? 0) + v);
    byPe.set(pe, byDx);
    out.set(ou, byPe);
  }
  return out;
}

function cumulativeMeta(result: Dhis2AnalyticsResult, ouId: string, periods: string[]): Omit<CumulativeValue, "value"> {
  const sorted = [...periods].sort();
  return {
    ouId,
    name: result.metaData.items[ouId]?.name ?? ouId,
    first: sorted[0],
    last: sorted[sorted.length - 1],
    months: sorted.length,
  };
}

/**
 * Cumulative value of an annualized DHIS2 rate (coverage) over the complete
 * months present, per org unit. DHIS2 annualizes a monthly rate as
 * num / target × 365 / days, so with a constant annual target the
 * cumulative rate Σnum / Σ(target × days / 365) is the day-weighted mean of
 * the monthly values.
 */
export function cumulativeAnnualized(
  result: Dhis2AnalyticsResult | null,
  dxId: string,
  options: { exclude?: string[]; now?: Date } = {},
): CumulativeValue[] {
  if (!result) return [];
  const out: CumulativeValue[] = [];
  for (const [ou, byPe] of completeMonthly(result, [dxId], options)) {
    let weighted = 0;
    let days = 0;
    for (const [pe, byDx] of byPe) {
      const d = daysInMonth(pe);
      weighted += (byDx.get(dxId) ?? 0) * d;
      days += d;
    }
    if (days > 0) out.push({ ...cumulativeMeta(result, ou, [...byPe.keys()]), value: weighted / days });
  }
  return out;
}

export interface CumulativeTotals {
  ouId: string;
  name: string;
  /** Sum of each indicator over the months where all of them are reported. */
  totals: Record<string, number>;
  first: string;
  last: string;
  months: number;
}

/**
 * Per org unit, the sum of each indicator over the complete months where
 * every one of them is reported (so a month with Penta1 but no Penta3 does
 * not inflate a difference or a ratio).
 */
export function cumulativeTotals(
  result: Dhis2AnalyticsResult | null,
  dxIds: string[],
  options: { exclude?: string[]; now?: Date } = {},
): CumulativeTotals[] {
  if (!result) return [];
  const out: CumulativeTotals[] = [];
  for (const [ou, byPe] of completeMonthly(result, dxIds, options)) {
    const totals: Record<string, number> = Object.fromEntries(dxIds.map((id) => [id, 0]));
    const used: string[] = [];
    for (const [pe, byDx] of byPe) {
      if (!dxIds.every((id) => byDx.has(id))) continue;
      for (const id of dxIds) totals[id] += byDx.get(id)!;
      used.push(pe);
    }
    if (used.length === 0) continue;
    out.push({ ...cumulativeMeta(result, ou, used), totals });
  }
  return out;
}

/**
 * Cumulative ratio (Σnum − Σsubtract) / Σden × factor per org unit, over the
 * complete months where every indicator of the ratio is reported (e.g.
 * dropout = (ΣPenta1 − ΣPenta3) / ΣPenta1 × 100).
 */
export function cumulativeRatio(
  result: Dhis2AnalyticsResult | null,
  spec: { num: string; subtract?: string; den: string; factor?: number },
  options: { exclude?: string[]; now?: Date } = {},
): CumulativeValue[] {
  const ids = [...new Set([spec.num, spec.den, ...(spec.subtract ? [spec.subtract] : [])])];
  return cumulativeTotals(result, ids, options)
    .filter(({ totals }) => totals[spec.den] > 0)
    .map(({ totals, ...meta }) => ({
      ...meta,
      value: ((totals[spec.num] - (spec.subtract ? totals[spec.subtract] : 0)) / totals[spec.den]) * (spec.factor ?? 1),
    }));
}

/**
 * Single-period view: one row per org unit holding its latest complete value
 * for `dxId`. Lets the per-org-unit charts (bar, pie) render rates without
 * summing them across months.
 */
export function latestSnapshot(
  result: Dhis2AnalyticsResult | null,
  dxId: string,
  options: { exclude?: string[]; now?: Date } = {},
): Dhis2AnalyticsResult | null {
  if (!result) return null;
  const latest = latestByOrgUnit(result, dxId, options);
  if (latest.length === 0) return null;
  return withDimensions(
    { ...result, rows: latest.map((l) => [dxId, l.period, l.ouId, String(l.value)]) },
    [dxId],
  );
}

/** Most recent period present in the result (data freshness). */
export function latestPeriod(result: Dhis2AnalyticsResult | null): string | null {
  if (!result?.rows.length) return null;
  return result.rows.reduce<string | null>((acc, r) => (acc === null || r[1] > acc ? r[1] : acc), null);
}

export interface DerivedSeries {
  id: string;
  name: string;
  /** Indicators summed into the numerator. */
  num: string[];
  /** Indicators subtracted from the numerator, all required (e.g. used − administered). */
  subtract?: string[];
  /** Indicators summed into the denominator; omit for a plain sum. */
  den?: string[];
  /** Multiplier applied to num/den (100 for a percentage). */
  factor?: number;
  /**
   * DHIS2 does not store zeros: when the denominator exists but no
   * numerator row does, the true value is 0 (e.g. no facility in stock-out).
   */
  missingNumIsZero?: boolean;
}

/**
 * Compute a derived series per (period, org unit) — ratio or sum of synced
 * indicators — in the canonical row shape, so the generic chart components
 * can render it like any DHIS2 indicator.
 */
export function deriveSeries(result: Dhis2AnalyticsResult | null, spec: DerivedSeries): Dhis2AnalyticsResult | null {
  if (!result) return null;
  const sums = (ids: string[]) => {
    const m = new Map<string, number>();
    for (const [dx, pe, ou, raw] of result.rows) {
      if (!ids.includes(dx)) continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      const k = `${pe}|${ou}`;
      m.set(k, (m.get(k) ?? 0) + v);
    }
    return m;
  };
  const num = sums(spec.num);
  const sub = spec.subtract ? sums(spec.subtract) : null;
  const den = spec.den ? sums(spec.den) : null;
  const keys = den && spec.missingNumIsZero ? new Set([...num.keys(), ...den.keys()]) : new Set(num.keys());
  const rows: string[][] = [];
  for (const k of keys) {
    const n = num.get(k) ?? (spec.missingNumIsZero ? 0 : undefined);
    if (n === undefined) continue;
    const s = sub ? sub.get(k) : 0;
    if (s === undefined) continue;
    let value = n - s;
    if (den) {
      const d = den.get(k);
      if (!d) continue;
      value = (value / d) * (spec.factor ?? 1);
    } else if (spec.factor) {
      value *= spec.factor;
    }
    const [pe, ou] = k.split("|");
    rows.push([spec.id, pe, ou, String(Math.round(value * 100) / 100)]);
  }
  if (rows.length === 0) return null;
  return withDimensions(
    { rows, metaData: { items: { ...result.metaData.items, [spec.id]: { name: spec.name } }, dimensions: {} } },
    [spec.id],
  );
}

/** Derive several series at once and merge them (in the given order). */
export function deriveAll(result: Dhis2AnalyticsResult | null, specs: DerivedSeries[]): Dhis2AnalyticsResult | null {
  return mergeResults(specs.map((s) => deriveSeries(result, s)), specs.map((s) => s.id));
}

/** First and last periods with a value for any of the indicators, for one org unit. */
export function periodSpan(
  result: Dhis2AnalyticsResult | null,
  dxIds: string[],
  ouId: string,
): { first: string; last: string } | null {
  let first = "";
  let last = "";
  for (const [dx, pe, ou, raw] of result?.rows ?? []) {
    if (ou !== ouId || !dxIds.includes(dx) || !Number.isFinite(Number(raw))) continue;
    if (!first || pe < first) first = pe;
    if (pe > last) last = pe;
  }
  return first ? { first, last } : null;
}

/** Sum of an indicator over every period present, for one org unit. */
export function totalOverPeriods(result: Dhis2AnalyticsResult | null, dxId: string, ouId: string): number | null {
  if (!result) return null;
  let total: number | null = null;
  for (const [dx, , ou, raw] of result.rows) {
    if (dx !== dxId || ou !== ouId) continue;
    const v = Number(raw);
    if (Number.isFinite(v)) total = (total ?? 0) + v;
  }
  return total;
}

/** Merge several results (same shape) into one multi-dx result. */
export function mergeResults(results: Array<Dhis2AnalyticsResult | null>, dxOrder?: string[]): Dhis2AnalyticsResult | null {
  const present = results.filter((r): r is Dhis2AnalyticsResult => Boolean(r?.rows.length));
  if (present.length === 0) return null;
  return withDimensions(
    {
      rows: present.flatMap((r) => r.rows),
      metaData: { items: Object.assign({}, ...present.map((r) => r.metaData.items)), dimensions: {} },
    },
    dxOrder,
  );
}
