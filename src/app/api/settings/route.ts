import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-user";
import {
  getMaskedSettings,
  getSettings,
  isSettingKey,
  saveSettings,
  SETTING_DEFINITIONS,
  type SettingKey,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) {
    return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  }

  try {
    const settings = await getMaskedSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) {
    return NextResponse.json({ error: auth.error.message }, { status: auth.error.status });
  }

  let body: { settings?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<Record<SettingKey, string>> = {};
  for (const [key, value] of Object.entries(body.settings ?? {})) {
    if (!isSettingKey(key) || typeof value !== "string") continue;
    if (SETTING_DEFINITIONS[key].secret && (!value || value === "••••••••")) continue;
    updates[key] = value;
  }

  try {
    // Persisting an unchanged value would freeze the current env fallback in
    // the database, so later changes to the deployment secrets would be ignored.
    const current = await getSettings(Object.keys(updates) as SettingKey[]);
    for (const key of Object.keys(updates) as SettingKey[]) {
      if (updates[key]?.trim() === current[key]) delete updates[key];
    }
    const updated = await saveSettings(updates, auth.user.id);
    return NextResponse.json({ success: true, updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
