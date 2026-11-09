/**
 * Audit logger — records every agent action to the agent_audit_log table.
 *
 * This runs server-side (Next.js API routes) and uses the Supabase
 * service role client to insert immutable audit entries.
 */

import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import type { RiskLevel } from "@/lib/agent/commands";

export interface AuditEntry {
  userId?: string;
  userEmail?: string;
  action: string;
  args: Record<string, unknown>;
  category: string;
  riskLevel: RiskLevel;
  status: "approved" | "auto_executed" | "rejected" | "failed";
  result?: string;
  error?: string;
  durationMs?: number;
}

export async function logAuditEntry(entry: AuditEntry): Promise<void> {
  try {
    const supabase = await createSupabaseRouteHandlerClient();
    await supabase.from("agent_audit_log").insert({
      user_id: entry.userId ?? null,
      user_email: entry.userEmail ?? null,
      action: entry.action,
      args: entry.args,
      category: entry.category,
      risk_level: entry.riskLevel,
      status: entry.status,
      result: entry.result ?? null,
      error: entry.error ?? null,
      duration_ms: entry.durationMs ?? null,
    });
  } catch (err) {
    // Audit logging should never block execution — log to stderr and continue.
    console.error("[audit] Failed to log audit entry:", err);
  }
}

/**
 * Structured logger for tool tracing and observability.
 * Outputs JSON to stdout for log aggregation (e.g. Datadog, CloudWatch).
 */
export interface TraceEntry {
  tool: string;
  method: string;
  userId?: string;
  durationMs: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

export function trace(entry: TraceEntry): void {
  const logLine = {
    timestamp: new Date().toISOString(),
    level: entry.success ? "info" : "error",
    ...entry,
  };
  if (entry.success) {
    console.log(JSON.stringify(logLine));
  } else {
    console.error(JSON.stringify(logLine));
  }
}

/**
 * Measure execution time of an async function.
 */
export async function measure<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, durationMs: Date.now() - start };
}
