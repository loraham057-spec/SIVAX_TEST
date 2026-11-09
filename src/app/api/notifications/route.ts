/**
 * GET  /api/notifications      — Fetch all notifications for the current user
 * PATCH /api/notifications      — Mark notification(s) as read
 *         Query: ?id=<notificationId>  → mark single as read
 *         No query                          → mark all as read
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseRouteHandlerClient();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .or(`user_id.eq.${session.user.id},user_id.is.null`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notifications: data });
}

export async function PATCH(request: Request) {
  const supabase = await createSupabaseRouteHandlerClient();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const now = new Date().toISOString();

  if (id) {
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("id", id)
      .or(`user_id.eq.${session.user.id},user_id.is.null`);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: "ok", id, message: "Notification marked as read" });
  }

  // Mark all as read
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: now })
    .is("read_at", null)
    .or(`user_id.eq.${session.user.id},user_id.is.null`);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok", message: "All notifications marked as read" });
}
