/**
 * POST /api/powerbi/refresh
 *
 * Triggers a dataset refresh for a Power BI report natively in Next.js.
 * Calls the Power BI REST API directly using Azure AD credentials.
 *
 * Request body: { reportId: string }
 * Response:     { status: string }
 */

import { apiError } from "@/app/api/_lib/proxy";
import { refreshDataset } from "@/lib/powerbi";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.reportId) {
    return apiError("Missing 'reportId' field");
  }

  try {
    const result = await refreshDataset(body.reportId);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trigger dataset refresh";
    return apiError(message, 500);
  }
}
