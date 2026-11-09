import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  }

  let body: { full_name?: unknown; organization?: unknown; country?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.full_name !== "string" || !body.full_name.trim()) {
    return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  }
  if (body.organization !== undefined && typeof body.organization !== "string") {
    return NextResponse.json({ error: "Invalid organization" }, { status: 400 });
  }
  if (body.country !== undefined && typeof body.country !== "string") {
    return NextResponse.json({ error: "Invalid country" }, { status: 400 });
  }

  const { data, error } = await createSupabaseAdminClient()
    .from("users")
    .update({
      full_name: body.full_name.trim(),
      organization: body.organization?.trim() || null,
      country: body.country?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.user.id)
    .select("id, email, full_name, role, organization, country, avatar_url, created_at, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}
