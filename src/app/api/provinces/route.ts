/**
 * GET /api/provinces
 *
 * Returns per-province vaccination data from Supabase (v_province_latest_values).
 * Used by the dashboard for ranking, equity analysis, and risk scoring.
 *
 * Query params:
 *   ?indicator=v9b9aYsA5PM  — filter to a specific indicator
 *   ?domain=vaccination     — filter by domain
 *
 * Returns: [{ indicator_id, label, unit, domain, org_unit_id, org_unit_name,
 *             latest_period, latest_value }]
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError } from "../_lib/proxy";

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  const url = new URL(request.url);
  const indicator = url.searchParams.get("indicator");
  const domain = url.searchParams.get("domain");

  let query = supabase
    .from("v_province_latest_values")
    .select("*")
    .order("org_unit_name", { ascending: true });

  if (indicator) {
    query = query.eq("indicator_id", indicator);
  }
  if (domain) {
    query = query.eq("domain", domain);
  }

  const { data, error } = await query;

  if (error) {
    return apiError(error.message, 500);
  }

  return Response.json(data ?? []);
}
