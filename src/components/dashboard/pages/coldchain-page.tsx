"use client";

/**
 * Page 5 — Chaîne du froid & Équipements
 *
 * Le SNIS ne collecte ni températures ni pannes. Affiche ce qui existe :
 * frigos et congélateurs déclarés par les BCZ (F 2.4) et % de CS disposant
 * d'au moins 4 accumulateurs. A 4.3 (jours de non-fonctionnement frigo) est
 * volontairement exclu : ses valeurs sont incohérentes.
 */

import { useMemo } from "react";
import { ThermometerSnowflake, ThermometerSun, Wrench } from "lucide-react";
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
  useMultiIndicatorAnalytics,
} from "@/components/dashboard/pages/_shared";
import { pickIndicators } from "@/lib/dhis2-analytics";

const FRIDGES = "gMJT9WyszD4";
const FREEZERS = "aVGXisHECwk";
const ICE_PACKS = "KeVd89m64zV";
const COLDCHAIN_INDICATORS = [FRIDGES, FREEZERS, ICE_PACKS];

export function ColdChainPage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  // Equipment is declared by the BCZ (F 2.4): nothing below the health zone.
  const { filter, setFilter, reset, clamped, maxLevel } = usePageFilter(3);
  const describeSource = useDescribeSource();
  const analytics = useMultiIndicatorAnalytics({
    indicatorIds: COLDCHAIN_INDICATORS,
    filter,
  });
  const { result, focus, children, loading, error, source, latestPeriod, syncedAt } = analytics;
  const equipmentTrend = useMemo(() => pickIndicators(focus, [FRIDGES, FREEZERS]), [focus]);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={ThermometerSnowflake}
        accent="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
        title={t("pages.coldchain.title")}
        description={t("pages.coldchain.description")}
      />

      <SourceBar source={describeSource(source, latestPeriod, syncedAt)} onReset={reset} resetLabel={tPages("reset")} />
      <Dhis2FilterBar filter={filter} onChange={setFilter} maxLevel={maxLevel} />
      <ScopeNotice filter={filter} state={analytics} clamped={clamped} maxLevel={maxLevel} />

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>}

      <Dhis2KpiGrid result={focus} loading={loading} />
      <p className="text-[11px] text-muted-foreground">{tPages("coldchain.sourceNote")}</p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MultiTrendChart result={equipmentTrend} loading={loading} title={tPages("coldchain.trend")} />
        <ChildrenTable
        unitLabel={tPages("unit")}
          title={tPages("coldchain.byUnit")}
          result={children ?? result}
          excludeOrgUnit={filter.orgUnitId}
          loading={loading}
          columns={[
            { id: FRIDGES, label: tPages("cols.fridges") },
            { id: FREEZERS, label: tPages("cols.freezers") },
            { id: ICE_PACKS, label: tPages("cols.icePacks"), format: formatPercent },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <UnavailableCard icon={ThermometerSun} title={tPages("coldchain.tempTitle")} message={tPages("coldchain.tempUnavailable")} />
        <UnavailableCard icon={Wrench} title={tPages("coldchain.breakdownTitle")} message={tPages("coldchain.breakdownUnavailable")} />
      </div>
    </div>
  );
}
