/**
 * POST /api/reports/generate — start asynchronous report generation.
 * Returns immediately with a job ID; the frontend polls the job status.
 */

import { NextRequest, NextResponse } from "next/server";
import { enqueueReportGeneration } from "@/lib/report-engine/queue";
import { REPORT_TYPE_REGISTRY } from "@/lib/report-engine/registry";
import type { ReportAudience, ReportPlan, ReportTemplateId } from "@/lib/report-engine/types";
import { getReportUser } from "../_lib/auth";

export const dynamic = "force-dynamic";

const AUDIENCES = ["EXECUTIVE", "TECHNICAL", "PARTNER", "DONOR", "PUBLIC"];
const TEMPLATES = ["sivax", "institutional", "development", "consulting", "government"];

function validatePlan(raw: unknown): ReportPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const period = p.period as { start?: string; end?: string } | undefined;
  if (!REPORT_TYPE_REGISTRY[String(p.reportType)]) return null;
  if (!period || !/^\d{4}-\d{2}/.test(String(period.start)) || !/^\d{4}-\d{2}/.test(String(period.end))) return null;
  return {
    reportType: String(p.reportType),
    title: typeof p.title === "string" && p.title.trim() ? p.title.trim().slice(0, 200) : undefined,
    audience: AUDIENCES.includes(String(p.audience)) ? (p.audience as ReportAudience) : "TECHNICAL",
    period: { start: String(period.start).slice(0, 7), end: String(period.end).slice(0, 7) },
    geographicScope: typeof p.geographicScope === "string" && p.geographicScope.trim() ? p.geographicScope.trim().slice(0, 100) : undefined,
    template: TEMPLATES.includes(String(p.template)) ? (p.template as ReportTemplateId) : "sivax",
    requestedSections: REPORT_TYPE_REGISTRY[String(p.reportType)].defaultSections,
    prompt: String(p.prompt ?? "").slice(0, 1000),
  };
}

export async function POST(request: NextRequest) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: { plan?: unknown; prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const plan = validatePlan(body.plan);
  const prompt = String(body.prompt ?? "").trim().slice(0, 1000);
  if (!plan && !prompt) {
    return NextResponse.json({ error: "Un plan valide ou un prompt est requis" }, { status: 400 });
  }

  const job = enqueueReportGeneration({
    plan: plan ?? undefined,
    prompt: prompt || undefined,
    generatedBy: user.name,
    userId: user.id,
  });

  return NextResponse.json({ job }, { status: 202 });
}
