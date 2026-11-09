import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (auth.error) {
    return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  }

  const settings = await getSettings([
    "security_session_timeout",
    "security_session_timeout_minutes",
    "security_audit_log",
  ]);

  return NextResponse.json({
    sessionTimeout: settings.security_session_timeout === "true",
    sessionTimeoutMinutes: Number(settings.security_session_timeout_minutes) || 30,
    auditLog: settings.security_audit_log === "true",
  });
}
