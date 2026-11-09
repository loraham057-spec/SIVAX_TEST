import { NextRequest, NextResponse } from "next/server";
import { fetchOrgUnits, fetchOrgUnitLevels, isDhis2Configured } from "@/lib/dhis2";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/dhis2/org-units
 *
 * Returns org units filtered by level and/or parent.
 *
 * Strategy (Supabase-first for speed):
 *   1. Query dim_org_units in Supabase — instant (~50ms).
 *   2. If Supabase returns no results (e.g. level 5 FOSAs not yet synced by
 *      the ETL), fall back to the live DHIS2 API.
 *
 * Query params:
 *   level   — org unit level (1=national, 2=province, 3=zone, 4=aire, 5=FOSA)
 *   parent  — parent org unit ID (filters via parent_id in Supabase or
 *             path:like in DHIS2)
 *   search  — name search (ilike)
 *   levels  — if "true", returns org unit levels instead of org units
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const level = searchParams.get("level");
  const parent = searchParams.get("parent");
  const search = searchParams.get("search");
  const levelsOnly = searchParams.get("levels") === "true";

  if (levelsOnly) {
    if (!(await isDhis2Configured())) {
      return NextResponse.json(
        { error: "DHIS2 non configuré" },
        { status: 503 },
      );
    }
    try {
      const result = await fetchOrgUnitLevels();
      return NextResponse.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // ─── 1. Try Supabase first (instant) ─────────────────────
  try {
    const supabase = createSupabaseAdminClient();
    let query = supabase
      .from("dim_org_units")
      .select("id,name,level,parent_id");

    if (level) {
      query = query.eq("level", Number(level));
    }
    if (parent) {
      query = query.eq("parent_id", parent);
    }
    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const { data: sbOus, error } = await query.limit(5000);

    if (!error && sbOus && sbOus.length > 0) {
      // Map Supabase rows to the DHIS2 org unit shape expected by the client.
      const organisationUnits = sbOus.map((ou) => ({
        id: ou.id,
        name: ou.name,
        level: ou.level,
        shortName: null,
        code: null,
        parent: ou.parent_id ? { id: ou.parent_id } : null,
      }));
      return NextResponse.json({ organisationUnits });
    }
    // If no error but no rows, fall through to DHIS2.
  } catch {
    // Supabase not configured or table missing — fall through to DHIS2.
  }

  // ─── 2. Fall back to live DHIS2 ──────────────────────────
  if (!(await isDhis2Configured())) {
    return NextResponse.json(
      { error: "DHIS2 non configuré" },
      { status: 503 },
    );
  }

  try {
    const result = await fetchOrgUnits({
      level: level ? Number(level) : undefined,
      parent: parent ?? undefined,
      search: search ?? undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur DHIS2 inconnue";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
