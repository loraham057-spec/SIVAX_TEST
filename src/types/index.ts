export type Trend = "up" | "down" | "neutral";

// ─── Decision Intelligence: Analysis Payload & Render Types ────────────────

export type RenderType =
  | "kpi_answer"
  | "ranking_answer"
  | "trend_answer"
  | "diagnostic_answer"
  | "geographic_answer"
  | "comparative_answer"
  | "alert_answer"
  | "executive_brief";

export interface AnalysisCell {
  period: string;
  orgUnitId: string;
  orgUnitName: string;
  org_unit_id?: string;
  org_unit_name?: string;
  value: number;
}

export interface VerifiedFacts {
  metric?: { id: string; name: string; type: string };
  query_scope?: {
    orgUnitId: string;
    orgUnitName: string;
    org_unit_id?: string;
    org_unit_name?: string;
    periods: string[];
    targetLevel: string | number | null;
    target_level?: string | number | null;
  };
  values?: number[];
  cells?: AnalysisCell[];
  total?: number;
}

export interface AnalysisPayload {
  metric?: { id: string; name: string; type: string; display_name?: string };
  query_scope?: {
    orgUnitId: string;
    orgUnitName: string;
    org_unit_id?: string;
    org_unit_name?: string;
    periods: string[];
    targetLevel: string | number | null;
    target_level?: string | number | null;
  };
  rows?: Array<[string, string, string, string]>; // [dx, pe, ou, value]
  metaData?: { items: Record<string, { name: string }> };
  summary?: {
    total: number;
    aggregateMethod?: "sum" | "mean_of_reporting_units_latest_period";
    rowCount: number;
    orgUnitCount: number;
    periodCount: number;
    derived?: {
      type: string;
      period: string | null;
      numerator: number;
      denominator: number;
      value: number | null;
      unit: string;
      threshold: number;
      comparison_operator: string;
    } | null;
    dataQuality?: {
      status: string;
      returned_cells: number;
      reported_org_units: number;
      expected_org_units: number | null;
      completeness: number | null;
      promptitude: number | null;
      limitations: string[];
    };
  };
  verified_facts?: VerifiedFacts;
  qid?: string | null;
  related_analyses?: AnalysisPayload[];
  response_contract?: {
    version: string;
    qid?: string | null;
    analysis_intent?: string;
    measurement_type: string;
    render_type: RenderType;
    required_fields: string[];
    threshold?: number | null;
    comparison_operator?: string | null;
    population?: string | null;
    human_validation_required?: boolean;
  };
  // Extended fields from the decision intelligence tools
  render_type?: RenderType;
  analysis_type?: string;
  indicators?: Array<{
    id: string;
    name: string;
    short_name: string;
    unit: string;
    thresholds?: Record<string, number> | null;
    definition?: string;
  }>;
  plan_steps?: Array<{
    step: string;
    description: string;
    tool: string;
    render_hint: string;
    status?: "completed" | "unavailable";
  }>;
  risk_scores?: Array<{
    org_unit_id: string;
    org_unit_name: string;
    score: number;
    level: string;
    factors: Record<string, { value: number; contribution: number }>;
    missing_factors: string[];
  }>;
  diagnostic?: {
    primary_indicator: { id: string; name: string };
    provinces_below_threshold: number;
    gaps: Array<{
      org_unit_id: string;
      org_unit_name: string;
      value: number;
      status: string;
      label: string;
      gap_to_target: number | null;
    }>;
    factors: Array<{
      indicator_id: string;
      name: string;
      correlation: number;
      interpretation: string;
      direction: string;
      confidence?: { score: number; label: string; factors?: Record<string, unknown> };
    }>;
    hypotheses: Array<{
      text: string;
      confidence?: { score: number; label: string; factors?: Record<string, unknown> };
      factor_indicator?: string | null;
      correlation?: number | null;
    }>;
  };
  alerts?: Array<{
    id: string;
    title: string;
    message: string;
    severity: string;
    source: string;
  }>;
  executive_brief?: {
    situation: string;
    gaps: string;
    diagnosis: string;
    risk: string;
    actions: string[];
  };
  provenance?: {
    source: string;
    generatedAt: string;
    metricIds: string[];
    orgUnitId?: string;
    orgUnitName?: string;
    periods?: string[];
  };
  /** Defaults applied when the user did not specify period/geography */
  assumptions?: Record<string, unknown>;
  /** Deterministic follow-up suggestions (deepening the analysis) */
  suggested_followups?: SuggestedFollowup[];
  /** LLM-generated interpretation (markdown) — rendered in the interpretation div */
  interpretation?: string;
  /** Display title for the analysis (typically the metric name) */
  title?: string;
  /** Metric candidates found during search (for disambiguation display) */
  candidates?: Array<{ id: string; name: string; type: string; score: number }>;
  /** Warnings about the analysis (ambiguity, data quality, etc.) */
  warnings?: string[];
}

/** A clickable option in a structured clarification question. */
export interface ClarificationOption {
  label: string;
  value: string;
}

/** Structured clarification request from the clarification engine. */
export interface ClarificationRequest {
  slot: string;
  reason?: string;
  question: string;
  options: ClarificationOption[];
  defaults_available?: Record<string, unknown>;
  partial_understanding?: string;
  qid?: string | null;
}

/** Deterministic follow-up suggestion after a successful analysis. */
export interface SuggestedFollowup {
  label: string;
  message: string;
}

export type ActivityType = "ai" | "system" | "alert" | "user";

export type NotificationSeverity = "info" | "warning" | "critical";

export type NotificationType = "system" | "alert" | "ml_insight" | "data_quality" | "user" | "powerbi" | "security";
export type NotificationPriority = "low" | "medium" | "high" | "critical";

export type AlertType = "analysis" | "prediction" | "danger" | "deadline" | "imminent";

export type AlertSeverity = "info" | "warning" | "critical";

export interface KpiCard {
  title: string;
  value: string;
  change: string;
  trend: Trend;
  description: string;
}

export interface Dhis2StatCard {
  id: string;
  label: string;
  value: string;
  rawValue: number;
  unit: "count" | "percent";
  iconKey: string;
  delta: number | null;
  period: string | null;
}

export interface Dhis2SeriesPoint {
  period: string;
  value: number;
}

export interface Dhis2AnalyticsResponse {
  source: string;
  cards: Dhis2StatCard[];
  series: Dhis2SeriesPoint[];
}

// ─── DHIS2 real-time integration types ────────────────────

export interface Dhis2OrgUnit {
  id: string;
  name: string;
  level: number;
  parent?: { id: string } | null;
  children?: Dhis2OrgUnit[];
  code?: string;
  shortName?: string;
}

export interface Dhis2OrgUnitLevel {
  id: string;
  name: string;
  level: number;
}

export interface Dhis2DataSet {
  id: string;
  name: string;
  periodType: string;
  displayName?: string;
  dataSetElements?: Dhis2DataSetElement[];
}

export interface Dhis2DataSetElement {
  dataElement: {
    id: string;
    name: string;
    code?: string;
    valueType?: string;
  };
}

export interface Dhis2DataValue {
  dataElement: string;
  period: string;
  orgUnit: string;
  categoryOptionCombo: string;
  attributeOptionCombo: string;
  value: string;
  storedBy: string;
  created: string;
  lastUpdated: string;
  comment: string | null;
  followup: boolean;
}

export interface Dhis2DataValueSet {
  dataSet?: string;
  completeDate: string | null;
  period: string;
  orgUnit: string;
  dataValues: Dhis2DataValue[];
}

export interface Dhis2AnalyticsQuery {
  dx: string[];
  pe: string[];
  ou: string;
  children?: boolean;
  dimensions?: string[];
}

export interface Dhis2AnalyticsResult {
  headers: { name: string; column: string; valueType: string; meta: boolean }[];
  metaData: {
    items: Record<string, { name: string }>;
    dimensions: Record<string, string[]>;
  };
  rows: string[][];
}

export interface Dhis2SystemInfo {
  version: string;
  systemName: string;
  instanceBaseUrl: string;
  serverDate: string;
  lastAnalyticsTableSuccess: string;
}

export type Dhis2PeriodPreset =
  | "THIS_MONTH"
  | "LAST_MONTH"
  /** Most recent fully reported month (M-2): the latest month the ETL syncs. */
  | "LAST_COMPLETE_MONTH"
  | "THIS_YEAR"
  | "LAST_YEAR"
  | "LAST_12_MONTHS"
  | "LAST_6_MONTHS"
  | "LAST_3_MONTHS"
  | "YEAR_OVER_YEAR"
  | "CUSTOM";

export interface Dhis2FilterState {
  orgUnitId: string;
  orgUnitLevel: number;
  /** Selected ancestors from the province down (province, zone, aire, FOSA). */
  orgUnitPath?: string[];
  dataSetId: string | null;
  periodPreset: Dhis2PeriodPreset;
  customPeriodStart?: string;
  customPeriodEnd?: string;
  dataElements?: string[];
  targetOrgUnitLevel?: number;
  /** Selected antigen indicator ID (e.g. Penta3 = "v9b9aYsA5PM"). */
  antigeId?: string;
}

export type Dhis2AnalysisVisualization = "auto" | "kpi" | "line" | "bar" | "pie" | "table";

export interface Dhis2AnalysisRequest {
  question: string;
  metricQuery?: string;
  /** ID de la métrique DHIS2 sélectionnée par le backend (skip de la recherche côté frontend). */
  metricId?: string;
  periodPreset: Dhis2PeriodPreset;
  periods?: string[];
  orgUnitId: string;
  orgUnitLevel: number;
  targetOrgUnitLevel?: number;
  visualization: Dhis2AnalysisVisualization;
}

export interface Dhis2MetricCandidate {
  id: string;
  name: string;
  type: "indicator" | "dataElement";
  code?: string;
  description?: string;
  score: number;
}

export interface Dhis2AnalysisResult {
  id: string;
  status: "ready" | "needs_clarification";
  title: string;
  interpretation: string;
  explanation?: string;
  request: Dhis2AnalysisRequest;
  metric?: Dhis2MetricCandidate;
  candidates: Dhis2MetricCandidate[];
  visualization: Exclude<Dhis2AnalysisVisualization, "auto">;
  analytics?: Dhis2AnalyticsResult;
  summary?: {
    total: number;
    rowCount: number;
    orgUnitCount: number;
    periodCount: number;
  };
  warnings: string[];
  provenance: {
    source: string;
    generatedAt: string;
    metricIds: string[];
  };
}

export interface ActivityItem {
  id: string;
  title: string;
  timestamp: string;
  type: ActivityType;
}

export interface NotificationItem {
  id: string;
  user_id: string | null;
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  summary: string | null;
  icon: string | null;
  color: string | null;
  action_url: string | null;
  action_label: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  dismissed_at: string | null;
  clicked_at: string | null;
  push_sent_at: string | null;
  push_status: string;
  push_error: string | null;
  expires_at: string | null;
  created_by: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface AlertItem {
  id: string;
  title: string;
  message: string;
  /** Localised display string — kept for existing consumers. */
  timestamp: string;
  /** ISO 8601 creation date, used to interleave alerts with notifications. */
  createdAt: string;
  type: AlertType;
  severity: AlertSeverity;
  read: boolean;
  source: string;
  region?: string;
  deadline?: string;
  actionUrl?: string;
}

/**
 * Entry of the unified notification feed: either a row of the
 * `notifications` table or a data-driven alert surfaced as a notification.
 * Alerts carry their original payload so the UI can show severity, zone and
 * deadline and the hook can route read/unread actions to /api/alerts.
 */
export type FeedItem = NotificationItem & { alert?: AlertItem };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  attachments?: string[];
  suggestions?: string[];
}

export interface Workspace {
  id: string;
  name: string;
  role: string;
}

export interface AICommand {
  action: string;
  filters?: Record<string, unknown>;
  ml_request?: string;
  explanation?: string;
}
