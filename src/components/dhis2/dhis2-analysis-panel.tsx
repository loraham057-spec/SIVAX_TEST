"use client";

import { useMemo } from "react";
import { AlertTriangle, Database, Info, Lightbulb } from "lucide-react";
import type { Dhis2AnalysisResult } from "@/types";
import { Dhis2KpiGrid } from "@/components/dhis2/dhis2-kpi-grid";
import { Dhis2TrendChart } from "@/components/dhis2/dhis2-trend-chart";
import { Dhis2DataTable } from "@/components/dhis2/dhis2-data-table";
import { Dhis2BarChart } from "@/components/dhis2/dhis2-bar-chart";
import { Dhis2PieChart } from "@/components/dhis2/dhis2-pie-chart";
import { HealthLoadingAnimation } from "@/components/ui/health-loading-animation";
import { MarkdownMessage } from "@/components/assistant/markdown-message";
import { useTranslations } from "next-intl";
import type { AIProcessingStatus } from "@/lib/ai-processing";

interface Dhis2AnalysisPanelProps {
  analysis: Dhis2AnalysisResult | null;
  loading: boolean;
  error: string | null;
  /** Message de chargement dynamique basé sur la nature du prompt. */
  loadingMessage?: string;
  /** Statut fonctionnel du pipeline IA pour l'animation de progression. */
  processingStatus?: AIProcessingStatus | null;
}

function formatNum(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("fr-FR");
}

export function Dhis2AnalysisPanel({ analysis, loading, error, loadingMessage, processingStatus }: Dhis2AnalysisPanelProps) {
  const t = useTranslations("analysis");
  const tLoading = useTranslations("loading");
  const totalLabel = useMemo(() => {
    if (!analysis?.summary) return null;
    return formatNum(analysis.summary.total);
  }, [analysis]);

  if (loading) {
    const statusMessage = processingStatus ? tLoading(processingStatus) : null;
    return (
      <div className="flex items-center justify-center rounded-xl border bg-card">
        <HealthLoadingAnimation
          label={loadingMessage ?? tLoading("default")}
          status={processingStatus}
          statusMessage={statusMessage ?? undefined}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("error")} : {error}</span>
      </div>
    );
  }

  if (!analysis) {
    return null;
  }

  if (analysis.status === "needs_clarification") {
    return (
      <div className="rounded-xl border bg-card p-6">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold">{analysis.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{analysis.interpretation}</p>
            {analysis.explanation && (
              <p className="mt-2 text-sm text-muted-foreground/80">{analysis.explanation}</p>
            )}
            {analysis.candidates.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground">{t("metricsFound")}</p>
                <ul className="mt-1 space-y-1">
                  {analysis.candidates.slice(0, 5).map((c) => (
                    <li key={c.id} className="text-xs text-muted-foreground">
                      • {c.name} <span className="opacity-60">({c.type})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3 space-y-1">
              {analysis.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex-1">
          <h2 className="text-lg font-bold tracking-tight">{analysis.title}</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5 text-primary" />
          <span>{analysis.provenance.source}</span>
        </div>
      </div>

      {/* Analyse et interprétation (réponse LLM détaillée) */}
      {analysis.explanation && (
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
          <div className="flex-1">
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">{t("interpretation")}</p>
            <div className="mt-1 text-sm text-muted-foreground">
              <MarkdownMessage content={analysis.explanation} />
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {analysis.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            {analysis.warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* Summary KPI */}
      {totalLabel !== null && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{t("total")}</p>
            <p className="mt-1 text-2xl font-bold tracking-tight">{totalLabel}</p>
          </div>
          {analysis.summary && (
            <>
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-xs text-muted-foreground">{t("dataRows")}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{analysis.summary.rowCount}</p>
              </div>
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-xs text-muted-foreground">{t("orgUnits")}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{analysis.summary.orgUnitCount}</p>
              </div>
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <p className="text-xs text-muted-foreground">{t("periods")}</p>
                <p className="mt-1 text-2xl font-bold tracking-tight">{analysis.summary.periodCount}</p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Dynamic visualization — graphique affiché séparément de l'interprétation */}
      {analysis.analytics && analysis.analytics.rows.length > 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">{t("visualization")}</h3>
            {analysis.visualization === "kpi" && (
              <Dhis2KpiGrid result={analysis.analytics} loading={false} />
            )}
            {analysis.visualization === "line" && (
              <Dhis2TrendChart result={analysis.analytics} loading={false} />
            )}
            {analysis.visualization === "bar" && (
              <Dhis2BarChart result={analysis.analytics} />
            )}
            {analysis.visualization === "pie" && (
              <Dhis2PieChart result={analysis.analytics} />
            )}
          </div>
          <Dhis2DataTable result={analysis.analytics} loading={false} />
        </div>
      )}

      {/* Provenance */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-2 text-xs text-muted-foreground">
        <span>
          {t("metric")} : <span className="font-medium">{analysis.metric?.name ?? "—"}</span>
          {analysis.metric?.code && <span className="ml-2 opacity-60">({analysis.metric.code})</span>}
        </span>
        <span>{t("generated")} {new Date(analysis.provenance.generatedAt).toLocaleString(undefined)}</span>
      </div>
    </div>
  );
}
