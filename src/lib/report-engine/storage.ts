/**
 * ReportStorage — persistence abstraction for generated reports.
 *
 * Primary backend: Supabase (`reports` table, see migrations 026/030/031).
 * Falls back to an in-process store when the table is unavailable
 * (e.g. migration not applied yet in a dev environment).
 *
 * Access model (strictly private): every read/write is scoped to the
 * owner's user ID. The routes use the service-role client, so ownership
 * MUST be enforced here; the RLS policies (migration 031) only act as
 * defense in depth. Favorites are personal (report_favorites table).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ReportDocument, ReportRecord, ReportTemplateId } from "./types";

interface StoredReport {
  record: ReportRecord;
  document: ReportDocument;
  userId?: string;
  prompt?: string;
}

/** In-memory fallback (survives across requests in a persistent Node server). */
const globalStore = globalThis as unknown as { __sivaxReportStore?: Map<string, StoredReport> };
const memoryStore = (globalStore.__sivaxReportStore ??= new Map<string, StoredReport>());

function toRecord(row: Record<string, unknown>): ReportRecord {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    reportType: String(row.report_type ?? ""),
    template: (row.template as ReportTemplateId) ?? "sivax",
    status: (row.status as ReportRecord["status"]) ?? "COMPLETED",
    periodStart: (row.period_start as string) ?? undefined,
    periodEnd: (row.period_end as string) ?? undefined,
    scope: (row.scope as string) ?? undefined,
    audience: (row.audience as string) ?? undefined,
    favorite: Boolean(row.favorite),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

/**
 * Create the persisted row for a generation that just started, so job
 * status survives process restarts and multi-replica deployments.
 */
export async function createReportStub(
  id: string,
  plan: { reportType: string; title?: string; period: { start: string; end: string }; geographicScope?: string; audience: string; template: string; prompt: string },
  opts: { userId?: string },
): Promise<void> {
  const row = {
    id,
    user_id: opts.userId ?? null,
    title: plan.title ?? plan.reportType,
    report_type: plan.reportType,
    template: plan.template,
    status: "PLANNING",
    period_start: plan.period.start,
    period_end: plan.period.end,
    scope: plan.geographicScope ?? null,
    audience: plan.audience,
    prompt: plan.prompt || null,
    document: null,
    favorite: false,
  };
  try {
    const sb = createSupabaseAdminClient();
    const { error } = await sb.from("reports").insert(row);
    if (error) throw error;
  } catch {
    // table unavailable — the in-memory job map remains the only tracker
  }
}

export async function updateReportStatus(id: string, status: string, error?: string): Promise<void> {
  try {
    const sb = createSupabaseAdminClient();
    if (error !== undefined) {
      const { error: updateError } = await sb.from("reports").update({ status, error }).eq("id", id);
      // The error column arrives with migration 030; degrade gracefully before it.
      if (!updateError) return;
    }
    await sb.from("reports").update({ status }).eq("id", id);
  } catch {
    // best effort
  }
}

/** Read the persisted generation status (cross-replica job polling, owner only). */
export async function getReportJobRecord(id: string, userId: string): Promise<{ status: string; error?: string } | null> {
  const sb = createSupabaseAdminClient();
  try {
    const { data, error } = await sb
      .from("reports").select("status,error").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!error && data) {
      return { status: String(data.status), error: (data.error as string | null) ?? undefined };
    }
    // Before migration 030 the error column does not exist — retry without it.
    const { data: fallback } = await sb
      .from("reports").select("status").eq("id", id).eq("user_id", userId).maybeSingle();
    return fallback ? { status: String(fallback.status) } : null;
  } catch {
    return null;
  }
}

export async function saveReport(document: ReportDocument, opts: { userId?: string; prompt?: string }): Promise<ReportRecord> {
  const record: ReportRecord = {
    id: document.id,
    title: document.metadata.title,
    reportType: document.metadata.reportType,
    template: document.template,
    status: "COMPLETED",
    periodStart: document.metadata.period?.start,
    periodEnd: document.metadata.period?.end,
    scope: document.metadata.geographicScope,
    audience: document.metadata.audience,
    favorite: false,
    createdAt: document.generatedAt,
  };

  const row = {
    id: document.id,
    user_id: opts.userId ?? null,
    title: record.title,
    report_type: record.reportType,
    template: record.template,
    status: record.status,
    period_start: record.periodStart ?? null,
    period_end: record.periodEnd ?? null,
    scope: record.scope ?? null,
    audience: record.audience ?? null,
    prompt: opts.prompt ?? null,
    document: document as unknown as Record<string, unknown>,
    favorite: false,
  };

  try {
    const sb = createSupabaseAdminClient();
    // Upsert: the stub row created at generation start gets its final content.
    const { error } = await sb.from("reports").upsert(row, { onConflict: "id" });
    if (error) throw error;
    return record;
  } catch {
    memoryStore.set(document.id, { record, document, userId: opts.userId, prompt: opts.prompt });
    return record;
  }
}

/** Personal favorites of a user (report_favorites, migration 031). */
async function fetchFavoriteIds(userId: string): Promise<Set<string>> {
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb.from("report_favorites").select("report_id").eq("user_id", userId);
    if (error) throw error;
    return new Set((data ?? []).map((r) => String(r.report_id)));
  } catch {
    return new Set();
  }
}

/** Reports of ONE user (strictly private model). */
export async function listReports(userId: string): Promise<ReportRecord[]> {
  const memory = [...memoryStore.values()]
    .filter((s) => s.userId === userId)
    .map((s) => s.record);
  try {
    const sb = createSupabaseAdminClient();
    const [{ data, error }, favorites] = await Promise.all([
      sb.from("reports")
        .select("id,title,report_type,template,status,period_start,period_end,scope,audience,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(200),
      fetchFavoriteIds(userId),
    ]);
    if (error) throw error;
    const rows = (data ?? []).map((row) => ({ ...toRecord(row), favorite: favorites.has(String(row.id)) }));
    const extra = memory.filter((r) => !rows.some((row) => row.id === r.id));
    return [...extra, ...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return memory.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** Fetch a report document, owner only. */
export async function getReport(id: string, userId: string): Promise<ReportDocument | null> {
  const memory = memoryStore.get(id);
  if (memory) return memory.userId === userId ? memory.document : null;
  try {
    const sb = createSupabaseAdminClient();
    const { data, error } = await sb
      .from("reports").select("document").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error || !data?.document) return null;
    return data.document as unknown as ReportDocument;
  } catch {
    return null;
  }
}

/** Delete a report, owner only. */
export async function deleteReport(id: string, userId: string): Promise<void> {
  const memory = memoryStore.get(id);
  if (memory && memory.userId === userId) memoryStore.delete(id);
  try {
    const sb = createSupabaseAdminClient();
    await sb.from("reports").delete().eq("id", id).eq("user_id", userId);
  } catch {
    // memory-only report
  }
}

/** Toggle a personal favorite; only the owner of the report can favorite it. */
export async function setReportFavorite(id: string, userId: string, favorite: boolean): Promise<void> {
  const memory = memoryStore.get(id);
  if (memory && memory.userId === userId) memory.record.favorite = favorite;
  try {
    const sb = createSupabaseAdminClient();
    const { data: owned } = await sb
      .from("reports").select("id").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!owned) return;
    if (favorite) {
      await sb.from("report_favorites").upsert(
        { user_id: userId, report_id: id },
        { onConflict: "user_id,report_id", ignoreDuplicates: true },
      );
    } else {
      await sb.from("report_favorites").delete().eq("user_id", userId).eq("report_id", id);
    }
  } catch {
    // report_favorites arrives with migration 031 — degrade gracefully
  }
}
