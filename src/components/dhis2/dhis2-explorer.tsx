"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, Database, RotateCcw, Download } from "lucide-react";
import { Dhis2DataTable } from "@/components/dhis2/dhis2-data-table";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { Dhis2KpiGrid } from "@/components/dhis2/dhis2-kpi-grid";
import { Dhis2TrendChart } from "@/components/dhis2/dhis2-trend-chart";
import { Dhis2TrendBarChart } from "@/components/dhis2/dhis2-trend-bar-chart";
import { Dhis2StackedBarChart } from "@/components/dhis2/dhis2-stacked-bar-chart";
import { Dhis2CompositeIndicators } from "@/components/dhis2/dhis2-composite-indicators";

/**
 * Leaflet and its CSS are ~150 kB and touch `window` at import time, so they
 * were both bundled into the initial payload and unusable during SSR. Loading
 * the map on demand keeps that weight off every page that never shows a map.
 */
const Dhis2ChoroplethMap = dynamic(
  () => import("@/components/dhis2/dhis2-choropleth-map").then((m) => m.Dhis2ChoroplethMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center rounded-lg border border-border/50 min-h-[256px]">
        <div className="flex flex-col items-center gap-2">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-xs text-muted-foreground">Chargement de la carte…</span>
        </div>
      </div>
    ),
  },
);
import { dhis2Service } from "@/services";
import { resolveDhis2Name, formatDhis2Period } from "@/lib/dhis2-format";
import { useTranslations } from "next-intl";
import type { Dhis2AnalyticsResult, Dhis2FilterState } from "@/types";

const DEFAULT_FILTER: Dhis2FilterState = {
  orgUnitId: "ymGeqzoPhN3",
  orgUnitLevel: 1,
  dataSetId: null,
  periodPreset: "LAST_12_MONTHS",
};

function exportToCSV(result: Dhis2AnalyticsResult) {
  const dxItems = result.metaData.dimensions.dx ?? [];
  const ouItems = result.metaData.dimensions.ou ?? [];

  const headers: string[] = [];
  if (dxItems.length > 1) headers.push("Indicateur");
  headers.push("Periode");
  if (ouItems.length > 1) headers.push("Unite org.");
  headers.push("Valeur");

  const lines: string[] = [headers.join(";")];

  for (const row of result.rows) {
    const cells: string[] = [];
    if (dxItems.length > 1) {
      cells.push(`"${resolveDhis2Name(result.metaData?.items, row[0])}"`);
    }
    cells.push(`"${formatDhis2Period(row[1]) || resolveDhis2Name(result.metaData?.items, row[1])}"`);
    if (ouItems.length > 1) {
      cells.push(`"${resolveDhis2Name(result.metaData?.items, row[2])}"`);
    }
    cells.push(row[3] ?? "");
    lines.push(cells.join(";"));
  }

  const csv = "\uFEFF" + lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dhis2_export_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function Dhis2Explorer() {
  const [filter, setFilter] = useState<Dhis2FilterState>(DEFAULT_FILTER);
  const [result, setResult] = useState<Dhis2AnalyticsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState("DHIS2 — SNIS RDC");
  const t = useTranslations("explorer");

  const loadAnalytics = useCallback(async (nextFilter: Dhis2FilterState) => {
    if (
      nextFilter.periodPreset === "CUSTOM" &&
      (!nextFilter.customPeriodStart || !nextFilter.customPeriodEnd)
    ) {
      setResult(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = { ...nextFilter, targetOrgUnitLevel: 2 };

      if (nextFilter.dataSetId) {
        const selected = await dhis2Service.getDataSet(nextFilter.dataSetId);
        const dataElements = selected.dataSetElements?.map((item) => item.dataElement.id) ?? [];
        query = { ...nextFilter, targetOrgUnitLevel: 2, dataElements };
      }

      const analytics = await dhis2Service.getFilteredAnalytics(query);
      setResult(analytics);
      setSource("DHIS2 — SNIS RDC (real-time)");
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : t("loadingError"));
    } finally {
      setLoading(false);
    }
  }, []);

  // The debounce exists to coalesce rapid filter changes. On mount there is
  // nothing to coalesce — the default filter is known — so waiting 350 ms just
  // delayed the first paint of real data by 350 ms.
  const hasLoadedOnce = useRef(false);

  useEffect(() => {
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      void loadAnalytics(filter);
      return;
    }

    const timer = window.setTimeout(() => {
      void loadAnalytics(filter);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [filter, loadAnalytics]);

  const isDefaultFilter =
    filter.orgUnitId === DEFAULT_FILTER.orgUnitId &&
    filter.orgUnitLevel === DEFAULT_FILTER.orgUnitLevel &&
    filter.dataSetId === DEFAULT_FILTER.dataSetId &&
    filter.periodPreset === DEFAULT_FILTER.periodPreset;

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5 text-primary" />
          <span>{source}</span>
        </div>
        <div className="flex items-center gap-2">
          {result && !loading && (
            <button
              onClick={() => exportToCSV(result)}
              className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
              title={t("exportCsvTitle")}
            >
              <Download className="h-3.5 w-3.5" />
              {t("exportCsv")}
            </button>
          )}
          {!isDefaultFilter && (
            <button
              onClick={() => setFilter(DEFAULT_FILTER)}
              className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
              title={t("resetTitle")}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("reset")}
            </button>
          )}
        </div>
      </div>

      <Dhis2FilterBar filter={filter} onChange={setFilter} showAntigen />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("loadError", { error })}</span>
        </div>
      )}

      <div className="mt-4">
        <Dhis2KpiGrid result={result} loading={loading} />
      </div>

      <div className="mt-4">
        <Dhis2CompositeIndicators result={result} loading={loading} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-stretch">
        <div className="flex flex-col gap-4">
          <Dhis2TrendChart result={result} loading={loading} />
          <Dhis2TrendBarChart result={result} loading={loading} />
        </div>
        <Dhis2DataTable result={result} loading={loading} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-stretch">
        <Dhis2StackedBarChart result={result} loading={loading} />
        <Dhis2ChoroplethMap result={result} loading={loading} />
      </div>
    </div>
  );
}
