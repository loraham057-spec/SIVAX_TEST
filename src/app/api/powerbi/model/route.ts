/**
 * GET /api/powerbi/model
 *
 * Get the Power BI semantic model metadata: tables, columns, and PEV indicators.
 * Uses the REST API to fetch dataset tables, and enriches with the PEV Semantic Layer.
 *
 * Response: { datasetId, name, tables: [{name, columns}], indicators: [{code, label, domain}] }
 */

import { apiError } from "@/app/api/_lib/proxy";
import { requireUser } from "@/lib/auth/require-user";
import { getModel } from "@/lib/powerbi/rest-adapter";

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return apiError(auth.error.message, auth.error.status);

  try {
    const model = await getModel();
    return Response.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch model metadata";
    return apiError(message, 500);
  }
}
