/**
 * POST /api/dhis2/page-data
 *
 * One request per analytics page: every indicator of the page, the selected
 * org unit itself and its direct children, over the requested period preset,
 * read from the ETL snapshot in Supabase.
 *
 * Body: { indicatorIds: string[], orgUnitId: string, orgUnitLevel: number,
 *         periodPreset: Dhis2PeriodPreset, customPeriodStart?, customPeriodEnd?,
 *         childLevel? }  — `childLevel` (deeper than the direct children, e.g.
 *         the zones of the whole country) overrides orgUnitLevel + 1.
 *
 * 200 { found: true, source, syncedAt, latestPeriod, parentOrgUnitId, parents?, analytics }
 * 200 { found: false }  — nothing synced for this scope; the client decides
 *                         whether to query DHIS2 live.
 */

import { NextRequest, NextResponse } from "next/server";
import { expandPeriods } from "@/lib/dhis2-analytics";
import { dateRangeToPeriods } from "@/lib/dhis2";
import { ETL_SOURCE_LABEL, fetchLastSync, queryEtlAnalytics } from "@/lib/etl-analytics";
import type { Dhis2PeriodPreset } from "@/types";

export const dynamic = "force-dynamic";

const MAX_INDICATORS = 60;
/** FOSA (level 5) have no children. */
const MAX_CHILD_LEVEL = 5;

interface Body {
  indicatorIds: string[];
  orgUnitId: string;
  orgUnitLevel: number;
  periodPreset: Dhis2PeriodPreset;
  customPeriodStart?: string;
  customPeriodEnd?: string;
  childLevel?: number;
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const indicatorIds = Array.isArray(body.indicatorIds) ? body.indicatorIds.slice(0, MAX_INDICATORS) : [];
  if (indicatorIds.length === 0 || !body.orgUnitId || !body.periodPreset) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const periods =
    body.periodPreset === "CUSTOM"
      ? body.customPeriodStart && body.customPeriodEnd
        ? dateRangeToPeriods(body.customPeriodStart, body.customPeriodEnd)
        : []
      : expandPeriods([body.periodPreset]);
  if (periods.length === 0) {
    return NextResponse.json({ error: "No valid periods" }, { status: 400 });
  }

  const level = Number(body.orgUnitLevel) || 1;
  const requested = Number(body.childLevel);
  const childLevel = Number.isInteger(requested) && requested > level && requested <= MAX_CHILD_LEVEL
    ? requested
    : level < MAX_CHILD_LEVEL ? level + 1 : undefined;

  try {
    const [etl, syncedAt] = await Promise.all([
      queryEtlAnalytics({ indicatorIds, periods, orgUnitId: body.orgUnitId, childLevel }),
      fetchLastSync().catch(() => null),
    ]);
    if (!etl) return NextResponse.json({ found: false });
    return NextResponse.json({ found: true, source: ETL_SOURCE_LABEL, syncedAt, ...etl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
