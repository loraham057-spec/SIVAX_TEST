/**
 * GET /api/org-units
 *
 * Returns the org unit hierarchy from Supabase (dim_org_units).
 * Supports dependent filtering for cascading dropdowns:
 *   Province → Zone de santé → Aire de santé
 *
 * Query params:
 *   ?level=2              — filter by level (1=national, 2=province, 3=zone, 4=aire)
 *   ?parent=<ou_id>       — filter by parent org unit (for dependent dropdowns)
 *   ?province=<ou_id>     — filter by province_id (denormalized)
 *   ?zone=<ou_id>         — filter by zone_id (denormalized)
 *   ?include_counts=true  — include count of child org units
 *
 * Returns: [{ id, name, level, parent_id, province_id, zone_id, path }]
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError } from "../_lib/proxy";

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  const url = new URL(request.url);

  const level = url.searchParams.get("level");
  const parent = url.searchParams.get("parent");
  const province = url.searchParams.get("province");
  const zone = url.searchParams.get("zone");
  const includeCounts = url.searchParams.get("include_counts") === "true";

  let query = supabase
    .from("dim_org_units")
    .select("id, name, level, parent_id, province_id, zone_id, path")
    .order("name", { ascending: true });

  if (level) {
    query = query.eq("level", parseInt(level));
  }
  if (parent) {
    query = query.eq("parent_id", parent);
  }
  if (province) {
    query = query.eq("province_id", province);
  }
  if (zone) {
    query = query.eq("zone_id", zone);
  }

  const { data, error } = await query;

  if (error) {
    return apiError(error.message, 500);
  }

  // Optionally include child counts for each org unit
  if (includeCounts && data && data.length > 0) {
    const ouIds = data.map((d) => d.id);
    const { data: childCounts } = await supabase
      .from("dim_org_units")
      .select("parent_id")
      .in("parent_id", ouIds);

    if (childCounts) {
      const countMap: Record<string, number> = {};
      for (const row of childCounts) {
        countMap[row.parent_id] = (countMap[row.parent_id] || 0) + 1;
      }
      data.forEach((d) => {
        (d as Record<string, unknown>).child_count = countMap[d.id] || 0;
      });
    }
  }

  return Response.json(data ?? []);
}
