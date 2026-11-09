"use client";

/**
 * Page 8 — Gestion PEV & Supervision
 *
 *   1. KPI : réalisation des séances (B 8.3), exécution des supervisions et
 *      rétro-information (F 1.4, rapport BCZ), % supervisions ECZS
 *   2. Évolution des taux + séances prévues vs réalisées
 *   3. Tableau par unité enfant
 * PAO et actions correctives ne sont pas collectés dans le SNIS.
 */

import { useMemo } from "react";
import { CalendarCheck, CheckSquare, ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { Dhis2KpiGrid } from "@/components/dhis2/dhis2-kpi-grid";
import {
  ChildrenTable,
  MultiTrendChart,
  PageHeader,
  ScopeNotice,
  SourceBar,
  UnavailableCard,
  useDescribeSource,
  usePageFilter,
  formatPercent,
  statusFromThreshold,
  useMultiIndicatorAnalytics,
} from "@/components/dashboard/pages/_shared";
import { deriveAll, pickIndicators, type DerivedSeries } from "@/lib/dhis2-analytics";

const SESSIONS_PLANNED = "s5EUr8GznWY";
const SESSIONS_DONE = "lHB57kjRtUz";
const SUP_PLANNED = "BqD7WfEaOGL";
const SUP_DONE = "wPhEOPs1VSw";
const SUP_FEEDBACK = "R5aQwR80b73";
const SUP_ECZS = "P7YP5utRNC7";
const MANAGEMENT_INDICATORS = [SESSIONS_PLANNED, SESSIONS_DONE, SUP_PLANNED, SUP_DONE, SUP_FEEDBACK, SUP_ECZS];

export function ManagementPage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  // Supervision data come from the BCZ report (F 1.4) and the ECZS: zone level.
  const { filter, setFilter, reset, clamped, maxLevel } = usePageFilter(3);
  const describeSource = useDescribeSource();
  const analytics = useMultiIndicatorAnalytics({
    indicatorIds: MANAGEMENT_INDICATORS,
    filter,
  });
  const { result, focus, children, loading, error, source, latestPeriod, syncedAt } = analytics;

  const specs: DerivedSeries[] = useMemo(() => [
    { id: "sessions", name: tPages("management.sessionsRate"), num: [SESSIONS_DONE], den: [SESSIONS_PLANNED], factor: 100 },
    { id: "supervision", name: tPages("management.supervisionRate"), num: [SUP_DONE], den: [SUP_PLANNED], factor: 100 },
    { id: "feedback", name: tPages("management.feedbackRate"), num: [SUP_FEEDBACK], den: [SUP_DONE], factor: 100 },
    { id: "eczs", name: tPages("management.eczsRate"), num: [SUP_ECZS] },
  ], [tPages]);

  const focusDerived = useMemo(() => deriveAll(focus, specs), [focus, specs]);
  const childrenDerived = useMemo(() => deriveAll(children ?? result, specs), [children, result, specs]);
  const sessionsTrend = useMemo(() => pickIndicators(focus, [SESSIONS_PLANNED, SESSIONS_DONE]), [focus]);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={ClipboardList}
        accent="bg-rose-500/10 text-rose-600 dark:text-rose-400"
        title={t("pages.management.title")}
        description={t("pages.management.description")}
      />

      <SourceBar source={describeSource(source, latestPeriod, syncedAt)} onReset={reset} resetLabel={tPages("reset")} />
      <Dhis2FilterBar filter={filter} onChange={setFilter} maxLevel={maxLevel} />
      <ScopeNotice filter={filter} state={analytics} clamped={clamped} maxLevel={maxLevel} />

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>}

      <Dhis2KpiGrid result={focusDerived} loading={loading} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MultiTrendChart result={focusDerived} loading={loading} title={tPages("management.ratesTrend")} unit=" %" />
        <MultiTrendChart result={sessionsTrend} loading={loading} title={tPages("management.sessionsTrend")} />
      </div>

      <ChildrenTable
        unitLabel={tPages("unit")}
        title={tPages("management.byUnit")}
        result={childrenDerived}
        excludeOrgUnit={filter.orgUnitId}
        loading={loading}
        ascending
        columns={[
          { id: "sessions", label: tPages("management.sessionsRate"), format: formatPercent, status: (v) => statusFromThreshold(v, { warning: 80, target: 90 }) },
          { id: "supervision", label: tPages("management.supervisionRate"), format: formatPercent, status: (v) => statusFromThreshold(v, { warning: 60, target: 80 }) },
          { id: "feedback", label: tPages("management.feedbackRate"), format: formatPercent },
          { id: "eczs", label: tPages("management.eczsRate"), format: formatPercent },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <UnavailableCard icon={CalendarCheck} title={tPages("management.aopTitle")} message={tPages("management.aopUnavailable")} />
        <UnavailableCard icon={CheckSquare} title={tPages("management.correctiveTitle")} message={tPages("management.correctiveUnavailable")} />
      </div>
    </div>
  );
}
