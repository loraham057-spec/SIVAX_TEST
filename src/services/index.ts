/**
 * Base API client for SIVAX frontend.
 *
 * Next.js is the PRIMARY backend — it handles most API logic natively
 * (auth, KPIs, notifications, Power BI embed, AI assistant, etc.).
 *
 * Optional satellite backends can be added for specific needs:
 *   - NestJS  → enterprise business logic, complex CRUD
 *   - Python  → ML/analytics engine (forecasting, anomaly detection)
 *
 * The frontend NEVER calls satellite backends directly — it always
 * goes through Next.js API routes, which either handle the request
 * natively or proxy to a satellite backend when needed.
 */

import { apiFetch, API_CONFIG } from "@/lib/api-config";
import type {
  ChatMessage,
  KpiCard,
  ActivityItem,
  NotificationItem,
  AlertItem,
  Dhis2AnalyticsResponse,
  Dhis2OrgUnit,
  Dhis2OrgUnitLevel,
  Dhis2DataSet,
  Dhis2DataValueSet,
  Dhis2AnalyticsResult,
  Dhis2SystemInfo,
  Dhis2FilterState,
  Dhis2AnalysisRequest,
  Dhis2AnalysisResult,
} from "@/types";

// ─── Types ───────────────────────────────────────────────

export interface AssistantChatRequest {
  message: string;
  history?: ChatMessage[];
  context?: {
    reportId?: string;
    filters?: Record<string, unknown>;
  };
  /** Feedback from previous command execution (for auto-correction loop). */
  executionFeedback?: Array<{
    action: string;
    success: boolean;
    error?: string;
  }>;
  /** Caller identity, forwarded to the backend policy engine. */
  userRole?: string | null;
  userEmail?: string | null;
}

export interface AssistantChatResponse {
  reply: string;
  action?: string;
  filters?: Record<string, unknown>;
  mlRequested?: boolean;
  commands?: Array<{ action: string; args?: Record<string, unknown> }>;
}

export interface PowerBIEmbedConfig {
  embedUrl: string;
  embedToken: string;
  reportId: string;
  expiresAt: string;
}

export interface PowerBIExportRequest {
  reportId: string;
  format: "PDF" | "PNG" | "PPTX";
  pageName?: string;
}

export interface MLForecastRequest {
  metric: string;
  horizon: number;
  granularity?: "daily" | "weekly" | "monthly";
}

export interface MLForecastResponse {
  forecast: Array<{ date: string; value: number; lower: number; upper: number }>;
  confidence: number;
  summary: string;
}

// ─── Assistant Service ───────────────────────────────────

export const assistantService = {
  async chat(req: AssistantChatRequest): Promise<AssistantChatResponse> {
    return apiFetch<AssistantChatResponse>(API_CONFIG.routes.assistant, {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  async voiceTranscript(audioBlob: Blob): Promise<{ text: string }> {
    const formData = new FormData();
    formData.append("audio", audioBlob);
    return apiFetch<{ text: string }>(API_CONFIG.routes.assistantTranscribe, {
      method: "POST",
      body: formData,
    });
  },
};

// ─── Power BI Service ────────────────────────────────────

export const powerbiService = {
  async getEmbedConfig(reportId?: string): Promise<PowerBIEmbedConfig> {
    const params = reportId ? `?reportId=${reportId}` : "";
    return apiFetch<PowerBIEmbedConfig>(`${API_CONFIG.routes.powerbiEmbed}${params}`);
  },

  async exportReport(req: PowerBIExportRequest): Promise<{ exportId: string; status: string }> {
    return apiFetch<{ exportId: string; status: string }>(API_CONFIG.routes.powerbiExport, {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  async refreshReport(reportId: string): Promise<{ status: string }> {
    return apiFetch<{ status: string }>(API_CONFIG.routes.powerbiRefresh, {
      method: "POST",
      body: JSON.stringify({ reportId }),
    });
  },

  /** Execute a DAX query against the Power BI dataset (REST executeQueries). */
  async queryDataset(
    dax: string,
    options?: { timeoutMs?: number; maxRows?: number },
  ): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number; durationMs: number }> {
    return apiFetch(`${API_CONFIG.routes.powerbiQuery}`, {
      method: "POST",
      body: JSON.stringify({ dax, ...options }),
    });
  },

  /** Get the Power BI semantic model metadata (tables, columns, PEV indicators). */
  async getModel(): Promise<{
    datasetId: string;
    name: string;
    tables: Array<{ name: string; columns: string[] }>;
    indicators?: Array<{ code: string; label: string; daxMeasure?: string; domain: string }>;
  }> {
    return apiFetch(`${API_CONFIG.routes.powerbiModel}`);
  },
};

// ─── ML Service ──────────────────────────────────────────

export const mlService = {
  async forecast(req: MLForecastRequest): Promise<MLForecastResponse> {
    return apiFetch<MLForecastResponse>(API_CONFIG.routes.mlForecast, {
      method: "POST",
      body: JSON.stringify(req),
    });
  },

  async detectAnomalies(): Promise<{ anomalies: Array<{ metric: string; severity: string; detail: string }> }> {
    return apiFetch(`${API_CONFIG.routes.mlAnomaly}`);
  },
};

// ─── Data Service (KPIs, Activity) ───────────────────────

export const dataService = {
  async getKpis(): Promise<KpiCard[]> {
    return apiFetch<KpiCard[]>(API_CONFIG.routes.kpis);
  },

  async getActivity(): Promise<ActivityItem[]> {
    return apiFetch<ActivityItem[]>(API_CONFIG.routes.activity);
  },
};

// ─── DHIS2 Service (real analytics data) ─────────────────

export const dhis2Service = {
  async getAnalytics(): Promise<Dhis2AnalyticsResponse> {
    return apiFetch<Dhis2AnalyticsResponse>(API_CONFIG.routes.dhis2Analytics);
  },

  async getOrgUnits(params?: {
    level?: number;
    parent?: string;
    search?: string;
  }): Promise<{ organisationUnits: Dhis2OrgUnit[] }> {
    const query = new URLSearchParams();
    if (params?.level) query.set("level", String(params.level));
    if (params?.parent) query.set("parent", params.parent);
    if (params?.search) query.set("search", params.search);
    const qs = query.toString();
    return apiFetch<{ organisationUnits: Dhis2OrgUnit[] }>(
      `${API_CONFIG.routes.dhis2OrgUnits}${qs ? `?${qs}` : ""}`,
    );
  },

  async getOrgUnitTree(parentId: string): Promise<Dhis2OrgUnit> {
    return apiFetch<Dhis2OrgUnit>(
      `${API_CONFIG.routes.dhis2OrgUnitTree}?parentId=${parentId}`,
    );
  },

  async getOrgUnitLevels(): Promise<{ organisationUnitLevels: Dhis2OrgUnitLevel[] }> {
    return apiFetch<{ organisationUnitLevels: Dhis2OrgUnitLevel[] }>(
      `${API_CONFIG.routes.dhis2OrgUnits}?levels=true`,
    );
  },

  async getDataSets(): Promise<{ dataSets: Dhis2DataSet[] }> {
    return apiFetch<{ dataSets: Dhis2DataSet[] }>(API_CONFIG.routes.dhis2DataSets);
  },

  async getDataSet(id: string): Promise<Dhis2DataSet> {
    return apiFetch<Dhis2DataSet>(
      `${API_CONFIG.routes.dhis2DataSets}?id=${encodeURIComponent(id)}`,
    );
  },

  async getDataValues(params: {
    dataSet: string;
    period: string;
    orgUnit: string;
    children?: boolean;
  }): Promise<Dhis2DataValueSet> {
    const query = new URLSearchParams({
      dataSet: params.dataSet,
      period: params.period,
      orgUnit: params.orgUnit,
    });
    if (params.children) query.set("children", "true");
    return apiFetch<Dhis2DataValueSet>(
      `${API_CONFIG.routes.dhis2DataValues}?${query.toString()}`,
    );
  },

  async getFilteredAnalytics(filter: Dhis2FilterState): Promise<Dhis2AnalyticsResult> {
    return apiFetch<Dhis2AnalyticsResult>(API_CONFIG.routes.dhis2Analytics, {
      method: "POST",
      body: JSON.stringify(filter),
    });
  },

  async getSystemInfo(): Promise<Dhis2SystemInfo> {
    return apiFetch<Dhis2SystemInfo>(API_CONFIG.routes.dhis2SystemInfo);
  },

  async runAnalysis(req: Partial<Dhis2AnalysisRequest>, llmInterpretation?: string): Promise<Dhis2AnalysisResult> {
    return apiFetch<Dhis2AnalysisResult>(API_CONFIG.routes.dhis2Analysis, {
      method: "POST",
      body: JSON.stringify({ ...req, llmInterpretation }),
    });
  },
};

// ─── Notifications Service ───────────────────────────────

export const notificationsService = {
  async getAll(): Promise<NotificationItem[]> {
    return apiFetch<NotificationItem[]>(API_CONFIG.routes.notifications);
  },

  async markRead(id: string): Promise<void> {
    await apiFetch(`${API_CONFIG.routes.notifications}?id=${id}`, {
      method: "PATCH",
    });
  },

  async markAllRead(): Promise<void> {
    await apiFetch(API_CONFIG.routes.notifications, {
      method: "PATCH",
    });
  },
};

// ─── Alerts Service ──────────────────────────────────────

export const alertsService = {
  async getAll(params?: { limit?: number; unread?: boolean }): Promise<AlertItem[]> {
    const query = new URLSearchParams();
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.unread) query.set("unread", "1");
    const qs = query.toString();
    return apiFetch<AlertItem[]>(`${API_CONFIG.routes.alerts}${qs ? `?${qs}` : ""}`);
  },

  async markRead(id: string): Promise<void> {
    await apiFetch(`${API_CONFIG.routes.alerts}?id=${id}`, {
      method: "PATCH",
    });
  },

  async markAllRead(): Promise<void> {
    await apiFetch(API_CONFIG.routes.alerts, {
      method: "PATCH",
    });
  },
};

// ─── Health Service ──────────────────────────────────────

export const healthService = {
  async check(): Promise<{ status: string; backend: string; satellites: Record<string, string> }> {
    return apiFetch<{ status: string; backend: string; satellites: Record<string, string> }>(API_CONFIG.routes.health);
  },
};
