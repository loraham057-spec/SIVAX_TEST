/**
 * SIVAX Report Engine — canonical report document model.
 *
 * The ReportDocument is the single source of truth for every output
 * format (preview, HTML, PDF, DOCX, CSV). Renderers must never derive
 * content from another rendered format.
 */

export type ReportTemplateId =
  | "sivax"
  | "institutional"
  | "development"
  | "consulting"
  | "government";

export type ReportAudience =
  | "EXECUTIVE"
  | "TECHNICAL"
  | "PARTNER"
  | "DONOR"
  | "PUBLIC";

export type ReportGenerationStatus =
  | "PLANNING"
  | "DATA_COLLECTION"
  | "ANALYSIS"
  | "COMPOSITION"
  | "RENDERING"
  | "COMPLETED"
  | "FAILED";

export interface ReportPeriod {
  /** ISO date (YYYY-MM-DD) or month (YYYY-MM). */
  start: string;
  end: string;
}

export interface ReportMetadata {
  title: string;
  subtitle?: string;
  reportType: string;
  description?: string;
  period?: ReportPeriod;
  geographicScope?: string;
  organizationScope?: string;
  warehouse?: string;
  audience?: ReportAudience;
  language: string;
  generatedAt: string;
  version: string;
}

export interface ReportCover {
  logoUrl?: string;
  title: string;
  subtitle?: string;
  periodLabel?: string;
  organization: string;
  author?: string;
  date: string;
  classification?: string;
}

export interface ExecutiveSummary {
  context?: string;
  summary: string;
  keyResults: string[];
  keyMessages: string[];
}

export interface KPI {
  id: string;
  label: string;
  value: string;
  unit?: string;
  change?: string;
  trend?: "up" | "down" | "neutral";
  status?: "success" | "warning" | "danger" | "neutral";
  comparisonLabel?: string;
}

export type ReportChartType = "line" | "bar" | "area" | "donut";

export interface ReportChartSeries {
  name: string;
  data: (number | null)[];
}

export interface ReportChart {
  id: string;
  type: ReportChartType;
  title: string;
  subtitle?: string;
  description?: string;
  categories: string[];
  series: ReportChartSeries[];
  insight?: string;
  source?: string;
}

export interface ReportTableColumn {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
}

export interface ReportTable {
  id: string;
  title: string;
  columns: ReportTableColumn[];
  rows: Record<string, string | number>[];
  footnote?: string;
  source?: string;
}

export interface Insight {
  id: string;
  type: "finding" | "trend" | "anomaly" | "risk";
  title: string;
  description: string;
  severity?: "low" | "medium" | "high" | "critical";
  sourceData?: string[];
}

export interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  rationale?: string;
  expectedImpact?: string;
  timeframe?: string;
  responsibleEntity?: string;
}

export interface Methodology {
  description: string;
  notes?: string[];
}

export interface ReportSource {
  id: string;
  name: string;
  detail?: string;
}

export type ReportBlock =
  | { type: "paragraph"; text: string }
  | { type: "kpis"; kpiIds: string[] }
  | { type: "chart"; chartId: string }
  | { type: "table"; tableId: string }
  | { type: "insights" }
  | { type: "recommendations" }
  | { type: "callout"; variant: "information" | "warning" | "success" | "critical"; text: string };

export interface ReportSection {
  id: string;
  /** Structural title, e.g. "3. Indicateurs clés". */
  title: string;
  /** Optional analytical ("message-driven") title shown instead of `title`. */
  narrativeTitle?: string;
  subtitle?: string;
  blocks: ReportBlock[];
}

export interface ReportBranding {
  organization: string;
  productName: string;
  aiDisclosure: string;
}

export interface ReportAuditMetadata {
  generatedBy: string;
  generatedAt: string;
  prompt?: string;
  aiModel?: string;
  dataSourceIds: string[];
  reportVersion: number;
}

export interface ReportDocument {
  id: string;
  metadata: ReportMetadata;
  cover: ReportCover;
  executiveSummary?: ExecutiveSummary;
  sections: ReportSection[];
  kpis: KPI[];
  charts: ReportChart[];
  tables: ReportTable[];
  insights: Insight[];
  recommendations: Recommendation[];
  methodology?: Methodology;
  sources: ReportSource[];
  branding: ReportBranding;
  template: ReportTemplateId;
  audit: ReportAuditMetadata;
  generatedAt: string;
  generatedBy: string;
}

/** Structured plan produced by the AI Report Planner (before generation). */
export interface ReportPlan {
  reportType: string;
  title?: string;
  audience: ReportAudience;
  period: ReportPeriod;
  geographicScope?: string;
  template: ReportTemplateId;
  requestedSections: string[];
  prompt: string;
}

/** Persisted report list entry. */
export interface ReportRecord {
  id: string;
  title: string;
  reportType: string;
  template: ReportTemplateId;
  status: ReportGenerationStatus;
  periodStart?: string;
  periodEnd?: string;
  scope?: string;
  audience?: string;
  favorite: boolean;
  createdAt: string;
}

export interface ReportJob {
  id: string;
  status: ReportGenerationStatus;
  reportId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
