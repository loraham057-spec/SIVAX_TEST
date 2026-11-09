/**
 * GET /api/reports — list generated reports (history) with pagination.
 *       ?page=1&pageSize=10
 */

import { NextResponse } from "next/server";
import { listReports } from "@/lib/report-engine/storage";
import { getReportUser } from "./_lib/auth";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = new Set(["PLANNING", "DATA_COLLECTION", "ANALYSIS", "COMPOSITION", "RENDERING"]);

export async function GET(request: Request) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "10", 10)));

  const allReports = await listReports(user.id);
  const total = allReports.length;
  const totalPages = Math.ceil(total / pageSize);
  const from = (page - 1) * pageSize;
  const reports = allReports.slice(from, from + pageSize);

  return NextResponse.json({
    reports,
    activeJobs: allReports.filter((r) => ACTIVE_STATUSES.has(r.status)).length,
    pagination: { page, pageSize, total, totalPages },
  });
}
