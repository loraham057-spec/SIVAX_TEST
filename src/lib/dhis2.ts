/**
 * DHIS2 client (server-side only)
 *
 * Talks directly to a DHIS2 instance (e.g. SNIS RDC — https://snisrdc.com)
 * using HTTP Basic auth. Credentials are read from environment variables and
 * MUST never be exposed to the browser — always call this from an API route.
 *
 * Env vars:
 *   DHIS2_BASE_URL   e.g. https://snisrdc.com
 *   DHIS2_USERNAME
 *   DHIS2_PASSWORD
 *   DHIS2_ROOT_OU    (optional) root org unit id, defaults to the DRC root
 */

import type {
  Dhis2OrgUnit,
  Dhis2OrgUnitLevel,
  Dhis2DataSet,
  Dhis2DataValueSet,
  Dhis2AnalyticsResult,
  Dhis2SystemInfo,
} from "@/types";
import { getSettings } from "@/lib/settings";

async function getDhis2Config() {
  const values = await getSettings([
    "dhis2_base_url",
    "dhis2_username",
    "dhis2_password",
    "dhis2_root_ou",
  ]);
  return {
    baseUrl: values.dhis2_base_url.replace(/\/$/, ""),
    username: values.dhis2_username,
    password: values.dhis2_password,
    rootOu: values.dhis2_root_ou || "ymGeqzoPhN3",
  };
}

export async function isDhis2Configured(): Promise<boolean> {
  const config = await getDhis2Config();
  return Boolean(config.baseUrl && config.username && config.password);
}

// ─── In-memory cache with TTL ─────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

const CACHE_TTL_METADATA = 24 * 60 * 60 * 1000; // 24h for metadata
const CACHE_TTL_DATA = 10 * 60 * 1000; // 10 min for data values / analytics

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttl: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

export function clearDhis2Cache(): void {
  cache.clear();
}

// ─── Low-level fetch with retry ────────────────────────────

/**
 * Low-level GET against the DHIS2 REST API with retry/backoff.
 * @param path API path starting with `/api/...` including query string.
 * @param retries Number of retry attempts (default 2)
 */
export async function dhis2Get<T>(path: string, retries = 2, timeoutMs = 15_000): Promise<T> {
  const config = await getDhis2Config();
  if (!config.baseUrl || !config.username || !config.password) {
    throw new Error("DHIS2 is not configured (missing base URL, username, or password)");
  }

  const url = `${config.baseUrl}${path}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`DHIS2 request failed (${res.status}) for ${path}: ${detail.slice(0, 200)}`);
      }

      return (await res.json()) as T;
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    }
  }

  throw new Error("DHIS2 request: unreachable");
}

// ─── Raw data fallback (when analytics tables are empty) ───

const indicatorDefCache = new Map<string, {
  name: string;
  numeratorDEs: string[];
  denominatorDEs: string[];
  denominatorIsConstant: boolean;
  denominatorValue: number;
}>();

async function getIndicatorDefinition(indicatorId: string) {
  const cached = indicatorDefCache.get(indicatorId);
  if (cached) return cached;

  const path = `/api/indicators/${indicatorId}.json?fields=id,name,numerator,denominator,indicatorType[id,name]`;
  const raw = await dhis2Get<Record<string, unknown>>(path);

  const extractDEs = (formula: string): string[] => {
    const matches = formula.match(/#\{(\w+)\}/g);
    return matches ? matches.map((m) => m.replace(/[#{}]/g, "")) : [];
  };

  const numerator = (raw.numerator as string) ?? "";
  const denominator = (raw.denominator as string) ?? "";
  const numeratorDEs = extractDEs(numerator);
  const denominatorDEs = extractDEs(denominator);
  const denominatorIsConstant = denominatorDEs.length === 0;
  const denominatorValue = denominatorIsConstant ? Number(denominator.trim()) || 1 : 1;

  const result = {
    name: (raw.name as string) ?? indicatorId,
    numeratorDEs,
    denominatorDEs,
    denominatorIsConstant,
    denominatorValue,
  };
  indicatorDefCache.set(indicatorId, result);
  return result;
}

const MONTH_NAMES_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function periodDisplayName(period: string): string {
  if (/^\d{6}$/.test(period)) {
    const year = period.slice(0, 4);
    const month = Number(period.slice(4, 6));
    return `${MONTH_NAMES_FR[month - 1]} ${year}`;
  }
  if (/^\d{4}$/.test(period)) {
    return period;
  }
  return period;
}

function resolveRelativePeriods(pe: string[]): string[] {
  const now = new Date();
  const resolved: string[] = [];

  for (const p of pe) {
    if (/^\d{6}$/.test(p)) {
      resolved.push(p);
    } else if (p === "LAST_12_MONTHS") {
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        resolved.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    } else if (p === "LAST_6_MONTHS") {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        resolved.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    } else if (p === "LAST_3_MONTHS") {
      for (let i = 2; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        resolved.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
      }
    } else if (p === "THIS_MONTH") {
      resolved.push(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`);
    } else if (p === "LAST_MONTH") {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      resolved.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    } else if (p === "THIS_YEAR") {
      for (let m = 1; m <= now.getMonth() + 1; m++) {
        resolved.push(`${now.getFullYear()}${String(m).padStart(2, "0")}`);
      }
    } else if (p === "LAST_YEAR") {
      const y = now.getFullYear() - 1;
      for (let m = 1; m <= 12; m++) {
        resolved.push(`${y}${String(m).padStart(2, "0")}`);
      }
    } else {
      resolved.push(p);
    }
  }
  return [...new Set(resolved)].sort();
}

async function fetchRawDataAggregated(params: {
  dataElements: string[];
  period: string;
  orgUnit: string;
  children: boolean;
}): Promise<Map<string, number>> {
  const { dataElements, period, orgUnit, children } = params;

  // Batch all data elements in a single request using repeated dataElement params
  let path = `/api/dataValueSets.json?period=${period}&orgUnit=${orgUnit}`;
  for (const de of dataElements) {
    path += `&dataElement=${de}`;
  }
  if (children) path += `&children=true`;

  const result = await dhis2Get<Record<string, unknown>>(path).catch(() => null);
  const byOrgUnit = new Map<string, number>();

  const dvs = result?.dataValues as Array<Record<string, string>> | undefined;
  if (!dvs) return byOrgUnit;

  for (const dv of dvs) {
    const value = Number(dv.value);
    if (!Number.isNaN(value)) {
      byOrgUnit.set(dv.orgUnit, (byOrgUnit.get(dv.orgUnit) ?? 0) + value);
    }
  }

  return byOrgUnit;
}

async function fetchRawDataRangeByDE(params: {
  dataElements: string[];
  periods: string[];
  orgUnit: string;
  children: boolean;
}): Promise<Map<string, Map<string, Map<string, number>>>> {
  // Returns: period -> dataElement -> orgUnit -> value
  const { dataElements, periods, orgUnit, children } = params;
  if (periods.length === 0) return new Map();

  const CONCURRENCY = 4;
  const byPeriodDeOrg = new Map<string, Map<string, Map<string, number>>>();

  for (let i = 0; i < periods.length; i += CONCURRENCY) {
    const batch = periods.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (period) => {
        let path = `/api/dataValueSets.json?period=${period}&orgUnit=${orgUnit}`;
        for (const de of dataElements) {
          path += `&dataElement=${de}`;
        }
        if (children) path += `&children=true`;

        const result = await dhis2Get<Record<string, unknown>>(path, 1, 30_000).catch(() => null);
        // deOrgMap: dataElement -> orgUnit -> value
        const deOrgMap = new Map<string, Map<string, number>>();
        const dvs = result?.dataValues as Array<Record<string, string>> | undefined;
        if (dvs) {
          for (const dv of dvs) {
            const value = Number(dv.value);
            if (Number.isNaN(value)) continue;
            const orgMap = deOrgMap.get(dv.dataElement) ?? new Map<string, number>();
            orgMap.set(dv.orgUnit, (orgMap.get(dv.orgUnit) ?? 0) + value);
            deOrgMap.set(dv.dataElement, orgMap);
          }
        }
        return { period, deOrgMap };
      })
    );
    for (const { period, deOrgMap } of results) {
      if (deOrgMap.size > 0) byPeriodDeOrg.set(period, deOrgMap);
    }
  }

  return byPeriodDeOrg;
}

async function fetchAnalyticsFromRaw(params: {
  dx: string[];
  pe: string[];
  ou: string;
  children?: boolean;
  targetOrgUnitLevel?: number;
}): Promise<Dhis2AnalyticsResult> {
  const { dx, pe, ou, children = true, targetOrgUnitLevel } = params;
  const periods = resolveRelativePeriods(pe);

  const allRows: string[][] = [];
  const items: Record<string, { name: string }> = {};
  const dxSet = new Set<string>();
  const peSet = new Set<string>();
  const ouSet = new Set<string>();

  // Pre-fetch all indicator definitions in parallel.
  // When the ID is a data element (not an indicator), getIndicatorDefinition
  // throws — we catch and try the dataElements endpoint to get the real name
  // instead of leaving the raw UID as the display name.
  const defs = await Promise.all(
    dx.map(async (singleDx) => {
      try {
        return await getIndicatorDefinition(singleDx);
      } catch {
        let name = singleDx;
        try {
          const de = await dhis2Get<{ id: string; name: string }>(
            `/api/dataElements/${singleDx}.json?fields=id,name`,
          );
          if (de?.name) name = de.name;
        } catch {
          // keep UID as fallback name
        }
        return {
          name,
          numeratorDEs: [singleDx],
          denominatorDEs: [],
          denominatorIsConstant: true,
          denominatorValue: 1,
        };
      }
    })
  );

  // Collect ALL unique data elements across all indicators (numerators + denominators)
  const allDEs = new Set<string>();
  for (const def of defs) {
    def.numeratorDEs.forEach((de) => allDEs.add(de));
    def.denominatorDEs.forEach((de) => allDEs.add(de));
  }

  // Single batched fetch: all data elements × all periods
  // This reduces HTTP requests from N_indicators × N_periods to just N_periods
  let byPeriodDeOrg = await fetchRawDataRangeByDE({
    dataElements: [...allDEs],
    periods,
    orgUnit: ou,
    children,
  });

  // Fallback: some data elements (e.g. Population) are stored yearly, not
  // monthly. If monthly periods returned no data, retry with the corresponding
  // yearly periods so the user still sees numeric values instead of an empty
  // result that surfaces raw UIDs.
  if (byPeriodDeOrg.size === 0 && periods.length > 0) {
    const years = [...new Set(periods.map((p) => p.slice(0, 4)))];
    const yearlyPeriods = years.map((y) => y);
    if (yearlyPeriods.length > 0) {
      const yearlyResult = await fetchRawDataRangeByDE({
        dataElements: [...allDEs],
        periods: yearlyPeriods,
        orgUnit: ou,
        children,
      });
      if (yearlyResult.size > 0) {
        byPeriodDeOrg = yearlyResult;
        // Replace monthly periods with yearly ones for row construction
        periods.length = 0;
        periods.push(...yearlyPeriods);
      }
    }
  }

  // Helper: sum values for a set of data elements, per org unit, for a given period
  const sumDEs = (deIds: string[], period: string): Map<string, number> => {
    const deOrgMap = byPeriodDeOrg.get(period);
    const result = new Map<string, number>();
    if (!deOrgMap) return result;
    for (const deId of deIds) {
      const orgMap = deOrgMap.get(deId);
      if (!orgMap) continue;
      for (const [orgUnitId, val] of orgMap) {
        result.set(orgUnitId, (result.get(orgUnitId) ?? 0) + val);
      }
    }
    return result;
  };

  // Build rows
  for (let i = 0; i < dx.length; i++) {
    const def = defs[i];
    const singleDx = dx[i];
    if (!items[singleDx]) items[singleDx] = { name: def.name };
    dxSet.add(singleDx);

    for (const period of periods) {
      peSet.add(period);
      if (!items[period]) items[period] = { name: periodDisplayName(period) };

      const numByOrg = sumDEs(def.numeratorDEs, period);
      const denByOrg = def.denominatorIsConstant
        ? null
        : sumDEs(def.denominatorDEs, period);

      for (const [orgUnitId, numValue] of numByOrg) {
        let value = numValue;
        if (!def.denominatorIsConstant && denByOrg) {
          const denValue = denByOrg.get(orgUnitId) ?? 0;
          if (denValue !== 0) {
            value = (numValue / denValue) * 100;
          } else {
            continue;
          }
        } else if (def.denominatorIsConstant && def.denominatorValue !== 1) {
          value = numValue * def.denominatorValue;
        }

        ouSet.add(orgUnitId);
        allRows.push([singleDx, period, orgUnitId, String(Math.round(value * 100) / 100)]);
      }
    }
  }

  const headers = [
    { name: "dx", column: "Data", valueType: "TEXT", meta: true },
    { name: "pe", column: "Period", valueType: "TEXT", meta: true },
    { name: "ou", column: "Organisation unit", valueType: "TEXT", meta: true },
    { name: "value", column: "Value", valueType: "NUMBER", meta: false },
  ];

  if (!targetOrgUnitLevel) {
    const aggregated = new Map<string, number>();
    for (const row of allRows) {
      const key = `${row[0]}:${row[1]}`;
      aggregated.set(key, (aggregated.get(key) ?? 0) + Number(row[3]));
    }
    return {
      headers,
      metaData: {
        items: { ...items, [ou]: { name: ou } },
        dimensions: { dx: [...dxSet], pe: [...peSet], ou: [ou], co: [] },
      },
      rows: [...aggregated.entries()].map(([key, value]) => {
        const [dxId, peId] = key.split(":");
        return [dxId, peId, ou, String(Math.round(value * 100) / 100)];
      }),
    };
  }

  for (const ouId of ouSet) {
    if (!items[ouId]) items[ouId] = { name: ouId };
  }

  // Batch resolve org unit names
  const unresolvedOus = [...ouSet].filter((id) => items[id].name === id);
  if (unresolvedOus.length > 0) {
    try {
      const filter = `id:in:[${unresolvedOus.join(",")}]`;
      const ouList = await dhis2Get<{ organisationUnits: Array<{ id: string; name: string }> }>(
        `/api/organisationUnits.json?filter=${filter}&fields=id,name&paging=false`
      );
      for (const ou of ouList.organisationUnits ?? []) {
        items[ou.id] = { name: ou.name };
      }
    } catch {
      // keep fallback names
    }
  }

  return {
    headers,
    metaData: {
      items,
      dimensions: { dx: [...dxSet], pe: [...peSet], ou: [...ouSet], co: [] },
    },
    rows: allRows,
  };
}

// ─── Analytics ─────────────────────────────────────────────

/**
 * Normalize a raw DHIS2 analytics response into the canonical 4-column
 * `[dx, pe, ou, value]` row shape that every consumer (table, charts, map,
 * route) expects.
 *
 * DHIS2 analytics responses can include extra dimension columns such as
 * `co` (category option combo) or `ao` (attribute option combo) when the
 * queried data element has categories. In that case the value is no longer at
 * a fixed `row[3]` index — it must be located from the response headers.
 *
 * This helper:
 *   1. locates the `dx`, `pe`, `ou` dimension columns by header name;
 *   2. locates the value column (the non-meta, numeric header, or the header
 *      literally named "value");
 *   3. sums values per unique `(dx, pe, ou)` key so that multiple category
 *      option combos collapse into a single measurement;
 *   4. returns rows in the canonical `[dx, pe, ou, value]` order plus a
 *      canonical 4-header layout.
 *
 * Responses that are already in the canonical shape pass through unchanged.
 */
function normalizeAnalyticsResult(response: Dhis2AnalyticsResult): {
  rows: string[][];
  headers: Dhis2AnalyticsResult["headers"];
} {
  const headers = response.headers ?? [];
  if (headers.length === 0 || !response.rows || response.rows.length === 0) {
    return {
      rows: response.rows ?? [],
      headers: [
        { name: "dx", column: "Data", valueType: "TEXT", meta: true },
        { name: "pe", column: "Period", valueType: "TEXT", meta: true },
        { name: "ou", column: "Organisation unit", valueType: "TEXT", meta: true },
        { name: "value", column: "Value", valueType: "NUMBER", meta: false },
      ],
    };
  }

  const findIndex = (name: string) => headers.findIndex((h) => h.name === name);

  let dxIdx = findIndex("dx");
  let peIdx = findIndex("pe");
  let ouIdx = findIndex("ou");

  // Value column: prefer the header literally named "value"; otherwise the
  // first non-meta numeric header; otherwise fall back to the last column.
  let valueIdx = findIndex("value");
  if (valueIdx === -1) {
    valueIdx = headers.findIndex((h) => !h.meta && h.valueType === "NUMBER");
  }
  if (valueIdx === -1) {
    valueIdx = headers.length - 1;
  }

  // If the response is already canonical (dx, pe, ou, value) and has no extra
  // dimension columns, return as-is to avoid unnecessary aggregation work.
  const extraDimIndices = headers
    .map((h, i) => (h.meta && i !== dxIdx && i !== peIdx && i !== ouIdx ? i : -1))
    .filter((i) => i !== -1);

  if (
    dxIdx !== -1 &&
    peIdx !== -1 &&
    ouIdx !== -1 &&
    valueIdx !== -1 &&
    extraDimIndices.length === 0 &&
    dxIdx === 0 &&
    peIdx === 1 &&
    ouIdx === 2 &&
    valueIdx === 3
  ) {
    return { rows: response.rows, headers };
  }

  // Some responses may not declare one of the standard dimensions (e.g. a
  // query without `ou`). In that case synthesize a placeholder so the row
  // shape stays 4-wide.
  if (dxIdx === -1) dxIdx = 0;
  if (peIdx === -1) peIdx = 1;
  if (ouIdx === -1) ouIdx = 2;

  // Aggregate per (dx, pe, ou) so multiple category option combos collapse.
  const aggregated = new Map<string, number>();
  for (const row of response.rows) {
    const dx = row[dxIdx] ?? "";
    const pe = row[peIdx] ?? "";
    const ou = row[ouIdx] ?? "";
    const raw = row[valueIdx];
    const num = Number(raw);
    if (!Number.isFinite(num)) continue;
    const key = `${dx}\u0000${pe}\u0000${ou}`;
    aggregated.set(key, (aggregated.get(key) ?? 0) + num);
  }

  const normalizedRows = [...aggregated.entries()].map(([key, value]) => {
    const [dx, pe, ou] = key.split("\u0000");
    return [dx, pe, ou, String(Math.round(value * 100) / 100)];
  });

  const canonicalHeaders: Dhis2AnalyticsResult["headers"] = [
    { name: "dx", column: "Data", valueType: "TEXT", meta: true },
    { name: "pe", column: "Period", valueType: "TEXT", meta: true },
    { name: "ou", column: "Organisation unit", valueType: "TEXT", meta: true },
    { name: "value", column: "Value", valueType: "NUMBER", meta: false },
  ];

  return { rows: normalizedRows, headers: canonicalHeaders };
}

export interface AnalyticsResponse {
  headers: { name: string; column: string; valueType: string; meta: boolean }[];
  metaData?: {
    items: Record<string, { name: string }>;
    dimensions: Record<string, string[]>;
  };
  rows: string[][];
}

/**
 * Fetch a data-values matrix for the given data dimensions (indicators or
 * data elements) at the national root org unit, over a relative period.
 * (Original function — kept for backward compatibility)
 */
export async function fetchAnalytics(params: {
  dx: string[];
  period?: string;
  ou?: string;
}): Promise<AnalyticsResponse> {
  const config = await getDhis2Config();
  const { dx, period = "LAST_12_MONTHS", ou = config.rootOu } = params;
  const path =
    `/api/analytics.json?dimension=dx:${dx.join(";")}` +
    `&dimension=pe:${period}` +
    `&dimension=ou:${ou}` +
    `&displayProperty=NAME` +
    `&skipMeta=false`;

  return dhis2Get<AnalyticsResponse>(path);
}

/**
 * Advanced analytics query with full dimension support, caching, and children option.
 * Each data element is fetched in parallel (1 dx per request) to avoid DHIS2 server
 * timeouts when combining multiple indicators in a single query.
 */
export async function fetchAnalyticsAdvanced(params: {
  dx: string[];
  pe: string[];
  ou: string;
  children?: boolean;
  targetOrgUnitLevel?: number;
  /**
   * Interactive callers (a user waiting behind a spinner) want one fast
   * attempt and an honest error; background callers can afford retries and
   * the slow raw-data fallback. Defaults keep the background behaviour.
   */
  interactive?: boolean;
}): Promise<Dhis2AnalyticsResult> {
  const { dx, pe, ou, targetOrgUnitLevel, interactive = false } = params;
  const cacheKey = `analytics:${dx.join(";")}:${pe.join(";")}:${ou}:${targetOrgUnitLevel ?? "self"}`;

  const cached = getCached<Dhis2AnalyticsResult>(cacheKey);
  if (cached) return cached;

  const peParam = pe.length === 1 ? pe[0] : pe.join(";");
  // `X;LEVEL-n` returns the descendants only, so the unit's own series (KPI
  // cards, trend) is requested alongside.
  const ouParams = targetOrgUnitLevel ? [ou, `${ou};LEVEL-${targetOrgUnitLevel}`] : [ou];
  const retries = interactive ? 0 : 2;
  const timeoutMs = interactive ? 25_000 : 15_000;

  let firstError: unknown = null;
  const promises = dx.flatMap((singleDx) =>
    ouParams.map((ouParam) => {
      const path =
        `/api/analytics.json?dimension=dx:${singleDx}` +
        `&dimension=pe:${peParam}` +
        `&dimension=ou:${ouParam}` +
        `&displayProperty=NAME` +
        `&skipMeta=false` +
        `&skipRounding=true`;
      return dhis2Get<Dhis2AnalyticsResult>(path, retries, timeoutMs).catch((err: unknown) => {
        firstError ??= err;
        return null;
      });
    }),
  );

  const settled = await Promise.all(promises);
  const responses = settled.filter((r): r is Dhis2AnalyticsResult => r !== null);

  const first = responses[0];
  if (!first && interactive) {
    throw firstError instanceof Error ? firstError : new Error("DHIS2 analytics unavailable");
  }
  if (!first) {
    // Analytics API returned nothing — fall back to raw data values
    const rawResult = await fetchAnalyticsFromRaw({
      dx,
      pe,
      ou,
      children: params.children,
      targetOrgUnitLevel,
    });
    setCached(cacheKey, rawResult, CACHE_TTL_DATA);
    return rawResult;
  }

  // Normalize each response to the canonical [dx, pe, ou, value] shape based
  // on its own headers. DHIS2 may return extra columns (e.g. category option
  // combos) that would otherwise shift the value away from row[3] and surface
  // a data element UID where a number is expected.
  const normalized = responses.map((response) => {
    const { rows: normRows } = normalizeAnalyticsResult(response);
    return { response, normRows };
  });

  const rows = normalized.flatMap(({ normRows }) => normRows);

  // If analytics API returned 0 rows, fall back to raw data values
  if (rows.length === 0 && !interactive) {
    const rawResult = await fetchAnalyticsFromRaw({
      dx,
      pe,
      ou,
      children: params.children,
      targetOrgUnitLevel,
    });
    setCached(cacheKey, rawResult, CACHE_TTL_DATA);
    return rawResult;
  }

  const unique = (index: number) => [...new Set(rows.map((row) => row[index]).filter(Boolean))];
  const result: Dhis2AnalyticsResult = {
    headers: [
      { name: "dx", column: "Data", valueType: "TEXT", meta: true },
      { name: "pe", column: "Period", valueType: "TEXT", meta: true },
      { name: "ou", column: "Organisation unit", valueType: "TEXT", meta: true },
      { name: "value", column: "Value", valueType: "NUMBER", meta: false },
    ],
    metaData: {
      items: Object.assign({}, ...responses.map((response) => response.metaData?.items ?? {})),
      dimensions: {
        ...first.metaData?.dimensions,
        dx: unique(0),
        pe: unique(1),
        ou: unique(2),
      },
    },
    rows,
  };
  setCached(cacheKey, result, CACHE_TTL_DATA);
  return result;
}

// ─── Organisation Units ────────────────────────────────────

/**
 * Fetch org units at a given level, optionally filtered by parent.
 */
export async function fetchOrgUnits(params: {
  level?: number;
  parent?: string;
  search?: string;
  paging?: boolean;
}): Promise<{ organisationUnits: Dhis2OrgUnit[] }> {
  const { level, parent, search, paging = false } = params;
  const cacheKey = `orgUnits:${level ?? "all"}:${parent ?? "all"}:${search ?? "all"}:${paging}`;

  const cached = getCached<{ organisationUnits: Dhis2OrgUnit[] }>(cacheKey);
  if (cached) return cached;

  let path = "/api/organisationUnits.json?fields=id,name,level,shortName,code,parent[id]";
  if (level !== undefined) path += `&filter=level:eq:${level}`;
  if (parent) path += `&filter=path:like:${encodeURIComponent(parent)}`;
  if (search) path += `&filter=name:ilike:${encodeURIComponent(search)}`;
  path += `&paging=${paging}`;

  const result = await dhis2Get<{ organisationUnits: Dhis2OrgUnit[] }>(path);
  setCached(cacheKey, result, CACHE_TTL_METADATA);
  return result;
}

/**
 * Fetch a single org unit with its direct children.
 */
export async function fetchOrgUnitWithChildren(orgUnitId: string): Promise<Dhis2OrgUnit> {
  const cacheKey = `orgUnitChildren:${orgUnitId}`;

  const cached = getCached<Dhis2OrgUnit>(cacheKey);
  if (cached) return cached;

  const path = `/api/organisationUnits/${orgUnitId}.json?fields=id,name,level,shortName,code,parent[id],children[id,name,level,shortName]`;
  const result = await dhis2Get<Dhis2OrgUnit>(path);
  setCached(cacheKey, result, CACHE_TTL_METADATA);
  return result;
}

/**
 * Fetch all org unit levels.
 */
export async function fetchOrgUnitLevels(): Promise<{ organisationUnitLevels: Dhis2OrgUnitLevel[] }> {
  const cacheKey = "orgUnitLevels";

  const cached = getCached<{ organisationUnitLevels: Dhis2OrgUnitLevel[] }>(cacheKey);
  if (cached) return cached;

  const path = "/api/organisationUnitLevels.json?fields=id,name,level&paging=false";
  const result = await dhis2Get<{ organisationUnitLevels: Dhis2OrgUnitLevel[] }>(path);
  setCached(cacheKey, result, CACHE_TTL_METADATA);
  return result;
}

// ─── Data Sets ─────────────────────────────────────────────

/**
 * Fetch all data sets with their data elements.
 */
export async function fetchDataSets(): Promise<{ dataSets: Dhis2DataSet[] }> {
  const cacheKey = "dataSets";

  const cached = getCached<{ dataSets: Dhis2DataSet[] }>(cacheKey);
  if (cached) return cached;

  const path = "/api/dataSets.json?fields=id,name,displayName,periodType&paging=false";
  const result = await dhis2Get<{ dataSets: Dhis2DataSet[] }>(path);
  setCached(cacheKey, result, CACHE_TTL_METADATA);
  return result;
}

/**
 * Fetch a single data set with its data elements.
 */
export async function fetchDataSet(dataSetId: string): Promise<Dhis2DataSet> {
  const cacheKey = `dataSet:${dataSetId}`;

  const cached = getCached<Dhis2DataSet>(cacheKey);
  if (cached) return cached;

  const path = `/api/dataSets/${dataSetId}.json?fields=id,name,displayName,periodType,dataSetElements[dataElement[id,name,code,valueType]]`;
  const result = await dhis2Get<Dhis2DataSet>(path);
  setCached(cacheKey, result, CACHE_TTL_METADATA);
  return result;
}

// ─── Data Values (raw) ─────────────────────────────────────

/**
 * Fetch raw data values for a given data set, period, and org unit.
 */
export async function fetchDataValues(params: {
  dataSet: string;
  period: string;
  orgUnit: string;
  children?: boolean;
}): Promise<Dhis2DataValueSet> {
  const { dataSet, period, orgUnit, children = false } = params;
  const cacheKey = `dataValues:${dataSet}:${period}:${orgUnit}:${children}`;

  const cached = getCached<Dhis2DataValueSet>(cacheKey);
  if (cached) return cached;

  let path = `/api/dataValueSets.json?dataSet=${dataSet}&period=${period}&orgUnit=${orgUnit}`;
  if (children) path += `&children=true`;

  const result = await dhis2Get<Dhis2DataValueSet>(path);
  setCached(cacheKey, result, CACHE_TTL_DATA);
  return result;
}

// ─── System Info ───────────────────────────────────────────

/**
 * Fetch DHIS2 system information.
 */
export async function fetchSystemInfo(): Promise<Dhis2SystemInfo> {
  const cacheKey = "systemInfo";

  const cached = getCached<Dhis2SystemInfo>(cacheKey);
  if (cached) return cached;

  const path = "/api/system/info.json";
  const raw = await dhis2Get<Record<string, unknown>>(path);
  const result: Dhis2SystemInfo = {
    version: raw.version as string,
    systemName: raw.systemName as string,
    instanceBaseUrl: raw.instanceBaseUrl as string,
    serverDate: raw.serverDate as string,
    lastAnalyticsTableSuccess: raw.lastAnalyticsTableSuccess as string,
  };
  setCached(cacheKey, result, CACHE_TTL_METADATA);
  return result;
}

// ─── Period helpers ────────────────────────────────────────

/**
 * Convert a date range (yyyy-MM-dd) into an array of DHIS2 monthly periods (YYYYMM).
 */
export function dateRangeToPeriods(startDate: string, endDate: string): string[] {
  const periods: string[] = [];
  const [sy, sm] = startDate.split("-").map(Number);
  const [ey, em] = endDate.split("-").map(Number);

  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    periods.push(`${y}${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return periods;
}

/**
 * Map a period preset to the DHIS2 relative period keyword.
 */
export function presetToPeriod(preset: string): string {
  const map: Record<string, string> = {
    THIS_MONTH: "THIS_MONTH",
    LAST_MONTH: "LAST_MONTH",
    THIS_YEAR: "THIS_YEAR",
    LAST_YEAR: "LAST_YEAR",
    LAST_12_MONTHS: "LAST_12_MONTHS",
    LAST_6_MONTHS: "LAST_6_MONTHS",
    LAST_3_MONTHS: "LAST_3_MONTHS",
  };
  return map[preset] ?? "LAST_12_MONTHS";
}
