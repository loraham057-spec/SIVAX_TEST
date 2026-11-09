/**
 * POST /api/reports/plan — AI Report Planner.
 * Transforms a natural-language prompt into a structured, editable plan.
 */

import { NextRequest, NextResponse } from "next/server";
import { planReport } from "@/lib/report-engine/planner";
import { resolveScope } from "@/lib/report-engine/data-provider";
import { REPORT_TYPE_OPTIONS } from "@/lib/report-engine/registry";
import { TEMPLATE_OPTIONS } from "@/lib/report-engine/templates";
import { getReportUser } from "../_lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const prompt = String(body.prompt ?? "").trim().slice(0, 1000);
  if (!prompt) return NextResponse.json({ error: "Prompt requis" }, { status: 400 });

  const { plan, source } = await planReport(prompt);
  // Resolve the geographic scope now so the user can verify the actual
  // org unit before generating (silent national fallback is surfaced).
  const resolvedScope = await resolveScope(plan.geographicScope);
  return NextResponse.json({
    plan,
    source,
    resolvedScope: {
      name: resolvedScope.name,
      level: resolvedScope.level,
      resolved: resolvedScope.resolved,
      query: resolvedScope.query ?? null,
    },
    options: { reportTypes: REPORT_TYPE_OPTIONS, templates: TEMPLATE_OPTIONS },
  });
}
