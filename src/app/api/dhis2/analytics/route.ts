/**
 * GET /api/dhis2/analytics
 *
 * Returns statistic cards for the Analytic Dashboard.
 *
 * Strategy:
 *   1. Read from Supabase (fact_indicator_values) — instant, ~50ms.
 *   2. If no snapshot data exists, fall back to live DHIS2 API.
 *
 * The ETL pipeline (FastAPI backend) syncs DHIS2 → Supabase daily at 03:00 UTC.
 * See backend/app/etl/ for the pipeline code.
 */

import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { fetchAnalyticsAdvanced, isDhis2Configured, presetToPeriod, dateRangeToPeriods } from "@/lib/dhis2";
import { expandPeriods } from "@/lib/dhis2-analytics";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Dhis2StatCard, Dhis2SeriesPoint, Dhis2FilterState } from "@/types";

const ROLLING_PRESETS = new Set(["LAST_COMPLETE_MONTH", "LAST_3_MONTHS", "LAST_6_MONTHS", "LAST_12_MONTHS"]);

// This file exposes both a cacheable GET (national KPI snapshot) and a POST
// (ad-hoc filtered query). A route-segment `revalidate` cannot express that, so
// caching is declared per-response through Cache-Control headers instead —
// which is also what Azure Front Door honours at the edge.
export const dynamic = "force-dynamic";

/** 1h fresh, then serve stale for a day while revalidating in the background. */
const GET_CACHE_CONTROL = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

/** How much history the KPI cards and the 6-point trend actually need. */
const TREND_MONTHS = 24;

/**
 * Curated national indicators (SNIS RDC) that carry meaningful values.
 * `unit` controls formatting; `iconKey` maps to a Lucide icon on the client.
 */
const INDICATORS: {
  id: string;
  label: string;
  unit: "count" | "percent";
  iconKey: string;
}[] = [
  { id: "rOt4BctnRqS", label: "Cas de paludisme (présumés et confirmés)", unit: "count", iconKey: "activity" },
  { id: "l5Gjya9Udz7", label: "Paludisme confirmé traité", unit: "count", iconKey: "syringe" },
  { id: "rPYLomUceL4", label: "Paludisme confirmé (microscopie/TDR)", unit: "count", iconKey: "package" },
  { id: "eVbOZqoI7JP", label: "Accouchements assistés par personnel qualifié", unit: "percent", iconKey: "users" },
];

const ROOT_OU = process.env.DHIS2_ROOT_OU ?? "ymGeqzoPhN3";

function formatValue(value: number, unit: "count" | "percent"): string {
  if (unit === "percent") return `${Math.round(value)}%`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("fr-FR");
}

/**
 * Returns YYYYMM period ids for the current and previous calendar months.
 * DHIS2 monthly data is typically incomplete during the current month and
 * the first weeks of the following month, so we exclude both.
 */
function incompletePeriods(): string[] {
  const now = new Date();
  const cur = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = `${prevDate.getFullYear()}${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  return [cur, prev];
}

/**
 * Build stat cards + series from a { indicatorId -> { period -> value } } map.
 */
function buildCardsAndSeries(
  seriesMap: Record<string, Record<string, number>>,
  source: string,
): { cards: Dhis2StatCard[]; series: Dhis2SeriesPoint[] } {
  const exclude = incompletePeriods();

  const cards: Dhis2StatCard[] = INDICATORS.map((ind) => {
    const byPeriod = seriesMap[ind.id] ?? {};
    const periods = Object.keys(byPeriod)
      .filter((p) => !exclude.includes(p))
      .sort();

    const currentPe = periods[periods.length - 1];
    const previousPe = periods[periods.length - 2];
    const current = currentPe ? byPeriod[currentPe] : 0;
    const previous = previousPe ? byPeriod[previousPe] : undefined;

    let delta: number | null = null;
    if (previous !== undefined && previous !== 0) {
      delta = ((current - previous) / previous) * 100;
    }

    return {
      id: ind.id,
      label: ind.label,
      value: formatValue(current, ind.unit),
      rawValue: current,
      unit: ind.unit,
      iconKey: ind.iconKey,
      delta: delta === null ? null : Number(delta.toFixed(1)),
      period: currentPe ?? null,
    };
  });

  // Build trend series from the first indicator (paludisme) for the chart
  const firstInd = INDICATORS[0];
  const byPeriod = seriesMap[firstInd.id] ?? {};
  const periods = Object.keys(byPeriod)
    .filter((p) => !exclude.includes(p))
    .sort()
    .slice(-6);

  const series: Dhis2SeriesPoint[] = periods.map((pe) => ({
    period: pe,
    value: byPeriod[pe],
  }));

  return { cards, series };
}

/**
 * Try reading from Supabase (fact_indicator_values).
 * Returns null if no data or Supabase not configured.
 */
/** Oldest YYYYMM period worth reading for the dashboard. */
function earliestPeriod(months: number): string {
  const from = new Date();
  from.setMonth(from.getMonth() - months);
  return `${from.getFullYear()}${String(from.getMonth() + 1).padStart(2, "0")}`;
}

async function readFromSupabase(): Promise<{
  cards: Dhis2StatCard[];
  series: Dhis2SeriesPoint[];
} | null> {
  try {
    const supabase = createSupabaseAdminClient();

    // Bounded to the indicators and the window the page renders: the previous
    // query pulled every period ever synced and every indicator, then threw
    // most of it away in JS.
    const { data, error } = await supabase
      .from("fact_indicator_values")
      .select("indicator_id, period, value")
      .eq("source", "dhis2")
      .eq("org_unit_id", ROOT_OU)
      .in("indicator_id", INDICATORS.map((i) => i.id))
      .gte("period", earliestPeriod(TREND_MONTHS))
      .order("period", { ascending: true });

    if (error || !data || data.length === 0) return null;

    // Build series map
    const seriesMap: Record<string, Record<string, number>> = {};
    for (const row of data) {
      (seriesMap[row.indicator_id] ??= {})[row.period] = Number(row.value);
    }

    const result = buildCardsAndSeries(seriesMap, "Supabase (ETL sync)");
    if (result.cards.every((c) => c.rawValue === 0)) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * Fallback: fetch live from DHIS2 API.
 */
async function readFromDhis2(): Promise<{
  cards: Dhis2StatCard[];
  series: Dhis2SeriesPoint[];
}> {
  const analytics = await fetchAnalyticsAdvanced({
    dx: INDICATORS.map((i) => i.id),
    pe: ["LAST_12_MONTHS"],
    ou: ROOT_OU,
  });

  const seriesMap: Record<string, Record<string, number>> = {};
  for (const row of analytics.rows ?? []) {
    const dx = row[0];
    const pe = row[1];
    const rawValue = row[3];
    const num = Number(rawValue);
    if (dx && pe && !Number.isNaN(num)) {
      (seriesMap[dx] ??= {})[pe] = num;
    }
  }

  return buildCardsAndSeries(seriesMap, "DHIS2 — SNIS RDC (live)");
}

export async function GET() {
  // ─── 1. Try Supabase first (instant) ────────────────────
  const supabaseResult = await readFromSupabase();
  if (supabaseResult) {
    return NextResponse.json(
      {
        source: "Supabase (ETL sync)",
        cards: supabaseResult.cards,
        series: supabaseResult.series,
      },
      { headers: { "Cache-Control": GET_CACHE_CONTROL } },
    );
  }

  // ─── 2. Fallback to live DHIS2 ──────────────────────────
  if (!(await isDhis2Configured())) {
    return NextResponse.json(
      { error: "Aucune donnée en cache (Supabase vide) et DHIS2 non configuré. Lancez une sync ETL ou configurez DHIS2." },
      { status: 503 }
    );
  }

  try {
    const result = await readFromDhis2();
    return NextResponse.json(
      {
        source: "DHIS2 — SNIS RDC (live)",
        cards: result.cards,
        series: result.series,
      },
      { headers: { "Cache-Control": GET_CACHE_CONTROL } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/**
 * POST /api/dhis2/analytics
 *
 * Real-time filtered analytics query.
 * Body: Dhis2FilterState (orgUnitId, periodPreset, dataElements, etc.)
 * Returns: Dhis2AnalyticsResult (raw DHIS2 analytics response with metaData + rows)
 */
export async function POST(req: NextRequest) {
  if (!(await isDhis2Configured())) {
    return NextResponse.json(
      { error: "DHIS2 non configuré" },
      { status: 503 },
    );
  }

  let body: Dhis2FilterState;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body JSON invalide" },
      { status: 400 },
    );
  }

  const { orgUnitId, periodPreset, customPeriodStart, customPeriodEnd, dataElements, antigeId } = body;

  if (!orgUnitId || !periodPreset) {
    return NextResponse.json(
      { error: "Champs requis: orgUnitId, periodPreset" },
      { status: 400 },
    );
  }

  // Priorité: dataElements (dataset) > antigeId (sélecteur antigène) > indicateurs hardcoded
  const dx = dataElements && dataElements.length > 0
    ? dataElements.slice(0, 20)
    : antigeId
      ? [antigeId]
      : INDICATORS.map((i) => i.id);

  let pe: string[];

  if (periodPreset === "CUSTOM") {
    if (!customPeriodStart || !customPeriodEnd) {
      return NextResponse.json(
        { error: "Période personnalisée requiert customPeriodStart et customPeriodEnd" },
        { status: 400 },
      );
    }
    pe = dateRangeToPeriods(customPeriodStart, customPeriodEnd);
  } else if (periodPreset === "YEAR_OVER_YEAR") {
    const now = new Date();
    const thisYear = now.getFullYear();
    const lastYear = thisYear - 1;
    pe = [
      `${thisYear}01`, `${thisYear}02`, `${thisYear}03`, `${thisYear}04`,
      `${thisYear}05`, `${thisYear}06`, `${thisYear}07`, `${thisYear}08`,
      `${thisYear}09`, `${thisYear}10`, `${thisYear}11`, `${thisYear}12`,
      `${lastYear}01`, `${lastYear}02`, `${lastYear}03`, `${lastYear}04`,
      `${lastYear}05`, `${lastYear}06`, `${lastYear}07`, `${lastYear}08`,
      `${lastYear}09`, `${lastYear}10`, `${lastYear}11`, `${lastYear}12`,
    ];
  } else if (ROLLING_PRESETS.has(periodPreset)) {
    // Same window as the ETL snapshot: ends at the last complete month.
    pe = expandPeriods([periodPreset]);
  } else {
    pe = [presetToPeriod(periodPreset)];
  }

  try {
    const result = await fetchAnalyticsAdvanced({
      dx,
      pe,
      ou: orgUnitId,
      children: body.orgUnitLevel < 5,
      targetOrgUnitLevel: body.targetOrgUnitLevel,
      interactive: true,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
    const isTimeout = message.includes("timeout") || message.includes("abort") || message.includes("Timeout");
    return NextResponse.json(
      { error: isTimeout ? "Le serveur DHIS2 met trop de temps à répondre (timeout). Réessayez avec moins de données ou une période plus courte." : message },
      { status: 502 },
    );
  }
}
