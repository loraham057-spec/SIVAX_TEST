/**
 * GET /api/powerbi/embed
 *
 * Generates a Power BI Embedded token natively in Next.js (primary backend).
 * Uses Azure AD service credentials (POWERBI_* env vars) to request
 * an embed token from the Power BI REST API directly.
 *
 * Query params: ?reportId=<optional — falls back to POWERBI_REPORT_ID>
 * Response: { embedUrl, embedToken, reportId, expiresAt }
 */

import { apiError } from "@/app/api/_lib/proxy";
import { getEmbedConfig } from "@/lib/powerbi";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reportId = url.searchParams.get("reportId") ?? undefined;

  try {
    const config = await getEmbedConfig(reportId);
    return Response.json(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate embed token";
    return apiError(message, 500);
  }
}
