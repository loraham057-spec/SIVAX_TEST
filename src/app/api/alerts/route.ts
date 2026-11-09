/**
 * GET  /api/alerts      — Fetch data-driven alerts, newest first
 *         Query: ?limit=<1..200>   → page size (default 100)
 *                ?before=<ISO date> → keyset pagination cursor
 *                ?unread=1          → only unread alerts
 * PATCH /api/alerts      — Mark alert(s) as read
 *         Query: ?id=<alertId>  → mark single as read
 *         No query              → mark all as read
 *
 * Alerts are computed from real DHIS2 data when available:
 *   - Provinces with Penta3 coverage below 80% (WHO threshold)
 *   - Provinces with Penta1-Penta3 dropout above 10%
 * Falls back to the static alerts table if no ETL data is available yet.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError } from "../_lib/proxy";
import type { AlertItem } from "@/types";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/** Only the columns the client actually maps — `select("*")` also dragged the
 *  `metadata` JSONB blob and `user_id` over the wire for every row. */
const ALERT_COLUMNS =
  "id, title, message, type, severity, read, source, region, deadline, action_url, created_at";

/** Forme d'une ligne telle que ALERT_COLUMNS la sélectionne. */
type AlertRow = {
  id: string;
  title: string;
  message: string;
  type: AlertItem["type"];
  severity: AlertItem["severity"];
  read: boolean;
  source: string;
  region: string | null;
  deadline: string | null;
  action_url: string | null;
  created_at: string;
};

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  const params = new URL(request.url).searchParams;

  const requestedLimit = Number(params.get("limit"));
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  let query = supabase
    .from("alerts")
    .select(ALERT_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  const before = params.get("before");
  if (before && !Number.isNaN(Date.parse(before))) {
    query = query.lt("created_at", before);
  }
  if (params.get("unread") === "1") {
    query = query.eq("read", false);
  }

  const { data, error } = await query;

  if (error) {
    return apiError(error.message, 500);
  }

  const alerts: AlertItem[] = (data ?? []).map((row: AlertRow) => ({
    id: row.id,
    title: row.title,
    message: row.message,
    timestamp: new Date(row.created_at).toLocaleString(),
    createdAt: row.created_at,
    type: row.type,
    severity: row.severity,
    read: row.read,
    source: row.source,
    region: row.region ?? undefined,
    deadline: row.deadline ?? undefined,
    actionUrl: row.action_url ?? undefined,
  }));

  return Response.json(alerts);
}

export async function PATCH(request: Request) {
  const supabase = createSupabaseAdminClient();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    // Don't try to update computed alerts (they have fixed IDs)
    if (id.startsWith("computed-")) {
      return Response.json({ status: "ok", id, message: "Computed alert dismissed" });
    }
    const { error } = await supabase
      .from("alerts")
      .update({ read: true })
      .eq("id", id);

    if (error) return apiError(error.message, 500);
    return Response.json({ status: "ok", id, message: "Alert marked as read" });
  }

  const { error } = await supabase
    .from("alerts")
    .update({ read: true })
    .eq("read", false);

  if (error) return apiError(error.message, 500);
  return Response.json({ status: "ok", message: "All alerts marked as read" });
}
