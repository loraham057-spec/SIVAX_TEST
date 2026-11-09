import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-user";
import { getSettings, isSettingKey, SETTING_DEFINITIONS, type SettingKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) {
    return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  }

  let body: { keys?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const requested = Array.isArray(body.keys) ? body.keys : [];
  const secretKeys = requested.filter(isSettingKey).filter((key) => SETTING_DEFINITIONS[key].secret) as SettingKey[];

  if (secretKeys.length === 0) {
    return NextResponse.json({ values: {} });
  }

  try {
    const values = await getSettings(secretKeys);
    return NextResponse.json({ values });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reveal settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
