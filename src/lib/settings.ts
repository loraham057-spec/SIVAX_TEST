import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export const SETTING_DEFINITIONS = {
  powerbi_tenant_id: { env: "POWERBI_TENANT_ID", secret: false, group: "powerbi" },
  powerbi_client_id: { env: "POWERBI_CLIENT_ID", secret: false, group: "powerbi" },
  powerbi_client_secret: { env: "POWERBI_CLIENT_SECRET", secret: true, group: "powerbi" },
  powerbi_workspace_id: { env: "POWERBI_WORKSPACE_ID", secret: false, group: "powerbi" },
  powerbi_report_id: { env: "POWERBI_REPORT_ID", secret: false, group: "powerbi" },
  powerbi_dataset_id: { env: "POWERBI_DATASET_ID", secret: false, group: "powerbi" },
  openai_api_key: { env: "OPENAI_API_KEY", secret: true, group: "integrations" },
  openai_model: { env: "OPENAI_MODEL", secret: false, group: "integrations" },
  anthropic_api_key: { env: "ANTHROPIC_API_KEY", secret: true, group: "integrations" },
  anthropic_model: { env: "ANTHROPIC_MODEL", secret: false, group: "integrations" },
  fastapi_url: { env: "FASTAPI_URL", secret: false, group: "integrations" },
  resend_api_key: { env: "RESEND_API_KEY", secret: true, group: "integrations" },
  elevenlabs_api_key: { env: "ELEVENLABS_API_KEY", secret: true, group: "integrations" },
  dhis2_base_url: { env: "DHIS2_BASE_URL", secret: false, group: "dhis2" },
  dhis2_username: { env: "DHIS2_USERNAME", secret: false, group: "dhis2" },
  dhis2_password: { env: "DHIS2_PASSWORD", secret: true, group: "dhis2" },
  dhis2_root_ou: { env: "DHIS2_ROOT_OU", secret: false, group: "dhis2" },
  security_two_factor: { env: "", secret: false, group: "security", defaultValue: "false" },
  security_session_timeout: { env: "", secret: false, group: "security", defaultValue: "true" },
  security_session_timeout_minutes: { env: "", secret: false, group: "security", defaultValue: "30" },
  security_audit_log: { env: "", secret: false, group: "security", defaultValue: "true" },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;

interface CachedSetting {
  value: string;
  expiresAt: number;
}

const cache = new Map<SettingKey, CachedSetting>();
const CACHE_TTL = 30_000;

function encryptionKey(): Buffer {
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!source) {
    throw new Error("APP_SETTINGS_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return createHash("sha256").update(source).digest();
}

function encrypt(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

function decrypt(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || dataPart === undefined) {
    throw new Error("Invalid encrypted setting payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function fallbackValue(key: SettingKey): string {
  const definition = SETTING_DEFINITIONS[key];
  const envValue = definition.env ? process.env[definition.env] : undefined;
  return envValue ?? ("defaultValue" in definition ? definition.defaultValue : "") ?? "";
}

/**
 * In-flight refresh, shared by every concurrent reader. Without it, a burst of
 * requests arriving on a cold cache each fires its own query.
 */
let pendingRefresh: Promise<void> | null = null;

/**
 * Loads the whole `app_settings` table in ONE query and primes the cache for
 * every key. The table holds ~20 rows, so fetching all of them costs the same
 * as fetching one — while the previous per-key lookup meant up to 22 round
 * trips to build a single settings payload.
 */
async function refreshCache(): Promise<void> {
  if (pendingRefresh) return pendingRefresh;

  pendingRefresh = (async () => {
    const stored = new Map<string, string>();
    const startedAt = Date.now();
    try {
      const { data, error } = await createSupabaseAdminClient()
        .from("app_settings")
        .select("key, encrypted_value");
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        if (row.encrypted_value) stored.set(row.key, row.encrypted_value);
      }
    } catch (err) {
      // Every key falls back to its env/default value — but say so, loudly.
      // Silently reverting to environment variables made a database outage
      // look like a configuration change.
      console.warn(
        `[settings] app_settings read failed after ${Date.now() - startedAt}ms — ` +
          `falling back to environment values. cause: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const expiresAt = Date.now() + CACHE_TTL;
    for (const key of Object.keys(SETTING_DEFINITIONS) as SettingKey[]) {
      let value = fallbackValue(key);
      const encrypted = stored.get(key);
      if (encrypted) {
        try {
          value = decrypt(encrypted);
        } catch {
          value = fallbackValue(key);
        }
      }
      cache.set(key, { value, expiresAt });
    }
  })().finally(() => {
    pendingRefresh = null;
  });

  return pendingRefresh;
}

export async function getSetting(key: SettingKey): Promise<string> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  await refreshCache();
  return cache.get(key)?.value ?? fallbackValue(key);
}

export async function getSettings(keys: SettingKey[]): Promise<Record<SettingKey, string>> {
  const stale = keys.some((key) => {
    const cached = cache.get(key);
    return !cached || cached.expiresAt <= Date.now();
  });
  if (stale) await refreshCache();

  return Object.fromEntries(
    keys.map((key) => [key, cache.get(key)?.value ?? fallbackValue(key)]),
  ) as Record<SettingKey, string>;
}

export async function saveSettings(
  values: Partial<Record<SettingKey, string>>,
  userId: string,
): Promise<SettingKey[]> {
  const rows: Array<{
    key: SettingKey;
    encrypted_value: string;
    is_secret: boolean;
    updated_by: string;
    updated_at: string;
  }> = [];

  for (const [rawKey, rawValue] of Object.entries(values)) {
    if (!(rawKey in SETTING_DEFINITIONS) || typeof rawValue !== "string") continue;
    const key = rawKey as SettingKey;
    const definition = SETTING_DEFINITIONS[key];
    rows.push({
      key,
      encrypted_value: encrypt(rawValue.trim()),
      is_secret: definition.secret,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    });
  }

  if (rows.length === 0) return [];

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(error.message);

  const keys = rows.map((row) => row.key);
  const { error: auditError } = await admin.from("settings_audit_log").insert({
    user_id: userId,
    keys_changed: keys,
  });
  if (auditError) throw new Error(auditError.message);

  keys.forEach((key) => cache.delete(key));
  return keys;
}

export async function getMaskedSettings(): Promise<Record<SettingKey, string>> {
  const keys = Object.keys(SETTING_DEFINITIONS) as SettingKey[];
  const values = await getSettings(keys);

  return Object.fromEntries(
    keys.map((key) => [
      key,
      SETTING_DEFINITIONS[key].secret ? (values[key] ? "••••••••" : "") : values[key],
    ]),
  ) as Record<SettingKey, string>;
}

export function isSettingKey(value: string): value is SettingKey {
  return value in SETTING_DEFINITIONS;
}
