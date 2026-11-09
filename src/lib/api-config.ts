/**
 * API Configuration
 *
 * Next.js is the PRIMARY backend. It handles most API logic natively
 * (auth, KPIs, notifications, Power BI embed, AI assistant, etc.).
 *
 * Two optional satellite backends can be used for specific needs:
 *   - NestJS  (NESTJS_BACKEND_URL): enterprise business logic, complex CRUD,
 *             data management, user/auth workflows
 *   - Python  (PYTHON_BACKEND_URL): ML/analytics engine (forecasting,
 *             anomaly detection, clustering, scoring)
 *
 * The frontend NEVER calls satellite backends directly — it always
 * goes through Next.js API routes for:
 *   - CORS isolation
 *   - Server-side secret management (API keys, tokens)
 *   - Request/response transformation
 *   - Centralized error handling
 */

export type BackendType = "nestjs" | "python";

export const API_CONFIG = {
  // NestJS backend — enterprise business logic (optional satellite)
  nestjs: {
    baseUrl: process.env.NESTJS_BACKEND_URL ?? "http://localhost:3001",
    endpoints: {
      // Data management
      kpis: "/api/v1/kpis",
      activity: "/api/v1/activity",

      // Notifications
      notifications: "/api/v1/notifications",
      notificationMarkRead: "/api/v1/notifications/:id/read",

      // Health
      health: "/api/v1/health",
    },
  },

  // Python backend — ML/analytics engine (optional satellite)
  python: {
    baseUrl: process.env.PYTHON_BACKEND_URL ?? "http://localhost:8000",
    endpoints: {
      // ML / Forecasting
      mlForecast: "/api/v1/ml/forecast",
      mlAnomaly: "/api/v1/ml/anomaly",
      mlInsights: "/api/v1/ml/insights",

      // Health
      health: "/api/v1/health",
    },
  },

  // Next.js API routes (called by the frontend, handled natively or proxied)
  routes: {
    assistant: "/api/assistant",
    assistantTranscribe: "/api/assistant/transcribe",
    powerbiEmbed: "/api/powerbi/embed",
    powerbiExport: "/api/powerbi/export",
    powerbiRefresh: "/api/powerbi/refresh",
    powerbiQuery: "/api/powerbi/query",
    powerbiModel: "/api/powerbi/model",
    notifications: "/api/notifications",
    alerts: "/api/alerts",
    kpis: "/api/kpis",
    activity: "/api/activity",
    health: "/api/health",
    mlForecast: "/api/ml/forecast",
    mlAnomaly: "/api/ml/anomaly",
    dhis2Analytics: "/api/dhis2/analytics",
    dhis2OrgUnits: "/api/dhis2/org-units",
    dhis2OrgUnitTree: "/api/dhis2/org-unit-tree",
    dhis2DataSets: "/api/dhis2/data-sets",
    dhis2DataValues: "/api/dhis2/data-values",
    dhis2SystemInfo: "/api/dhis2/system-info",
    dhis2Analysis: "/api/dhis2/analysis",
  },
} as const;

type NestJSEndpoint = keyof typeof API_CONFIG.nestjs.endpoints;
type PythonEndpoint = keyof typeof API_CONFIG.python.endpoints;

/**
 * Build a full NestJS backend URL from an endpoint path.
 */
export function nestjsUrl(path: string): string {
  return `${API_CONFIG.nestjs.baseUrl}${path}`;
}

/**
 * Build a full Python backend URL from an endpoint path.
 */
export function pythonUrl(path: string): string {
  return `${API_CONFIG.python.baseUrl}${path}`;
}

/**
 * Get the full URL for a NestJS endpoint by key.
 */
export function getNestJSEndpointUrl(endpoint: NestJSEndpoint): string {
  return nestjsUrl(API_CONFIG.nestjs.endpoints[endpoint]);
}

/**
 * Get the full URL for a Python endpoint by key.
 */
export function getPythonEndpointUrl(endpoint: PythonEndpoint): string {
  return pythonUrl(API_CONFIG.python.endpoints[endpoint]);
}

/**
 * Standard fetch wrapper for calling Next.js API routes
 * from the frontend (client-side).
 */
export async function apiFetch<T>(
  route: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(route, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message ?? error.error ?? `API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}
