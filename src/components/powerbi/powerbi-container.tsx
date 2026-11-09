"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import {
  RefreshCw,
  Maximize2,
  Minimize2,
  Sparkles,
  AlertCircle,
  BarChart3,
  ArrowLeft,
  Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dhis2Explorer } from "@/components/dhis2/dhis2-explorer";
import { Dhis2AnalysisPanel } from "@/components/dhis2/dhis2-analysis-panel";
import { AnalysisRenderer } from "@/components/analysis/analysis-renderer";
import { DataProvenanceBanner } from "@/components/analysis/data-provenance-banner";
import { MarkdownMessage } from "@/components/assistant/markdown-message";
import { PowerBIEmbed } from "@/components/powerbi/powerbi-embed";
import { PowerBIPublicIframe, getPowerBIPublicUrl } from "@/components/powerbi/powerbi-public-iframe";
import { usePowerBIStore } from "@/store/powerbi-store";
import { usePowerBICommands } from "@/lib/powerbi/use-powerbi-commands";
import type { Dhis2AnalysisResult, AnalysisPayload } from "@/types";
import { useAssistant } from "@/store/assistant-store";
import { useAgent } from "@/lib/agent/agent-provider";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AIProcessingStatus } from "@/lib/ai-processing";

type DashboardMode = "powerbi" | "analytic";

interface DashboardContainerProps {
  mode: DashboardMode;
  title: string;
  reportId?: string;
  embedUrl?: string;
  className?: string;
  onFullscreenChange?: (fullscreen: boolean) => void;
  /** Résultat d'analyse IA à afficher dans la zone de contenu (au lieu du contenu par défaut). */
  analysis?: Dhis2AnalysisResult | null;
  /** Analysis payload from the Decision Intelligence agent (structured data for rendering). */
  analysisPayload?: AnalysisPayload | null;
  analysisLoading?: boolean;
  analysisError?: string | null;
  /** Message de chargement dynamique basé sur la nature du prompt. */
  loadingMessage?: string;
  /** Statut fonctionnel du pipeline IA pour l'animation de progression. */
  processingStatus?: AIProcessingStatus | null;
  /** Fonction pour effacer l'analyse IA et revenir au contenu par défaut. */
  onClearAnalysis?: () => void;
  /** Contenu personnalisé à afficher dans la zone de contenu quand il n'y a pas d'analyse IA (ex: sous-tabs décisionnels). */
  children?: ReactNode;
  /** Contenu centré affiché dans la barre d'outils (ex: sous-tabs Welcome/Visualization). */
  toolbarCenter?: ReactNode;
  /** Actions supplémentaires affichées à droite, avant le bouton Rafraîchir (ex: menu des pages). */
  toolbarActions?: ReactNode;
}

export function PowerBIContainer({
  mode,
  title,
  reportId = "placeholder-report",
  className,
  onFullscreenChange,
  analysis = null,
  analysisPayload = null,
  analysisLoading = false,
  analysisError = null,
  loadingMessage,
  processingStatus,
  onClearAnalysis,
  children,
  toolbarCenter,
  toolbarActions,
}: DashboardContainerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Approche transitoire : iframe "Publier sur le web". Vide/"off" => PowerBIEmbed (Azure).
  const publicUrl = mode === "powerbi" ? getPowerBIPublicUrl() : null;
  const [iframeKey, setIframeKey] = useState(0);
  const { open: openAssistant } = useAssistant();
  const { register } = useAgent();
  const { setReport, report } = usePowerBIStore();
  const t = useTranslations("container");
  const tAnalysis = useTranslations("analysis");

  // Enregistrer les commandes Power BI auprès de l'agent (mode powerbi uniquement)
  usePowerBICommands();

  // Une analyse IA est-elle actuellement affichée (résultat, chargement ou erreur) ?
  const hasAiResult = analysis !== null || analysisPayload !== null || analysisLoading || analysisError !== null;

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timer);
  }, [mode]);

  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setHasError(false);
    if (publicUrl) {
      // Iframe mode — remount the iframe to reload the public report
      setIframeKey((k) => k + 1);
    } else if (report) {
      report.reload().then(() => setIsLoading(false)).catch(() => {
        setHasError(true);
        setIsLoading(false);
      });
    } else {
      // Analytic mode or no report — simulate refresh
      setTimeout(() => setIsLoading(false), 1500);
    }
  }, [report, publicUrl]);

  const handleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      setTimeout(() => onFullscreenChange?.(next), 0);
      return next;
    });
  }, [onFullscreenChange]);

  useEffect(() => {
    return register("toggle_fullscreen", (args) => {
      const enabled = args.enabled;
      if (typeof enabled === "boolean") {
        setIsFullscreen(enabled);
        onFullscreenChange?.(enabled);
      } else {
        setIsFullscreen((prev) => {
          onFullscreenChange?.(!prev);
          return !prev;
        });
      }
    });
  }, [register, onFullscreenChange]);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_12px_32px_rgba(23,43,77,0.07)] transition-all duration-300",
        isFullscreen
          ? "-mt-[72px] h-screen pt-[72px]"
          : "h-[calc(100vh-250px)] min-h-[520px]",
        className
      )}
    >
      {/* Toolbar */}
      <div className="flex min-h-[60px] items-center justify-between gap-3 border-b border-border/80 bg-card px-4 py-3 sm:px-5">
        {/* Left: title — hidden on mobile when sub-tabs are present */}
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("text-[15px] font-extrabold sm:hidden", toolbarCenter && "hidden")}>
            {mode === "analytic" ? "Analytics" : "Power BI"}
          </span>
          <span className="hidden text-[15px] font-extrabold sm:inline">{title}</span>
          {mode === "powerbi" && (
            <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
              · {reportId}
            </span>
          )}
        </div>

        {/* Center: sub-tabs (e.g. Welcome / Visualization) */}
        {toolbarCenter && (
          <div className="flex flex-1 items-center justify-center">
            {toolbarCenter}
          </div>
        )}

        {/* Right: actions */}
        <div className="flex items-center gap-1.5">
          {/* Custom actions (e.g. pages menu) rendered before the Refresh button */}
          {toolbarActions}

          {/* Refresh: icon-only in analytic mode, icon+text in powerbi mode */}
          <Button
            variant="outline"
            size={mode === "analytic" ? "icon" : "sm"}
            onClick={handleRefresh}
            disabled={isLoading}
            className={cn(
              "border-input bg-background hover:bg-accent",
              mode === "analytic" ? "h-8 w-8" : "gap-1.5",
            )}
            aria-label={t("refresh")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            {mode === "powerbi" && <span>{t("refresh")}</span>}
          </Button>

          {/* Fullscreen: powerbi mode always, analytic mode only on desktop */}
          {(mode === "powerbi" || (mode === "analytic" && toolbarCenter)) && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFullscreen}
              aria-label={isFullscreen ? t("exitFullscreen") : t("fullscreen")}
              className={cn(mode === "analytic" && "hidden sm:inline-flex")}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          )}
          <div className="mx-1 h-5 w-px bg-border" />
          {hasAiResult ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onClearAnalysis?.()}
              className="gap-1.5"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("backHome")}</span>
            </Button>
          ) : (
            <Button
              variant="default"
              size="sm"
              onClick={openAssistant}
              className="gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className={cn(mode === "analytic" ? "inline" : "hidden sm:inline")}>
                {t("askAi")}
              </span>
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-hidden bg-[#F4F7FB] dark:bg-background">
        {/* Résultat de l'assistant IA affiché à l'intérieur du container */}
        {(analysis !== null || analysisPayload !== null || analysisLoading || analysisError) && (
          <div className="h-full overflow-y-auto p-4">
            {/* Legacy panel (manual explorer analyses without structured payload) */}
            {(analysis !== null || analysisLoading || analysisError) && (
              <Dhis2AnalysisPanel
                analysis={analysis}
                loading={analysisLoading}
                error={analysisError}
                loadingMessage={loadingMessage}
                processingStatus={processingStatus}
              />
            )}
            {/* Single-analysis architecture: the agent's structured payload is
                the single source of truth — interpretation, cards, charts and
                tables all render from it. */}
            {analysisPayload && !analysisLoading && (
              <div className="mt-4 space-y-3">
                <DataProvenanceBanner
                  payload={analysisPayload}
                  source={analysisPayload.provenance?.source}
                />
                {analysisPayload.interpretation && (
                  <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
                    <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">{tAnalysis("interpretation")}</p>
                      <div className="mt-1 text-sm text-muted-foreground">
                        <MarkdownMessage content={analysisPayload.interpretation} />
                      </div>
                    </div>
                  </div>
                )}
                {(analysisPayload.warnings?.length ?? 0) > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="space-y-0.5">
                      {analysisPayload.warnings?.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                    </div>
                  </div>
                )}
                <AnalysisRenderer payload={analysisPayload} />
              </div>
            )}
          </div>
        )}

        {analysis === null && analysisPayload === null && !analysisLoading && !analysisError && (
          <>
            {mode === "analytic" && (children ?? <Dhis2Explorer />)}

            {mode === "powerbi" && publicUrl && (
              <PowerBIPublicIframe
                key={iframeKey}
                url={publicUrl}
                title={title}
                onLoadingChange={setIsLoading}
              />
            )}

            {mode === "powerbi" && !publicUrl && (
              <div className="relative h-full w-full overflow-hidden">
                <PowerBIEmbed
                  onReportReady={(report) => {
                    setReport(report);
                    setIsLoading(false);
                  }}
                  onError={(err) => {
                    setHasError(true);
                    setIsLoading(false);
                    console.error("[powerbi-container] Embed error:", err);
                  }}
                  onLoadingChange={setIsLoading}
                />

                {!isLoading && !hasError && !report && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                      <BarChart3 className="h-8 w-8 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{t("powerbiPlaceholder")}</p>
                      <p className="mt-1 max-w-md text-xs text-muted-foreground">
                        {t("powerbiPlaceholderDesc")}
                      </p>
                    </div>
                    <Button variant="default" size="sm" onClick={openAssistant}>
                      <Sparkles className="h-3.5 w-3.5" />
                      {t("askAi")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
