"use client";

/**
 * Page 4 — Chaîne d'approvisionnement & Stock
 *
 * Source : SIGL ESS 2025 (le rapport PEV a perdu sa section stock B 6.1 en
 * 2025). Pour l'antigène sélectionné :
 *   1. KPI : % FOSA en rupture (antigène / au moins un vaccin), mois de stock,
 *      remplissage du stock max
 *   2. Évolution des ruptures + stock disponible vs consommation
 *   3. Situation par unité enfant et par antigène
 * Le « % FOSA en rupture » compte les établissements (niveau 5) ayant déclaré
 * au moins un jour de rupture de l'antigène, rapporté aux établissements qui
 * gèrent cet antigène (CMM ou rupture déclarée, `STOCKOUT_BASE.<DE>`). Les
 * rapports SIGL reçus ne conviennent pas : SIGL couvre aussi des structures
 * qui ne vaccinent pas, ce qui diluait le taux (Kinshasa : 0,3 % au lieu de 0,9 %).
 */

import { useMemo, useState } from "react";
import { Boxes, CalendarClock, Syringe } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { Dhis2KpiGrid } from "@/components/dhis2/dhis2-kpi-grid";
import { Dhis2ChoroplethMap } from "@/components/dhis2/dhis2-choropleth-map";
import {
  ChildrenTable,
  FilterDropdown,
  MultiTrendChart,
  PageHeader,
  ScopeNotice,
  SectionCard,
  SourceBar,
  UnavailableCard,
  useDescribeSource,
  usePageFilter,
  formatPercent,
  statusFromThreshold,
  useMultiIndicatorAnalytics,
} from "@/components/dashboard/pages/_shared";
import { deriveAll, latestByOrgUnit, pickIndicators, type DerivedSeries } from "@/lib/dhis2-analytics";
import { formatDhis2PeriodRange } from "@/lib/dhis2-format";
import { PEV_THRESHOLDS } from "@/lib/pev/thresholds";
import { SIGL_COC, SIGL_VACCINES } from "@/lib/pev/sigl";
import { cn } from "@/lib/utils";

const VACCINES = SIGL_VACCINES;
const { SDU, CMM, MAX } = SIGL_COC;
const STOCKOUT_ANY = "STOCKOUT_FOSA.ANY";
const BASE_ANY = "STOCKOUT_BASE.ANY";
const stockout = (de: string) => `STOCKOUT_FOSA.${de}`;
const base = (de: string) => `STOCKOUT_BASE.${de}`;

const SUPPLY_INDICATORS = [
  ...VACCINES.flatMap((v) => [`${v.id}.${SDU}`, `${v.id}.${CMM}`, `${v.id}.${MAX}`, stockout(v.id), base(v.id)]),
  STOCKOUT_ANY,
  BASE_ANY,
];

const STOCKOUT_THRESHOLD = PEV_THRESHOLDS.stockout;
const MOS_STATUS = (v: number) => (v < 1 ? "critical" : v < 2 ? "warning" : v > 6 ? "warning" : "good");
const STOCKOUT_STATUS = (v: number) => statusFromThreshold(v, STOCKOUT_THRESHOLD, false);

export function SupplyPage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  // Facility stock-out counts are aggregated by the ETL up to the zone only.
  const { filter, setFilter, reset, clamped, maxLevel } = usePageFilter(3);
  const describeSource = useDescribeSource();
  const [antigenId, setAntigenId] = useState(VACCINES[1].id);
  const antigen = VACCINES.find((v) => v.id === antigenId) ?? VACCINES[1];

  const analytics = useMultiIndicatorAnalytics({
    indicatorIds: SUPPLY_INDICATORS,
    filter,
  });
  const { result, focus, children, loading, error, source, latestPeriod, syncedAt } = analytics;

  const specs: DerivedSeries[] = useMemo(() => [
    { id: "pct", name: tPages("supply.stockoutPct", { antigen: antigen.name }), num: [stockout(antigen.id)], den: [base(antigen.id)], factor: 100 },
    { id: "pctAny", name: tPages("supply.stockoutAny"), num: [STOCKOUT_ANY], den: [BASE_ANY], factor: 100 },
    { id: "mos", name: tPages("supply.monthsOfStock", { antigen: antigen.name }), num: [`${antigen.id}.${SDU}`], den: [`${antigen.id}.${CMM}`] },
    { id: "fill", name: tPages("supply.maxFill", { antigen: antigen.name }), num: [`${antigen.id}.${SDU}`], den: [`${antigen.id}.${MAX}`], factor: 100 },
  ], [antigen, tPages]);

  const focusDerived = useMemo(() => deriveAll(focus, specs), [focus, specs]);
  const childrenDerived = useMemo(() => deriveAll(children ?? result, specs), [children, result, specs]);
  const stockoutTrend = useMemo(() => pickIndicators(focusDerived, ["pct", "pctAny"]), [focusDerived]);
  const stockTrend = useMemo(() => pickIndicators(focus, [`${antigen.id}.${SDU}`, `${antigen.id}.${CMM}`]), [focus, antigen]);
  const mapResult = useMemo(() => pickIndicators(childrenDerived, ["pct"]), [childrenDerived]);
  const national = filter.orgUnitLevel === 1;
  const mapPeriod = useMemo(() => {
    const periods = [...new Set(latestByOrgUnit(mapResult, "pct", { exclude: [filter.orgUnitId] }).map((l) => l.period))].sort();
    return periods.length ? formatDhis2PeriodRange(periods[0], periods[periods.length - 1]) : undefined;
  }, [mapResult, filter.orgUnitId]);

  // Selected unit: latest complete month per antigen.
  const byAntigen = useMemo(() => VACCINES.map((v) => {
    const derived = deriveAll(focus, [
      { id: "mos", name: "", num: [`${v.id}.${SDU}`], den: [`${v.id}.${CMM}`] },
      { id: "pct", name: "", num: [stockout(v.id)], den: [base(v.id)], factor: 100 },
    ]);
    const mos = latestByOrgUnit(derived, "mos")[0];
    const pct = latestByOrgUnit(derived, "pct")[0];
    return { ...v, mos: mos?.value, pct: pct?.value, period: mos?.period ?? pct?.period };
  }), [focus]);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={Boxes}
        accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        title={t("pages.supply.title")}
        description={t("pages.supply.description")}
      />

      <SourceBar source={describeSource(source, latestPeriod, syncedAt)} onReset={reset} resetLabel={tPages("reset")} />
      <Dhis2FilterBar filter={filter} onChange={setFilter} maxLevel={maxLevel}>
        <FilterDropdown
          icon={Syringe}
          label={tPages("supply.antigen")}
          options={VACCINES}
          value={antigenId}
          onChange={setAntigenId}
        />
      </Dhis2FilterBar>
      <ScopeNotice filter={filter} state={analytics} clamped={clamped} maxLevel={maxLevel} />

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>}

      <Dhis2KpiGrid result={focusDerived} loading={loading} />
      <p className="text-[11px] text-muted-foreground">{tPages("supply.sourceNote")}</p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MultiTrendChart result={stockoutTrend} loading={loading} title={tPages("supply.stockoutTrendTitle")} unit=" %" />
        <MultiTrendChart result={stockTrend} loading={loading} title={tPages("supply.stockVsConsumption", { antigen: antigen.name })} />
      </div>

      <div className={cn("grid grid-cols-1 gap-4", national && "xl:grid-cols-2")}>
        <ChildrenTable
        unitLabel={tPages("unit")}
          title={tPages("supply.byUnit", { antigen: antigen.name })}
          result={childrenDerived}
          excludeOrgUnit={filter.orgUnitId}
          loading={loading}
          columns={[
            { id: "pct", label: tPages("cols.stockoutPct"), format: formatPercent, status: STOCKOUT_STATUS },
            { id: "mos", label: tPages("cols.monthsOfStock"), format: (v) => v.toFixed(1), status: MOS_STATUS },
            { id: "fill", label: tPages("cols.maxFill"), format: formatPercent },
          ]}
        />
        {/* The base map only has provinces. */}
        {national && (
          <SectionCard title={tPages("supply.stockoutMapTitle", { antigen: antigen.name })} subtitle={mapPeriod}>
            <div className="h-[360px]">
              <Dhis2ChoroplethMap result={mapResult} loading={loading} status={STOCKOUT_STATUS} hideHeader />
            </div>
          </SectionCard>
        )}
      </div>

      <SectionCard title={tPages("supply.byAntigen")}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{tPages("supply.antigen")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("cols.stockoutPct")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("cols.monthsOfStock")}</th>
              </tr>
            </thead>
            <tbody>
              {byAntigen.map((r) => {
                const pctStatus = r.pct === undefined ? null : STOCKOUT_STATUS(r.pct);
                const mosStatus = r.mos === undefined ? null : MOS_STATUS(r.mos);
                const color = (s: string | null) => s === "good" ? "text-emerald-600" : s === "warning" ? "text-amber-600" : s === "critical" ? "font-medium text-rose-600" : "";
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{r.name}</td>
                    <td className={cn("py-2 pr-4", color(pctStatus))}>{r.pct === undefined ? "—" : formatPercent(r.pct)}</td>
                    <td className={cn("py-2 pr-4", color(mosStatus))}>{r.mos === undefined ? "—" : r.mos.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <UnavailableCard icon={CalendarClock} title={tPages("supply.expiryTitle")} message={tPages("supply.expiryUnavailable")} />
    </div>
  );
}
