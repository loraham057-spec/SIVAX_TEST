"use client";

/**
 * Data Provenance Banner — displays the data source and parameters used
 * by the backend to produce the analysis. This ensures transparency:
 * the user can see which indicator, geography, periods, and data source
 * (DHIS2 live vs Supabase ETL) were used.
 *
 * Source: ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §10.2 (Bug 2 — divergence)
 */

import { Database, Globe, MapPin, Calendar, Activity } from "lucide-react";
import type { AnalysisPayload } from "@/types";
import { useTranslations } from "next-intl";
import { formatDhis2PeriodShort } from "@/lib/dhis2-format";

interface DataProvenanceBannerProps {
  payload: AnalysisPayload;
  /** Source of the data: "dhis2" | "supabase" | "unknown" */
  source?: string;
}

export function DataProvenanceBanner({ payload, source }: DataProvenanceBannerProps) {
  const t = useTranslations("analysis");

  const metric = payload.metric;
  const scope = payload.query_scope || payload.verified_facts?.query_scope;
  const periods = scope?.periods || [];
  const orgUnitName = scope?.orgUnitName || scope?.org_unit_name;
  const targetLevel = scope?.targetLevel ?? scope?.target_level;
  const targetLevelLabel =
    targetLevel === 2 ? "province" : targetLevel === 3 ? "zone de santé" : targetLevel === 4 ? "aire de santé" : targetLevel;
  const dataQuality = payload.summary?.dataQuality;

  // Determine the data source: prefer the explicit `source` prop, then
  // the payload's provenance, then default to "DHIS2".
  const rawSource = source || payload.provenance?.source || "DHIS2";
  const isSupabase = rawSource.toLowerCase().includes("supabase");
  const sourceLabel = isSupabase ? "Supabase (ETL)" : "DHIS2 (temps réel)";
  const SourceIcon = isSupabase ? Database : Globe;

  if (!metric && !orgUnitName && periods.length === 0) {
    return null; // Nothing to show
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t("dataUsed")}</span>

      {metric && (
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          <span>{metric.display_name || metric.name}</span>
        </span>
      )}

      {orgUnitName && (
        <span className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          <span>
            {orgUnitName}
            {targetLevelLabel && (
              <span className="ml-1 text-muted-foreground/70">({targetLevelLabel})</span>
            )}
          </span>
        </span>
      )}

      {periods.length > 0 && (
        <span className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" />
          <span>
            {periods.length === 1
              ? formatDhis2PeriodShort(periods[0])
              : `${formatDhis2PeriodShort(periods[0])} → ${formatDhis2PeriodShort(periods[periods.length - 1])}`}
          </span>
        </span>
      )}

      {dataQuality && (
        <span className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          <span>
            Qualité : {dataQuality.completeness == null
              ? "complétude non calculable"
              : `${(dataQuality.completeness * 100).toFixed(1)}%`}
          </span>
        </span>
      )}

      <span className="ml-auto flex items-center gap-1.5 font-medium text-foreground">
        <SourceIcon className="h-3.5 w-3.5" />
        <span>{sourceLabel}</span>
      </span>
    </div>
  );
}
