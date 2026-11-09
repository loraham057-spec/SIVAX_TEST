"use client";

/**
 * Page 7 — Qualité des données
 *
 *   1. KPI : complétude/promptitude natives DHIS2 (rapport PEV B 2025, SIGL,
 *      eSurveillance hebdomadaire)
 *   2. Évolution de la complétude et de la promptitude par source
 *   3. Cohérence : doses Penta SIGL ÷ doses Penta 1+2+3 du rapport PEV
 *   4. Anomalies : couverture Penta3 > 100 %, Penta3 > Penta1
 *   5. Tableau par unité enfant
 */

import { useMemo } from "react";
import { ClipboardCheck, DatabaseZap, GitCompareArrows } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { Dhis2KpiGrid } from "@/components/dhis2/dhis2-kpi-grid";
import {
  ChildrenTable,
  MultiTrendChart,
  PageHeader,
  ScopeNotice,
  SectionCard,
  SourceBar,
  StatCard,
  UnavailableCard,
  useDescribeSource,
  usePageFilter,
  formatPercent,
  statusFromThreshold,
  useMultiIndicatorAnalytics,
} from "@/components/dashboard/pages/_shared";
import { deriveSeries, latestByOrgUnit, mergeResults, pickIndicators } from "@/lib/dhis2-analytics";
import { formatDhis2PeriodShort } from "@/lib/dhis2-format";

const PEV_RR = "E4BX1ea2iDJ.REPORTING_RATE";
const PEV_OT = "E4BX1ea2iDJ.REPORTING_RATE_ON_TIME";
const A_RR = "ahT7ysZZ913.REPORTING_RATE";
const A_OT = "ahT7ysZZ913.REPORTING_RATE_ON_TIME";
const SIGL_RR = "DxDuYrrZSa7.REPORTING_RATE";
const SIGL_OT = "DxDuYrrZSa7.REPORTING_RATE_ON_TIME";
const SURV_RR = "YCYOKxjY2vk.REPORTING_RATE";
const SURV_OT = "YCYOKxjY2vk.REPORTING_RATE_ON_TIME";
const SIGL_PENTA_ADMIN = "uAWIVDnGPGH.dxDQKDcTn6Z";
const PENTA_DOSES = ["uNdFg1eymsa", "YYKXOc7xBUi", "WWxqaHSeiwd"];
const PENTA1_COV = "k26tJ22Ncpd";
const PENTA3_COV = "v9b9aYsA5PM";

const DQ_INDICATORS = [
  PEV_RR, PEV_OT, SIGL_RR, SURV_RR, A_RR, A_OT, SIGL_OT, SURV_OT,
  SIGL_PENTA_ADMIN, ...PENTA_DOSES, PENTA1_COV, PENTA3_COV,
];
const COMPLETENESS = { warning: 80, target: 90 };

export function DataQualityPage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  // A single FOSA's reporting rate is 0 or 100 % and has no children to audit.
  const { filter, setFilter, reset, clamped, maxLevel } = usePageFilter(4);
  const describeSource = useDescribeSource();
  const analytics = useMultiIndicatorAnalytics({
    indicatorIds: DQ_INDICATORS,
    filter,
  });
  const { result, focus, children, loading, error, source, latestPeriod, syncedAt } = analytics;

  const coherenceSpec = useMemo(() => ({
    id: "coherence", name: tPages("dataquality.coherence"), num: [SIGL_PENTA_ADMIN], den: PENTA_DOSES, factor: 100,
  }), [tPages]);

  const kpis = useMemo(() => pickIndicators(focus, [PEV_RR, PEV_OT, SIGL_RR, SURV_RR]), [focus]);
  const completenessTrend = useMemo(() => pickIndicators(focus, [PEV_RR, A_RR, SIGL_RR, SURV_RR]), [focus]);
  const timelinessTrend = useMemo(() => pickIndicators(focus, [PEV_OT, A_OT, SIGL_OT, SURV_OT]), [focus]);
  const coherenceFocus = useMemo(() => deriveSeries(focus, coherenceSpec), [focus, coherenceSpec]);
  const breakdown = children ?? result;
  const childrenWithCoherence = useMemo(
    () => mergeResults([breakdown, deriveSeries(breakdown, coherenceSpec)]),
    [breakdown, coherenceSpec],
  );

  const coherenceLatest = latestByOrgUnit(coherenceFocus, "coherence")[0];
  const coherenceGap = coherenceLatest ? Math.abs(coherenceLatest.value - 100) : null;

  const anomalies = useMemo(() => {
    const p1 = new Map(latestByOrgUnit(breakdown, PENTA1_COV, { exclude: [filter.orgUnitId] }).map((l) => [l.ouId, l]));
    const p3 = latestByOrgUnit(breakdown, PENTA3_COV, { exclude: [filter.orgUnitId] });
    return {
      over100: p3.filter((l) => l.value > 100),
      p3gtp1: p3.filter((l) => {
        const first = p1.get(l.ouId);
        return first && first.period === l.period && l.value > first.value;
      }),
    };
  }, [breakdown, filter.orgUnitId]);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={DatabaseZap}
        accent="bg-purple-500/10 text-purple-600 dark:text-purple-400"
        title={t("pages.dataquality.title")}
        description={t("pages.dataquality.description")}
      />

      <SourceBar source={describeSource(source, latestPeriod, syncedAt)} onReset={reset} resetLabel={tPages("reset")} />
      <Dhis2FilterBar filter={filter} onChange={setFilter} maxLevel={maxLevel} />
      <ScopeNotice filter={filter} state={analytics} clamped={clamped} maxLevel={maxLevel} />

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>}

      <Dhis2KpiGrid result={kpis} loading={loading} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MultiTrendChart result={completenessTrend} loading={loading} title={tPages("dataquality.completenessTrend")} unit=" %" />
        <MultiTrendChart result={timelinessTrend} loading={loading} title={tPages("dataquality.timelinessTrend")} unit=" %" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <StatCard
          icon={GitCompareArrows}
          loading={loading}
          label={tPages("dataquality.coherence")}
          value={coherenceLatest ? formatPercent(coherenceLatest.value) : "—"}
          hint={coherenceLatest ? `${formatDhis2PeriodShort(coherenceLatest.period)} — ${tPages("dataquality.coherenceNote")}` : tPages("dataquality.coherenceNote")}
          status={coherenceGap === null ? null : coherenceGap <= 5 ? "good" : coherenceGap <= 15 ? "warning" : "critical"}
        />
        <SectionCard title={tPages("dataquality.anomalies")} className="xl:col-span-2">
          <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
            {([
              [tPages("dataquality.over100"), anomalies.over100],
              [tPages("dataquality.p3gtp1"), anomalies.p3gtp1],
            ] as const).map(([label, list]) => (
              <div key={label}>
                <p className="font-medium">{label} : <span className={list.length ? "text-rose-600" : "text-emerald-600"}>{list.length}</span></p>
                <p className="mt-1 text-muted-foreground">
                  {list.length === 0 ? tPages("dataquality.none") : list.slice(0, 12).map((l) => `${l.name} (${l.value.toFixed(1)} %)`).join(", ")}
                  {list.length > 12 && "…"}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <MultiTrendChart result={coherenceFocus} loading={loading} title={tPages("dataquality.coherence")} unit=" %" />

      <ChildrenTable
        unitLabel={tPages("unit")}
        title={tPages("dataquality.byUnit")}
        result={childrenWithCoherence}
        excludeOrgUnit={filter.orgUnitId}
        loading={loading}
        ascending
        columns={[
          { id: PEV_RR, label: tPages("cols.completenessPev"), format: formatPercent, status: (v) => statusFromThreshold(v, COMPLETENESS) },
          { id: PEV_OT, label: tPages("cols.timelinessPev"), format: formatPercent, status: (v) => statusFromThreshold(v, { warning: 70, target: 80 }) },
          { id: SIGL_RR, label: tPages("cols.completenessSigl"), format: formatPercent, status: (v) => statusFromThreshold(v, COMPLETENESS) },
          { id: SURV_RR, label: tPages("cols.completenessSurv"), format: formatPercent, status: (v) => statusFromThreshold(v, COMPLETENESS) },
          { id: "coherence", label: tPages("cols.coherence"), format: formatPercent, status: (v) => (Math.abs(v - 100) <= 5 ? "good" : Math.abs(v - 100) <= 15 ? "warning" : "critical") },
        ]}
      />

      <UnavailableCard icon={ClipboardCheck} title={tPages("dataquality.dqaTitle")} message={tPages("dataquality.dqaUnavailable")} />
    </div>
  );
}
