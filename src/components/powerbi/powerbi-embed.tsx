"use client";

/**
 * Power BI Embed — composant client qui initialise powerbi-client.
 *
 * Remplace l'iframe cross-origin par un embed contrôlable via le SDK
 * JavaScript officiel de Power BI. L'instance `report` est exposée
 * via un callback pour que le parent (PowerBIContainer) et le store
 * puissent l'utiliser pour les commandes de l'agent IA.
 *
 * powerbi-client est chargé dynamiquement (côté navigateur uniquement)
 * car il dépend de `window` / `self` qui n'existent pas en SSR.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { PowerBIEmbedConfig } from "@/lib/powerbi/types";
import { powerbiService } from "@/services";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

// Type minimal pour l'instance report (powerbi-client est chargé dynamiquement)
export interface PowerBIReportInstance {
  getPages(): Promise<
    Array<{ name: string; displayName: string; isActive: boolean }>
  >;
  getFilters(): Promise<unknown[]>;
  setFilters(filters: unknown[]): Promise<void>;
  removeFilters(tableName?: string): Promise<void>;
  setActive(): Promise<void>;
  bookmarks?: {
    getBookmarks(): Promise<Array<{ name: string; displayName: string }>>;
    apply(name: string): Promise<void>;
  };
  on(eventName: string, handler: (event: unknown) => void): void;
  off(eventName: string, handler: (event: unknown) => void): void;
  reload(): Promise<void>;
  print(): Promise<void>;
  fullscreen(): void;
  exitFullscreen(): void;
}

interface PowerBIEmbedProps {
  /** ID du rapport à embed (optionnel — défaut: POWERBI_REPORT_ID) */
  reportId?: string;
  /** Callback appelé quand l'instance report est prête */
  onReportReady?: (report: PowerBIReportInstance) => void;
  /** Callback appelé en cas d'erreur */
  onError?: (error: string) => void;
  /** Callback appelé pendant le chargement */
  onLoadingChange?: (loading: boolean) => void;
  /** Classe CSS additionnelle */
  className?: string;
}

export function PowerBIEmbed({
  reportId,
  onReportReady,
  onError,
  onLoadingChange,
  className,
}: PowerBIEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reportRef = useRef<PowerBIReportInstance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("container");

  const notifyLoading = useCallback(
    (isLoading: boolean) => {
      setLoading(isLoading);
      onLoadingChange?.(isLoading);
    },
    [onLoadingChange],
  );

  const notifyError = useCallback(
    (err: string) => {
      setError(err);
      onError?.(err);
    },
    [onError],
  );

  useEffect(() => {
    let cancelled = false;

    async function embedReport() {
      if (!containerRef.current) return;

      notifyLoading(true);
      setError(null);

      try {
        // 1. Récupérer la config d'embed (embedUrl + embedToken) depuis l'API
        const config: PowerBIEmbedConfig =
          await powerbiService.getEmbedConfig(reportId);

        if (cancelled) return;

        // 2. Charger powerbi-client dynamiquement (côté navigateur uniquement)
        const PowerBI = await import("powerbi-client");
        const powerbi = new PowerBI.service.Service(
          PowerBI.factories.hpmFactory,
          PowerBI.factories.wpmpFactory,
          PowerBI.factories.routerFactory,
        );

        if (cancelled) {
          if (containerRef.current) powerbi.reset(containerRef.current);
          return;
        }

        // 3. Configuration de l'embed
        const embedConfiguration = {
          type: "report" as const,
          id: config.reportId,
          embedUrl: config.embedUrl,
          accessToken: config.embedToken,
          tokenType: 1, // TokenType.Embed
          settings: {
            filterPaneEnabled: true,
            navContentPaneEnabled: true,
            background: 0, // BackgroundType.Transparent
          },
        };

        // 4. Embed le rapport dans le container
        const report = powerbi.embed(
          containerRef.current,
          embedConfiguration,
        ) as unknown as PowerBIReportInstance;

        reportRef.current = report;

        // 5. Écouter l'événement "loaded"
        const loadedHandler = () => {
          if (!cancelled) {
            notifyLoading(false);
            onReportReady?.(report);
          }
        };
        report.on("loaded", loadedHandler);

        // 6. Écouter les erreurs
        const errorHandler = (event: unknown) => {
          const evt = event as { detail?: { message?: string } };
          const msg = evt?.detail?.message ?? "Erreur Power BI";
          if (!cancelled) {
            notifyError(msg);
          }
        };
        report.on("error", errorHandler);

        // Cleanup
        return () => {
          report.off("loaded", loadedHandler);
          report.off("error", errorHandler);
          if (containerRef.current) powerbi.reset(containerRef.current);
          reportRef.current = null;
        };
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Failed to embed Power BI report";
          notifyError(msg);
          notifyLoading(false);
        }
      }
    }

    const cleanupPromise = embedReport();

    return () => {
      cancelled = true;
      cleanupPromise?.then((cleanup) => cleanup?.());
    };
  }, [reportId, onReportReady, onError, notifyLoading, notifyError]);

  return (
    <div className={className} style={{ height: "100%", width: "100%" }}>
      {loading && (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          <div className="w-full max-w-4xl space-y-4">
            <Skeleton className="h-8 w-48" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
            <Skeleton className="h-[400px] w-full rounded-lg" />
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <AlertCircle className="h-10 w-10 text-destructive" />
          <div>
            <p className="text-sm font-medium">{t("loadFailed")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{error}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              notifyLoading(true);
              // Re-trigger embed by reloading the component
              window.location.reload();
            }}
          >
            {t("retry")}
          </Button>
        </div>
      )}

      {/* Container div pour powerbi-client — doit toujours être rendu */}
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ display: loading || error ? "none" : "block" }}
      />
    </div>
  );
}
