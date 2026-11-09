/**
 * GET /api/health
 *
 * Checks the health of Next.js (primary backend) and optionally
 * reports the status of satellite backends (NestJS, Python) if configured.
 */

import { API_CONFIG } from "@/lib/api-config";

export async function GET() {
  const satellites: Record<string, string> = {};

  // Check NestJS satellite if configured
  if (process.env.NESTJS_BACKEND_URL) {
    try {
      const res = await fetch(`${API_CONFIG.nestjs.baseUrl}${API_CONFIG.nestjs.endpoints.health}`, {
        signal: AbortSignal.timeout(3000),
      });
      satellites.nestjs = res.ok ? "online" : "degraded";
    } catch {
      satellites.nestjs = "offline";
    }
  }

  // Check Python satellite if configured
  if (process.env.PYTHON_BACKEND_URL) {
    try {
      const res = await fetch(`${API_CONFIG.python.baseUrl}${API_CONFIG.python.endpoints.health}`, {
        signal: AbortSignal.timeout(3000),
      });
      satellites.python = res.ok ? "online" : "degraded";
    } catch {
      satellites.python = "offline";
    }
  }

  return Response.json({
    status: "ok",
    backend: "nextjs",
    satellites,
  });
}
