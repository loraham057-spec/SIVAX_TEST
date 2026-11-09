/**
 * POST /api/powerbi/export
 *
 * Exports a Power BI report as PDF/PNG/PPTX natively in Next.js.
 * Calls the Power BI REST API ExportTo endpoint directly.
 *
 * Request body: { reportId: string, format: "PDF"|"PNG"|"PPTX", pageName?: string }
 * Response:     { exportId: string, status: string }
 */

import { apiError } from "@/app/api/_lib/proxy";
import { exportReport } from "@/lib/powerbi";
import { requireUser } from "@/lib/auth/require-user";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth.error) return apiError(auth.error.message, auth.error.status);

  const body = await request.json().catch(() => null);

  if (!body?.reportId || !body?.format) {
    return apiError("Missing 'reportId' or 'format' field");
  }

  const validFormats = ["PDF", "PNG", "PPTX"];
  if (!validFormats.includes(body.format)) {
    return apiError(`Invalid format. Must be one of: ${validFormats.join(", ")}`);
  }

  try {
    const result = await exportReport(body.reportId, body.format, body.pageName);
    if ((await getSetting("security_audit_log")) === "true") {
      await createSupabaseAdminClient().from("data_export_audit_log").insert({
        user_id: auth.user.id,
        resource: body.reportId,
        format: body.format,
        metadata: { pageName: body.pageName ?? null, exportId: result.exportId },
      });
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to export report";
    return apiError(message, 500);
  }
}
