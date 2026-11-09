/**
 * ReportGenerationQueue — asynchronous report generation tracking.
 *
 * The HTTP request is never blocked by a long generation: POST creates
 * a job, the pipeline runs in the background and the frontend polls the
 * job status. The job ID is the report ID and every status transition is
 * persisted in the `reports` table, so polling works across replicas
 * (EKS) and restarts; the in-process map is only a fast path.
 */

import { planReport } from "./planner";
import { fetchReportData } from "./data-provider";
import { analyzeReportData } from "./analysis";
import { composeReportDocument } from "./composer";
import { createReportStub, getReportJobRecord, saveReport, updateReportStatus } from "./storage";
import type { ReportGenerationStatus, ReportJob, ReportPlan } from "./types";

interface TrackedJob extends ReportJob {
  /** Owner of the generation — only they may poll this job. */
  userId?: string;
}

const globalStore = globalThis as unknown as { __sivaxReportJobs?: Map<string, TrackedJob> };
const jobs = (globalStore.__sivaxReportJobs ??= new Map<string, TrackedJob>());

const JOB_TTL_MS = 30 * 60 * 1000;
const STATUSES = new Set<ReportGenerationStatus>([
  "PLANNING", "DATA_COLLECTION", "ANALYSIS", "COMPOSITION", "RENDERING", "COMPLETED", "FAILED",
]);

function setStatus(id: string, status: ReportGenerationStatus, patch: Partial<TrackedJob> = {}): void {
  const job = jobs.get(id);
  if (job) jobs.set(id, { ...job, ...patch, status, updatedAt: new Date().toISOString() });
  // Persist every transition (fire-and-forget: polling reads the table too).
  void updateReportStatus(id, status, patch.error);
}

function cleanupJobs(): void {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (new Date(job.createdAt).getTime() < cutoff) jobs.delete(id);
  }
}

/** Job status for its owner: in-process map first, persisted row as cross-replica fallback. */
export async function getJob(id: string, userId: string): Promise<ReportJob | null> {
  const local = jobs.get(id);
  if (local) {
    if (local.userId !== userId) return null;
    return {
      id: local.id,
      status: local.status,
      reportId: local.reportId,
      error: local.error,
      createdAt: local.createdAt,
      updatedAt: local.updatedAt,
    };
  }

  const record = await getReportJobRecord(id, userId);
  if (!record) return null;
  const status = STATUSES.has(record.status as ReportGenerationStatus)
    ? (record.status as ReportGenerationStatus)
    : "COMPLETED";
  return {
    id,
    status,
    reportId: status === "COMPLETED" ? id : undefined,
    error: record.error,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function runPipeline(id: string, plan: ReportPlan, generatedBy: string, userId?: string): Promise<void> {
  try {
    setStatus(id, "DATA_COLLECTION");
    const data = await fetchReportData(plan);

    setStatus(id, "ANALYSIS");
    const analysis = await analyzeReportData(plan, data);

    setStatus(id, "COMPOSITION");
    const document = composeReportDocument({ plan, data, analysis, generatedBy, id });

    setStatus(id, "RENDERING");
    await saveReport(document, { userId, prompt: plan.prompt });

    setStatus(id, "COMPLETED", { reportId: document.id });
  } catch (err) {
    setStatus(id, "FAILED", {
      error: err instanceof Error ? err.message : "Erreur inconnue pendant la génération",
    });
  }
}

/**
 * Enqueue a report generation. Returns immediately with the job ID.
 * If `plan` is omitted, the planner is run first from the prompt.
 */
export function enqueueReportGeneration(params: {
  plan?: ReportPlan;
  prompt?: string;
  generatedBy: string;
  userId?: string;
}): ReportJob {
  cleanupJobs();
  const now = new Date().toISOString();
  const job: ReportJob = {
    id: crypto.randomUUID(),
    status: "PLANNING",
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, { ...job, userId: params.userId });

  void (async () => {
    try {
      const plan = params.plan ?? (await planReport(params.prompt ?? "")).plan;
      await createReportStub(job.id, plan, { userId: params.userId });
      await runPipeline(job.id, plan, params.generatedBy, params.userId);
    } catch (err) {
      setStatus(job.id, "FAILED", {
        error: err instanceof Error ? err.message : "Erreur de planification",
      });
    }
  })();

  return job;
}

export type { ReportGenerationStatus };
