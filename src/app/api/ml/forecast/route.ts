/**
 * POST /api/ml/forecast
 *
 * Proxies ML forecasting requests to the Python ML backend.
 * The backend runs the forecast model and returns predictions.
 *
 * Request body: { metric: string, horizon: number, granularity?: "daily"|"weekly"|"monthly" }
 * Response:     { forecast: [{date, value, lower, upper}], confidence, summary }
 */

import { proxyToPython, apiError } from "@/app/api/_lib/proxy";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.metric || !body?.horizon) {
    return apiError("Missing 'metric' or 'horizon' field");
  }

  return proxyToPython("mlForecast", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
