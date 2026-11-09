/**
 * GET /api/reports/jobs/[jobId] — poll the status of a generation job.
 */

import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/report-engine/queue";
import { getReportUser } from "../../_lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { jobId } = await params;
  const job = await getJob(jobId, user.id);
  if (!job) return NextResponse.json({ error: "Job introuvable" }, { status: 404 });
  return NextResponse.json({ job });
}
