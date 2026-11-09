/**
 * GET /api/users/resolve?email=<address>
 *
 * Resolves a single user id from an e-mail address.
 *
 * The agent's `update_user_role` and `delete_user` commands used to fetch the
 * whole user list and scan it client-side — which meant `GET /api/users`, i.e.
 * a full table read plus a `listUsers({ perPage: 1000 })` admin call, just to
 * find one id. `public.users.email` is indexed (`idx_users_email`), so this is
 * one indexed lookup returning one row (PERF-19).
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createSupabaseRouteHandlerClient();

  const { data: { user: sessionUser } } = await supabase.auth.getUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", sessionUser.id)
    .single();

  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Le paramètre email est requis" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role")
    .ilike("email", email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: `Utilisateur introuvable: ${email}` }, { status: 404 });
  }

  return NextResponse.json({ user: data });
}
