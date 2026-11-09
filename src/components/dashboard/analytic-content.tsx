"use client";

/**
 * Analytic Content — the content inside the "DHIS2 Analytics In-App" tab.
 *
 * First-launch experience (WhatsApp-desktop style): on the first open of
 * the session, a Welcome hero is shown explaining what the user can do.
 * Once the user clicks "Start Visualization", "Ask AI", or picks a page
 * from the toolbar dropdown, the welcome is dismissed for the rest of the
 * session and the visualization content takes over.
 *
 * The toolbar center shows the current page name with a dropdown arrow
 * that opens the page menu modal (9 thematic pages).
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LayoutDashboard, Hammer, ChevronDown, Database, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PowerBIContainer } from "@/components/powerbi/powerbi-container";
import { WelcomePage } from "@/components/dashboard/welcome-page";
import { PageMenuModal } from "@/components/dashboard/page-menu-modal";
import {
  DEFAULT_ANALYTICS_PAGE,
  getAnalyticsPage,
  type AnalyticsPageId,
} from "@/components/dashboard/analytics-pages";
import { useAssistant } from "@/store/assistant-store";
import { useDashboardFilters } from "@/store/dashboard-filters-store";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { CoverageTable } from "@/components/dhis2/coverage-table";
import { Dhis2TrendChart } from "@/components/dhis2/dhis2-trend-chart";
import { Dhis2TrendBarChart } from "@/components/dhis2/dhis2-trend-bar-chart";
import { Dhis2ChoroplethMap } from "@/components/dhis2/dhis2-choropleth-map";
import { CiblesPage } from "@/components/dashboard/pages/cibles-page";
import { PerformancePage } from "@/components/dashboard/pages/performance-page";
import { SupplyPage } from "@/components/dashboard/pages/supply-page";
import { ColdChainPage } from "@/components/dashboard/pages/coldchain-page";
import { WastagePage } from "@/components/dashboard/pages/wastage-page";
import { DataQualityPage } from "@/components/dashboard/pages/dataquality-page";
import { ManagementPage } from "@/components/dashboard/pages/management-page";
import { SurveillancePage } from "@/components/dashboard/pages/surveillance-page";
import { ScopeNotice, useDescribeSource, useMultiIndicatorAnalytics } from "@/components/dashboard/pages/_shared";
import type { Dhis2AnalysisResult, Dhis2FilterState, AnalysisPayload } from "@/types";
import type { AIProcessingStatus } from "@/lib/ai-processing";
import { useTranslations } from "next-intl";

interface AnalyticContentProps {
  analysis: Dhis2AnalysisResult | null;
  analysisPayload: AnalysisPayload | null;
  analysisLoading: boolean;
  analysisError: string | null;
  loadingMessage?: string;
  processingStatus?: AIProcessingStatus | null;
  onClearAnalysis?: () => void;
  /** Remonte l'état plein écran du container à la page parente. */
  onFullscreenChange?: (fullscreen: boolean) => void;
}

export function AnalyticContent({
  analysis,
  analysisPayload,
  analysisLoading,
  analysisError,
  loadingMessage,
  processingStatus,
  onClearAnalysis,
  onFullscreenChange,
}: AnalyticContentProps) {
  const [hasStarted, setHasStarted] = useState(false);
  const [activePage, setActivePage] = useState<AnalyticsPageId>(DEFAULT_ANALYTICS_PAGE);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const { open: openAssistant } = useAssistant();
  const tPages = useTranslations("analyticsPages");
  const tTabs = useTranslations("analyticTabs");

  // Any AI analysis becoming active dismisses the welcome for the session.
  useEffect(() => {
    if (analysis !== null || analysisPayload !== null || analysisLoading || analysisError !== null) {
      setHasStarted(true);
    }
  }, [analysis, analysisPayload, analysisLoading, analysisError]);

  const handleStartVisualization = () => setHasStarted(true);
  const handleLaunchAi = () => {
    setHasStarted(true);
    openAssistant();
  };
  const handleSelectPage = (id: AnalyticsPageId) => {
    setActivePage(id);
    setHasStarted(true);
  };

  return (
    <PowerBIContainer
      mode="analytic"
      title={tTabs("visualization")}
      reportId="vaccination-coverage-2026"
      analysis={analysis}
      analysisPayload={analysisPayload}
      analysisLoading={analysisLoading}
      analysisError={analysisError}
      loadingMessage={loadingMessage}
      processingStatus={processingStatus}
      onClearAnalysis={onClearAnalysis}
      onFullscreenChange={onFullscreenChange}
      toolbarCenter={
        <button
          type="button"
          onClick={() => setPageMenuOpen(true)}
          className="inline-flex h-10 max-w-full items-center gap-2 rounded-xl border border-input bg-background px-4 text-[14px] font-bold shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[15px]"
        >
          <span className="truncate max-w-[120px] sm:max-w-[200px]">
            {!hasStarted ? tTabs("welcome") : tPages(`pages.${activePage}.title`)}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      }
    >
      {!hasStarted ? (
        <WelcomePage
          onStartVisualization={handleStartVisualization}
          onLaunchAi={handleLaunchAi}
          onOpenPage={handleSelectPage}
        />
      ) : activePage === "coverage" ? (
        <VisualizationGrid analysis={analysis} />
      ) : activePage === "cibles" ? (
        <CiblesPage />
      ) : activePage === "performance" ? (
        <PerformancePage />
      ) : activePage === "supply" ? (
        <SupplyPage />
      ) : activePage === "coldchain" ? (
        <ColdChainPage />
      ) : activePage === "wastage" ? (
        <WastagePage />
      ) : activePage === "dataquality" ? (
        <DataQualityPage />
      ) : activePage === "management" ? (
        <ManagementPage />
      ) : activePage === "surveillance" ? (
        <SurveillancePage />
      ) : (
        <ComingSoonPage pageId={activePage} onOpenMenu={() => setPageMenuOpen(true)} />
      )}

      <PageMenuModal
        open={pageMenuOpen}
        onOpenChange={setPageMenuOpen}
        activePage={activePage}
        onSelectPage={handleSelectPage}
      />
    </PowerBIContainer>
  );
}

/**
 * ComingSoonPage — placeholder élégant pour les pages d'analyse dont les
 * graphiques ne sont pas encore implémentés. Rappelle le contenu prévu
 * (description + indicateurs clés) et permet de revenir au menu des pages.
 */
function ComingSoonPage({ pageId, onOpenMenu }: { pageId: AnalyticsPageId; onOpenMenu: () => void }) {
  const t = useTranslations("analyticsPages");
  const page = getAnalyticsPage(pageId);
  const Icon = page.icon;
  const indicators = t(`pages.${pageId}.indicators`).split("|").map((s) => s.trim()).filter(Boolean);

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-8 w-8" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{t(`pages.${pageId}.title`)}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {t(`pages.${pageId}.description`)}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-1.5">
          {indicators.map((ind) => (
            <span key={ind} className="rounded-md border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground">
              {ind}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-700 dark:text-amber-400">
          <Hammer className="h-3.5 w-3.5" />
          {t("comingSoonHint")}
        </div>
        <Button variant="outline" size="sm" onClick={onOpenMenu} className="gap-1.5">
          <LayoutDashboard className="h-3.5 w-3.5" />
          {t("backToMenu")}
        </Button>
      </div>
    </div>
  );
}

/**
 * VisualizationGrid — page "Couverture vaccinale".
 *
 * Structure alignée sur l'outil de revue de données du PEV (Power BI) :
 *   1. Barre de filtres analyste (Province → ZS → Aire de santé → FOSA,
 *      jeu de données, période/année) — filtres partagés entre pages via
 *      le store useDashboardFilters (cf. règle "Filtres communs").
 *   2. KPI cards (dernière valeur + tendance par indicateur).
 *   3. Courbe d'évolution mensuelle + histogramme (couverture par antigène).
 *   4. Tableau détaillé + carte choroplèthe RDC.
 *
 * Données : analyse IA active si disponible ; sinon le hook partagé
 * useMultiIndicatorAnalytics (snapshot ETL d'abord, DHIS2 live en dernier
 * recours). La courbe et l'histogramme lisent la série de l'unité
 * sélectionnée ; le tableau et la carte lisent ses enfants directs.
 */
const DEFAULT_ORG_UNIT = "ymGeqzoPhN3"; // RDC (national)
const DEFAULT_ANTIGEN_ID = "v9b9aYsA5PM"; // Penta3

const DEFAULT_FILTER: Dhis2FilterState = {
  orgUnitId: DEFAULT_ORG_UNIT,
  orgUnitLevel: 1,
  dataSetId: null,
  periodPreset: "LAST_12_MONTHS",
  antigeId: DEFAULT_ANTIGEN_ID,
};

function isDefaultFilter(filter: Dhis2FilterState): boolean {
  return (
    filter.orgUnitId === DEFAULT_FILTER.orgUnitId &&
    filter.orgUnitLevel === DEFAULT_FILTER.orgUnitLevel &&
    filter.dataSetId === DEFAULT_FILTER.dataSetId &&
    filter.periodPreset === DEFAULT_FILTER.periodPreset &&
    (filter.antigeId ?? DEFAULT_ANTIGEN_ID) === DEFAULT_ANTIGEN_ID
  );
}

interface VisualizationGridProps {
  analysis: Dhis2AnalysisResult | null;
}

function VisualizationGrid({ analysis }: VisualizationGridProps) {
  const t = useTranslations("explorer");
  const { filter, setFilter, resetFilters } = useDashboardFilters();
  const describeSource = useDescribeSource();
  const analysisResult = analysis?.analytics ?? null;

  const indicatorIds = useMemo(() => [filter.antigeId ?? DEFAULT_ANTIGEN_ID], [filter.antigeId]);
  const analytics = useMultiIndicatorAnalytics({
    indicatorIds,
    filter,
    enabled: !analysisResult,
  });
  const { result, focus, children, loading, error, source, latestPeriod, syncedAt } = analytics;

  const seriesResult = analysisResult ?? focus ?? result;
  const breakdownResult = analysisResult ?? children ?? result;
  const isLoading = !analysisResult && loading;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      {/* Barre d'actions : source + reset */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5 text-primary" />
          <span>{analysisResult ? "DHIS2 — SNIS RDC" : describeSource(source, latestPeriod, syncedAt)}</span>
        </div>
        {!isDefaultFilter(filter) && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
            title={t("resetTitle")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t("reset")}
          </button>
        )}
      </div>

      {/* Filtres analyste : Antigène + Province → ZS → AS → FOSA, période */}
      <Dhis2FilterBar filter={filter} onChange={setFilter} showAntigen />
      {!analysisResult && <ScopeNotice filter={filter} state={analytics} />}

      {error && !seriesResult && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("loadError", { error })}</span>
        </div>
      )}

      {/* Ligne 1 : courbe (gauche) + histogramme (droite) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-stretch">
        <Dhis2TrendChart result={seriesResult} loading={isLoading} antigenId={filter.antigeId} />
        <Dhis2TrendBarChart result={seriesResult} loading={isLoading} antigenId={filter.antigeId} />
      </div>

      {/* Ligne 2 : tableau de couverture (gauche) + carte RDC Leaflet (droite) */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 xl:items-stretch">
        <CoverageTable result={breakdownResult} loading={isLoading} antigenId={filter.antigeId} />
        <Dhis2ChoroplethMap result={breakdownResult} loading={isLoading} />
      </div>
    </div>
  );
}
