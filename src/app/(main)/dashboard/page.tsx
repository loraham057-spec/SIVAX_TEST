"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PowerBIContainer } from "@/components/powerbi/powerbi-container";
import { AnalyticContent } from "@/components/dashboard/analytic-content";
import { useAnalysis } from "@/store/analysis-store";
import { useAuth } from "@/lib/auth/auth-provider";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTranslations } from "next-intl";

type TabValue = "analytic" | "powerbi";

export default function HomePage() {
  const { analysis, analysisPayload, loading, error, loadingMessage, processingStatus, clearAnalysis } = useAnalysis();
  const { user, isLoading: authLoading } = useAuth();
  const [tab, setTab] = useState<TabValue>("analytic");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const t = useTranslations("dashboard");

  if (authLoading) {
    // Show the route-level skeleton immediately instead of a bare spinner.
    // The AuthProvider is validating the session in the background; once it
    // resolves, the dashboard content renders without a flash.
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <div>
          <div className="h-8 w-48 rounded bg-muted animate-pulse" />
          <div className="mt-2 h-4 w-64 rounded bg-muted animate-pulse" />
        </div>
        <div className="space-y-4">
          <div className="h-10 w-full max-w-md rounded-lg bg-muted animate-pulse" />
          <div className="h-96 w-full rounded-xl border bg-card animate-pulse" />
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className={cn("sivax-analytics space-y-5 transition-all duration-300", isFullscreen ? "p-0 lg:p-0" : "p-5 lg:p-8")}>
      {!isFullscreen && (
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-primary"><span className="h-2 w-2 rounded-full bg-accent" /> RDC · Programme élargi de vaccination</div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-foreground sm:text-[34px]">{t("title")}</h1>
          <p className="mt-2 max-w-3xl text-[15px] leading-6 text-muted-foreground sm:text-base">
            {t("subtitle")}
          </p>
        </div>
      )}

      <div className={cn("space-y-4", isFullscreen && "space-y-0")}>
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
          {/* Tab switcher hidden in fullscreen, but tabs stay mounted so the
              container keeps its internal fullscreen state. */}
          <TabsList className={cn("h-12 rounded-xl border border-border/80 bg-white/80 p-1 shadow-sm dark:bg-card", isFullscreen && "hidden")}>
            <TabsTrigger value="analytic" className="h-10 rounded-lg px-4 text-sm font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm sm:text-[15px]">{t("tabAnalytic")}</TabsTrigger>
            <TabsTrigger value="powerbi" className="h-10 rounded-lg px-4 text-sm font-bold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm sm:text-[15px]">{t("tabPowerbi")}</TabsTrigger>
          </TabsList>

          {/* Tab 1: DHIS2 Analytics In-App — contains the 4 decision spaces as sub-tabs */}
          <TabsContent value="analytic" className={cn(isFullscreen && "mt-0")}>
            <AnalyticContent
              analysis={analysis}
              analysisPayload={analysisPayload}
              analysisLoading={loading}
              analysisError={error}
              loadingMessage={loadingMessage}
              processingStatus={processingStatus}
              onClearAnalysis={clearAnalysis}
              onFullscreenChange={setIsFullscreen}
            />
          </TabsContent>

          {/* Tab 2: Power BI Embedded Report */}
          <TabsContent value="powerbi" className={cn(isFullscreen && "mt-0")}>
            <PowerBIContainer
              mode="powerbi"
              title={t("tabPowerbi")}
              reportId="vaccination-coverage-2026"
              onFullscreenChange={setIsFullscreen}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
