/**
 * POST /api/dhis2/supabase-query
 *
 * Single-indicator read of the ETL snapshot, kept for the explorer and the
 * assistant. Pages use /api/dhis2/page-data (multi-indicator) instead.
 *
 * Body: { indicatorId, periods: string[], orgUnitId, targetLevel? }
 * `targetLevel` selects the descendants of `orgUnitId` at that level — not
 * every unit of the country at that level, which the previous implementation
 * returned.
 */

import { NextRequest, NextResponse } from "next/server";
import { expandPeriods } from "@/lib/dhis2-analytics";
import { ETL_SOURCE_LABEL, queryEtlAnalytics } from "@/lib/etl-analytics";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { indicatorId: string; periods: string[]; orgUnitId: string; targetLevel?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.indicatorId || !body.periods?.length || !body.orgUnitId) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  const periods = expandPeriods(body.periods);
  if (periods.length === 0) {
    return NextResponse.json({ error: "No valid periods" }, { status: 400 });
  }

  try {
    const etl = await queryEtlAnalytics({
      indicatorIds: [body.indicatorId],
      periods,
      orgUnitId: body.orgUnitId,
      childLevel: body.targetLevel || undefined,
    });
    if (!etl) return NextResponse.json({ found: false }, { status: 404 });
    return NextResponse.json({ found: true, source: ETL_SOURCE_LABEL, ...etl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
