/**
 * Tool interfaces — typed contracts for each isolated tool service.
 *
 * These interfaces define the capabilities of each tool that the agent
 * can orchestrate. On the Next.js side they are implemented via API
 * routes. On the FastAPI side (future) they will be implemented as
 * Python services with LangGraph integration.
 *
 * Every tool method returns a typed result. Tools never modify the
 * frontend directly — they return data that the Action Dispatcher
 * uses to update the UI.
 */

// ─── PowerBI Tool ─────────────────────────────────────────

export interface PowerBIFilter {
  field: string;
  values: string[];
}

export interface PowerBIPageInfo {
  reportId: string;
  pageName: string;
  displayName: string;
}

export interface PowerBIExportResult {
  downloadUrl: string;
  format: "pdf" | "xlsx" | "png";
  expiresAt: string;
}

export interface PowerBITool {
  applyFilters(reportId: string, filters: PowerBIFilter[]): Promise<void>;
  changePage(reportId: string, pageName: string): Promise<PowerBIPageInfo>;
  exportReport(reportId: string, format: "pdf" | "xlsx" | "png"): Promise<PowerBIExportResult>;
  refreshReport(reportId: string): Promise<{ refreshedAt: string }>;
}

// ─── ML Tool ──────────────────────────────────────────────

export interface MLForecastParams {
  metric: string;
  horizon: number;
  granularity?: "daily" | "weekly" | "monthly";
}

export interface MLForecastResult {
  metric: string;
  forecasts: Array<{ date: string; value: number; confidence: number }>;
  modelVersion: string;
}

export interface MLAnomalyParams {
  metric: string;
  sensitivity?: number;
}

export interface MLAnomalyResult {
  anomalies: Array<{ date: string; value: number; expected: number; score: number }>;
}

export interface MLClusterParams {
  dimensions: string[];
  k?: number;
}

export interface MLClusterResult {
  clusters: Array<{ id: number; label: string; size: number; centroid: Record<string, number> }>;
}

export interface MLRecommendation {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  actionUrl?: string;
}

export interface MLTool {
  forecast(params: MLForecastParams): Promise<MLForecastResult>;
  detectAnomalies(params: MLAnomalyParams): Promise<MLAnomalyResult>;
  cluster(params: MLClusterParams): Promise<MLClusterResult>;
  recommend(context: string): Promise<MLRecommendation[]>;
}

// ─── Database Tool ────────────────────────────────────────

export interface DatabaseQueryParams {
  table: string;
  select?: string[];
  filters?: Record<string, unknown>;
  limit?: number;
  orderBy?: { column: string; ascending: boolean };
}

export interface DatabaseAggregateParams {
  table: string;
  metric: string;
  aggregation: "sum" | "avg" | "count" | "min" | "max";
  groupBy?: string;
  filters?: Record<string, unknown>;
}

export interface DatabaseTableInfo {
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean }>;
  rowCount: number;
}

export interface DatabaseTool {
  readData(params: DatabaseQueryParams): Promise<Record<string, unknown>[]>;
  aggregateQuery(params: DatabaseAggregateParams): Promise<Record<string, unknown>[]>;
  getMetadata(table: string): Promise<DatabaseTableInfo>;
}

// ─── Document Tool ────────────────────────────────────────

export interface DocumentGenerateParams {
  title: string;
  sections: Array<{ heading: string; content: string }>;
  format: "pdf" | "word";
  metadata?: Record<string, string>;
}

export interface DocumentResult {
  downloadUrl: string;
  format: "pdf" | "word";
  generatedAt: string;
}

export interface DocumentTool {
  generatePDF(params: Omit<DocumentGenerateParams, "format">): Promise<DocumentResult>;
  generateWord(params: Omit<DocumentGenerateParams, "format">): Promise<DocumentResult>;
}

// ─── Notification Tool ────────────────────────────────────

export interface EmailParams {
  to: string | string[];
  subject: string;
  body: string;
  html?: boolean;
}

export interface PushParams {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationTool {
  sendEmail(params: EmailParams): Promise<{ sent: boolean; messageId?: string }>;
  sendPush(params: PushParams): Promise<{ sent: number; failed: number }>;
}

// ─── Tool Registry ────────────────────────────────────────

export type ToolName = "powerbi" | "ml" | "database" | "document" | "notification";

export interface ToolRegistry {
  powerbi: PowerBITool;
  ml: MLTool;
  database: DatabaseTool;
  document: DocumentTool;
  notification: NotificationTool;
}

/**
 * Tool allow-list per role.
 * Determines which tools a user role can invoke via the agent.
 */
export const TOOL_ALLOW_LIST: Record<string, ToolName[]> = {
  admin: ["powerbi", "ml", "database", "document", "notification"],
  analyst: ["powerbi", "ml", "database", "document"],
  viewer: ["powerbi", "database"],
};
