import { NextResponse } from "next/server";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendNotificationEmail, sendBulkNotificationEmails } from "@/lib/email/send";
import { ROLE_PERMISSIONS } from "@/lib/auth/types";
import { APP_URL } from "@/lib/constants";

// ─── In-memory cache for auth user sign-in data ───────────────
// The Supabase admin API listUsers() is slow (800ms–16s). We cache the
// sign-in map for 2 minutes so paginated requests don't re-fetch all
// auth users on every page navigation.
let signInCache: { map: Map<string, string | null>; timestamp: number } | null = null;
const SIGN_IN_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

async function getSignInMap(): Promise<Map<string, string | null>> {
  // Return cached map if still fresh
  if (signInCache && Date.now() - signInCache.timestamp < SIGN_IN_CACHE_TTL) {
    return signInCache.map;
  }

  const adminClient = createSupabaseAdminClient();
  const map = new Map<string, string | null>();
  let page = 1;
  const perPage = 1000;
  const maxPages = 100;

  while (page <= maxPages) {
    const { data: authPage, error: authError } = await adminClient.auth.admin.listUsers({
      page,
      perPage,
    });
    if (authError || !authPage?.users || authPage.users.length === 0) break;
    for (const au of authPage.users) {
      map.set(au.id, au.last_sign_in_at ?? null);
    }
    if (authPage.users.length < perPage || !authPage.nextPage) break;
    page = authPage.nextPage;
  }

  signInCache = { map, timestamp: Date.now() };
  return map;
}

export async function GET(request: Request) {
  const supabase = await createSupabaseRouteHandlerClient();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.user.id)
    .single();

  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ─── Pagination parameters ───────────────────────────────
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "10", 10)));
  const search = (searchParams.get("search") || "").trim();

  // Build query with optional search filter
  let query = supabase
    .from("users")
    .select("id, email, full_name, role, organization, created_at, updated_at", { count: "exact" });

  if (search) {
    const escaped = search.replace(/[%_]/g, (m) => "\\" + m);
    query = query.or(
      `full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,organization.ilike.%${escaped}%`
    );
  }

  // Sort alphabetically and apply pagination range
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  query = query
    .order("full_name", { ascending: true })
    .range(from, to);

  const { data: users, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch sign-in data from cache (or refresh if stale)
  const signInMap = await getSignInMap();

  const usersWithSignIn = (users ?? []).map((u) => ({
    ...u,
    last_sign_in_at: signInMap.get(u.id) ?? null,
  }));

  const total = count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return NextResponse.json({
    users: usersWithSignIn,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseRouteHandlerClient();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentUser } = await supabase
    .from("users")
    .select("role, full_name")
    .eq("id", session.user.id)
    .single();

  if (currentUser?.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { email, password, full_name, role, organization, timezone } = body;

  if (!email || !password || !role) {
    return NextResponse.json(
      { error: "Missing required fields: email, password, role" },
      { status: 400 }
    );
  }

  const { data: authData, error: authError } = await createSupabaseAdminClient().auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name, role, organization },
    email_confirm: true,
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  if (authData.user) {
    const adminClient = createSupabaseAdminClient();
    const { error: profileError } = await adminClient
      .from("users")
      .update({ role, organization, full_name })
      .eq("id", authData.user.id);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    const roleLabel = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]?.label ?? role;
    const adminName = currentUser?.full_name || session.user.email || "Unknown Admin";
    const tz = timezone || "UTC";
    const timestamp = new Date().toLocaleString("en-US", { timeZone: tz, dateStyle: "full", timeStyle: "short" }) + ` (${tz})`;

    // 1. Send welcome email to the new user with BCC to fidelensadi@sivax.health
    await sendNotificationEmail({
      to: email,
      bcc: "fidelensadi@sivax.health",
      subject: `Welcome to SIVAX — You have been added as ${roleLabel}`,
      title: "Welcome to SIVAX",
      body: `You have been added to the SIVAX platform as <strong>${roleLabel}</strong>. Below are your login credentials to access the platform:<br/><br/><strong>Email:</strong> ${email}<br/><strong>Password:</strong> ${password}<br/><br/>Please log in and change your password as soon as possible for security reasons.`,
      recipientName: full_name || undefined,
      actionUrl: APP_URL,
      actionLabel: "Access SIVAX",
    });

    // 2. Notify all admin users about the new user
    const { data: adminUsers } = await adminClient
      .from("users")
      .select("email, full_name")
      .eq("role", "admin");

    if (adminUsers && adminUsers.length > 0) {
      await sendBulkNotificationEmails({
        recipients: adminUsers.map((u) => ({ email: u.email, name: u.full_name || undefined })),
        subject: "New User Added to SIVAX",
        title: "New User Added",
        body: `A new user has been added to the SIVAX platform.<br/><br/><strong>Name:</strong> ${full_name || "N/A"}<br/><strong>Email:</strong> ${email}<br/><strong>Role:</strong> ${roleLabel}<br/><strong>Organization:</strong> ${organization || "N/A"}<br/><strong>Created by:</strong> ${adminName}<br/><strong>Added on:</strong> ${timestamp}`,
      });
    }
  }

  return NextResponse.json({ user: authData.user }, { status: 201 });
}
