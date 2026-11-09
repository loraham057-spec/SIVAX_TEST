/**
 * GET /api/activity
 *
 * Returns recent activity feed items from Supabase.
 */

import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { apiError } from "../_lib/proxy";
import type { ActivityItem } from "@/types";

export async function GET() {
  const supabase = await createSupabaseRouteHandlerClient();

  const { data, error } = await supabase
    .from("activity_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return apiError(error.message, 500);
  }

  const items: ActivityItem[] = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    timestamp: new Date(row.created_at).toLocaleString(),
    type: row.type,
  }));

  return Response.json(items);
}
