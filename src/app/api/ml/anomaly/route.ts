/**
 * GET /api/ml/anomaly
 *
 * Fetches detected data anomalies from the Python ML backend.
 * Response: { anomalies: [{ metric, severity, detail }] }
 */

import { proxyToPython } from "@/app/api/_lib/proxy";

export async function GET() {
  return proxyToPython("mlAnomaly");
}
