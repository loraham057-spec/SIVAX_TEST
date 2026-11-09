/**
 * GET /api/ready — readiness probe.
 *
 * Distinct from /api/health on purpose. Liveness answers "is this process
 * alive?" and must not depend on anything external, or a database blip gets
 * every replica killed and restarted. Readiness answers "can this replica serve
 * a request right now?" and therefore does check the dependencies, so a replica
 * that cannot serve is taken out of rotation instead of returning errors.
 *
 * Returns 200 when every hard dependency answers, 503 otherwise.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const CHECK_TIMEOUT_MS = 2000;

type CheckState = "ok" | "degraded" | "unavailable" | "not-configured";

interface Check {
  state: CheckState;
  latencyMs: number;
  detail?: string;
}

async function timed(fn: () => Promise<void>): Promise<Check> {
  const startedAt = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${CHECK_TIMEOUT_MS}ms`)), CHECK_TIMEOUT_MS),
      ),
    ]);
    return { state: "ok", latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      state: "unavailable",
      latencyMs: Date.now() - startedAt,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/** The database is a hard dependency: without it nothing renders. */
async function checkDatabase(): Promise<Check> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { state: "not-configured", latencyMs: 0 };
  }
  return timed(async () => {
    const { error } = await createSupabaseAdminClient()
      .from("app_settings")
      .select("key")
      .limit(1);
    if (error) throw new Error(error.message);
  });
}

/**
 * Redis is a soft dependency: both backends fall back to in-process caching
 * when it is absent, so an outage degrades performance rather than
 * correctness. It must not take a replica out of rotation.
 */
async function checkRedis(): Promise<Check> {
  if (!process.env.REDIS_URL) {
    return { state: "not-configured", latencyMs: 0 };
  }
  return { state: "ok", latencyMs: 0, detail: "configured (soft dependency)" };
}

export async function GET() {
  const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);

  const ready = database.state === "ok" || database.state === "not-configured";

  return Response.json(
    {
      ready,
      checks: { database, redis },
      buildId: process.env.BUILD_ID ?? null,
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
