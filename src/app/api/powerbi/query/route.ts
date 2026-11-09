/**
 * POST /api/powerbi/query
 *
 * Execute a DAX query against the Power BI dataset via REST executeQueries.
 * The query is validated by the DAX Gateway (read-only, timeout, row limit).
 *
 * Request body: { dax: string, timeoutMs?: number, maxRows?: number }
 * Response:     { columns: string[], rows: unknown[][], rowCount: number, durationMs: number }
 */

import { apiError } from "@/app/api/_lib/proxy";
import { requireUser } from "@/lib/auth/require-user";
import { query } from "@/lib/powerbi/rest-adapter";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return apiError(auth.error.message, auth.error.status);

  const body = await request.json().catch(() => null);

  if (!body?.dax || typeof body.dax !== "string") {
    return apiError("Missing or invalid 'dax' field");
  }

  try {
    const result = await query({
      dax: body.dax,
      timeoutMs: body.timeoutMs,
      maxRows: body.maxRows,
    });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to execute DAX query";
    return apiError(message, 500);
  }
}
