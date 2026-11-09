/**
 * Announces a deployment: records it, then pushes a notification and an e-mail.
 *
 * Run by the CI AFTER a successful production deploy — never at build time.
 * Previously this ran on every `npm run build`, so a local build notified every
 * user of the platform.
 *
 *     node scripts/notify-deployment.mjs
 *
 * Requires PUSH_INTERNAL_TOKEN. There is deliberately no fallback value: the
 * previous default was a literal published in this repository (SEC-02), which
 * meant anyone who had read the source could push to every user.
 */

import { readFileSync } from "fs";
import { join } from "path";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
const pushToken = process.env.PUSH_INTERNAL_TOKEN;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!pushToken) {
  console.error("PUSH_INTERNAL_TOKEN is required. Refusing to notify without it.");
  process.exit(1);
}
if (!appUrl) {
  console.error("NEXT_PUBLIC_APP_URL (or APP_URL) is required.");
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(process.cwd(), "public", "version.json"), "utf-8"));
const changelog = version.changelog ?? [];

let failed = false;

// ─── 1. Deployment record ──────────────────────────────────

if (supabaseUrl && supabaseServiceKey) {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/deployments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        build_id: version.buildId,
        timestamp: version.timestamp,
        changelog,
      }),
    });
    if (!res.ok) {
      console.warn(`Deployment record rejected (${res.status}): ${await res.text()}`);
    } else {
      console.log("Deployment record inserted.");
    }
  } catch (err) {
    console.warn(`Could not insert deployment record: ${err.message}`);
  }
} else {
  console.warn("Supabase credentials absent — skipping the deployment record.");
}

// ─── 2. Push + e-mail ──────────────────────────────────────

try {
  const res = await fetch(`${appUrl}/api/push/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pushToken}`,
    },
    body: JSON.stringify({
      title: "DIAV1 — Nouvelle version déployée",
      body: "Une nouvelle version de DIAV1 est en ligne. L'application a été mise à jour automatiquement.",
      buildId: version.buildId,
      url: appUrl,
      changelog,
      sendEmail: true,
    }),
  });

  if (res.ok) {
    const result = await res.json();
    console.log(
      `Notified: push=${result.sent ?? 0}, ` +
        `email=${result.emailResult?.succeeded ?? 0}/${result.emailResult?.total ?? 0}`,
    );
  } else {
    console.error(`push/send returned ${res.status}: ${await res.text()}`);
    failed = true;
  }
} catch (err) {
  console.error(`Could not reach push/send: ${err.message}`);
  failed = true;
}

// A failed announcement must not fail the deployment itself — the new version
// is already live — but it must be visible in the workflow summary.
if (failed) {
  console.error("Deployment announcement failed. The deployment itself is unaffected.");
}
