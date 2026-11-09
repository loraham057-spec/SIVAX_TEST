"use client";

/**
 * Analysis Renderer — dispatcher that selects the right visual renderer
 * based on the render_type produced by the backend analysis planner.
 *
 * This is the entry point for rendering AnalysisPayload in the UI.
 * It replaces the old pattern where the frontend independently recomputed
 * analysis results. Now the backend produces one authoritative payload
 * and this dispatcher renders it.
 *
 * Usage:
 *   <AnalysisRenderer payload={analysisPayload} />
 *
 * If no render_type is specified, it auto-detects based on payload content.
 */

import { useMemo } from "react";
import { Database } from "lucide-react";
import type { AnalysisPayload, RenderType } from "@/types";
import {
  KpiAnswerRenderer,
  RankingAnswerRenderer,
  TrendAnswerRenderer,
  DiagnosticAnswerRenderer,
  GeographicAnswerRenderer,
  ComparativeAnswerRenderer,
  AlertAnswerRenderer,
  ExecutiveBriefRenderer,
} from "./analysis-renderers";

interface AnalysisRendererProps {
  payload: AnalysisPayload | null;
  /** Optional title override */
  title?: string;
  /** Show provenance footer */
  showProvenance?: boolean;
}

function autoDetectRenderType(payload: AnalysisPayload): RenderType {
  // If the backend explicitly set a render_type, use it
  if (payload.render_type) return payload.render_type;

  // Auto-detect based on payload content
  if (payload.executive_brief) return "executive_brief";
  if (payload.risk_scores && payload.risk_scores.length > 0) return "geographic_answer";
  if (payload.diagnostic) return "diagnostic_answer";
  if (payload.alerts && payload.alerts.length > 0) return "alert_answer";

  // Check if we have multiple periods (trend) or multiple org units (ranking)
  const cells = payload.verified_facts?.cells ?? [];
  const periods = new Set(cells.map((c) => c.period));
  const orgUnits = new Set(cells.map((c) => c.orgUnitId));

  if (periods.size > 1 && orgUnits.size <= 2) return "trend_answer";
  if (orgUnits.size > 1) return "ranking_answer";
  if (payload.indicators && payload.indicators.length > 1) return "comparative_answer";

  return "kpi_answer";
}

export function AnalysisRenderer({ payload, title, showProvenance = true }: AnalysisRendererProps) {
  const renderType = useMemo(() => {
    if (!payload) return null;
    return autoDetectRenderType(payload);
  }, [payload]);

  if (!payload) {
    return null;
  }

  const metricName = payload.metric?.display_name ?? payload.metric?.name;

  return (
    <div className="space-y-3">
      {/* Header */}
      {title && (
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-2">
          <h3 className="text-sm font-semibold">{title}</h3>
          {metricName && (
            <span className="text-xs text-muted-foreground">{metricName}</span>
          )}
        </div>
      )}

      {/* Render the appropriate component */}
      {renderType === "kpi_answer" && <KpiAnswerRenderer payload={payload} />}
      {renderType === "ranking_answer" && <RankingAnswerRenderer payload={payload} />}
      {renderType === "trend_answer" && <TrendAnswerRenderer payload={payload} />}
      {renderType === "diagnostic_answer" && <DiagnosticAnswerRenderer payload={payload} />}
      {renderType === "geographic_answer" && <GeographicAnswerRenderer payload={payload} />}
      {renderType === "comparative_answer" && <ComparativeAnswerRenderer payload={payload} />}
      {renderType === "alert_answer" && <AlertAnswerRenderer payload={payload} />}
      {renderType === "executive_brief" && <ExecutiveBriefRenderer payload={payload} />}

      {payload.related_analyses?.map((related) => (
        <AnalysisRenderer
          key={`${related.metric?.id ?? related.metric?.name}-${related.query_scope?.periods?.join("-")}`}
          payload={related}
          title={related.metric?.display_name ?? related.metric?.name}
          showProvenance={false}
        />
      ))}

      {/* Provenance footer */}
      {showProvenance && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Database className="h-3 w-3 text-primary" />
          <span>
            Source: {payload.provenance?.source ?? "DHIS2 SNIS RDC"} — analyse {renderType?.replace("_answer", "").replace(/_/g, " ")}
          </span>
        </div>
      )}
    </div>
  );
}
