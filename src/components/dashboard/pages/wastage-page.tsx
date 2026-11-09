"use client";

/**
 * Page 6 — Pertes, Consommation & Déchets
 *
 * Source : SIGL ESS 2025. Pour l'antigène sélectionné :
 *   1. KPI : taux de perte de l'antigène, taux global tous vaccins, doses
 *      utilisées et administrées (dernier mois complet)
 *   2. Évolution du taux de perte + doses utilisées vs administrées
 *   3. Situation par unité enfant (+ carte des provinces au niveau national)
 *   4. Taux de perte de chaque antigène pour l'unité sélectionnée
 *
 * Taux de perte = (doses utilisées − doses administrées) ÷ doses utilisées,
 * la formule des indicateurs DHIS2 « LMIS <vaccin> (Taux de perte) » ; le
 * taux global YM7Tmn01ieL est la même formule sommée sur tous les vaccins.
 * Les seuils dépendent de la présentation (taille du flacon, lyophilisé ou
 * non) : WASTAGE_BY_ANTIGEN (src/lib/pev/thresholds.json). Un taux négatif
 * (plus de doses administrées qu'utilisées) est une donnée suspecte.
 */

import { useCallback, useMemo, useState } from "react";
import { Percent, Recycle, Syringe, PackageOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { Dhis2ChoroplethMap, type MapStatus } from "@/components/dhis2/dhis2-choropleth-map";
import {
  ChildrenTable,
  FilterDropdown,
  MultiTrendChart,
  PageHeader,
  ScopeNotice,
  SectionCard,
  SourceBar,
  StatCard,
  formatPercent,
  useDescribeSource,
  useMultiIndicatorAnalytics,
  usePageFilter,
} from "@/components/dashboard/pages/_shared";
import { deriveAll, latestByOrgUnit, mergeResults, pickIndicators, type DerivedSeries } from "@/lib/dhis2-analytics";
import { formatDhis2PeriodRange, formatDhis2PeriodShort, formatDhis2Value } from "@/lib/dhis2-format";
import { PEV_THRESHOLDS, WASTAGE_BY_ANTIGEN, thresholdStatus, type ThresholdPair } from "@/lib/pev/thresholds";
import { SIGL_COC, SIGL_VACCINES, siglOperand } from "@/lib/pev/sigl";
import { cn } from "@/lib/utils";

const LOSS_RATE = "YM7Tmn01ieL";
const used = (de: string) => siglOperand(de, SIGL_COC.USED);
const administered = (de: string) => siglOperand(de, SIGL_COC.ADMINISTERED);
const WASTAGE_INDICATORS = [LOSS_RATE, ...SIGL_VACCINES.flatMap((v) => [used(v.id), administered(v.id)])];
const DEFAULT_ANTIGEN = SIGL_VACCINES[1].id; // Penta

const rateSpec = (de: string, name: string): DerivedSeries => ({
  id: "rate", name, num: [used(de)], subtract: [administered(de)], den: [used(de)], factor: 100,
});

/** Three-band status; a negative rate (more doses administered than used) is suspect. */
function wastageStatus(value: number, bounds: ThresholdPair): Exclude<MapStatus, null> {
  return value < 0 ? "suspect" : thresholdStatus(value, bounds, false);
}
const tableStatus = (bounds: ThresholdPair) => (v: number) => {
  const s = wastageStatus(v, bounds);
  return s === "suspect" ? null : s;
};
const STATUS_TEXT: Record<Exclude<MapStatus, null>, string> = {
  good: "text-emerald-600",
  warning: "text-amber-600",
  critical: "font-medium text-rose-600",
  suspect: "text-violet-600",
};

export function WastagePage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  // SIGL operands are synced down to the zone (thematic stage).
  const { filter, setFilter, reset, clamped, maxLevel } = usePageFilter(3);
  const describeSource = useDescribeSource();
  const [antigenId, setAntigenId] = useState(DEFAULT_ANTIGEN);
  const antigen = SIGL_VACCINES.find((v) => v.id === antigenId) ?? SIGL_VACCINES[1];
  const bounds = WASTAGE_BY_ANTIGEN[antigen.id] ?? PEV_THRESHOLDS.wastage;

  const analytics = useMultiIndicatorAnalytics({ indicatorIds: WASTAGE_INDICATORS, filter });
  const { result, focus, children, loading, error, source, latestPeriod, syncedAt } = analytics;

  const specs: DerivedSeries[] = useMemo(() => [
    rateSpec(antigen.id, tPages("wastage.rateOf", { antigen: antigen.name })),
    { id: "used", name: tPages("wastage.usedOf", { antigen: antigen.name }), num: [used(antigen.id)] },
    { id: "admin", name: tPages("wastage.administeredOf", { antigen: antigen.name }), num: [administered(antigen.id)] },
  ], [antigen, tPages]);

  const focusDerived = useMemo(() => deriveAll(focus, specs), [focus, specs]);
  const childrenDerived = useMemo(() => deriveAll(children ?? result, specs), [children, result, specs]);

  const rateTrend = useMemo(() => {
    const merged = mergeResults([pickIndicators(focusDerived, ["rate"]), pickIndicators(focus, [LOSS_RATE])], ["rate", LOSS_RATE]);
    if (merged) merged.metaData.items[LOSS_RATE] = { name: tPages("wastage.globalRate") };
    return merged;
  }, [focus, focusDerived, tPages]);
  const dosesTrend = useMemo(() => pickIndicators(focusDerived, ["used", "admin"]), [focusDerived]);

  const latest = (res: typeof focus, dx: string) => latestByOrgUnit(res, dx).find((l) => l.ouId === filter.orgUnitId);
  const rateNow = latest(focusDerived, "rate");
  const globalNow = latest(focus, LOSS_RATE);
  const usedNow = latest(focusDerived, "used");
  const adminNow = latest(focusDerived, "admin");

  const national = filter.orgUnitLevel === 1;
  const mapResult = useMemo(() => pickIndicators(childrenDerived, ["rate"]), [childrenDerived]);
  const mapStatus = useCallback((v: number): MapStatus => wastageStatus(v, bounds), [bounds]);
  const mapPeriod = useMemo(() => {
    const periods = [...new Set(latestByOrgUnit(mapResult, "rate", { exclude: [filter.orgUnitId] }).map((l) => l.period))].sort();
    return periods.length ? formatDhis2PeriodRange(periods[0], periods[periods.length - 1]) : undefined;
  }, [mapResult, filter.orgUnitId]);

  // Selected unit: latest complete month of every antigen.
  const byAntigen = useMemo(() => SIGL_VACCINES.map((v) => {
    const derived = deriveAll(focus, [
      rateSpec(v.id, ""),
      { id: "used", name: "", num: [used(v.id)] },
      { id: "admin", name: "", num: [administered(v.id)] },
    ]);
    const pick = (dx: string) => latestByOrgUnit(derived, dx).find((l) => l.ouId === filter.orgUnitId);
    const rate = pick("rate");
    return {
      ...v,
      bounds: WASTAGE_BY_ANTIGEN[v.id] ?? PEV_THRESHOLDS.wastage,
      rate: rate?.value,
      used: pick("used")?.value,
      admin: pick("admin")?.value,
      period: rate?.period ?? pick("admin")?.period,
    };
  }), [focus, filter.orgUnitId]);

  const rateStatus = rateNow ? wastageStatus(rateNow.value, bounds) : null;
  const pending = !loading && !rateNow && !!adminNow;

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={Recycle}
        accent="bg-lime-500/10 text-lime-600 dark:text-lime-400"
        title={t("pages.wastage.title")}
        description={t("pages.wastage.description")}
      />

      <SourceBar source={describeSource(source, latestPeriod, syncedAt)} onReset={reset} resetLabel={tPages("reset")} />
      <Dhis2FilterBar filter={filter} onChange={setFilter} maxLevel={maxLevel}>
        <FilterDropdown
          icon={Syringe}
          label={tPages("supply.antigen")}
          options={SIGL_VACCINES}
          value={antigenId}
          onChange={setAntigenId}
        />
      </Dhis2FilterBar>
      <ScopeNotice filter={filter} state={analytics} clamped={clamped} maxLevel={maxLevel} />

      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>
      )}
      {pending && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          {tPages("wastage.pendingSync")}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Percent}
          loading={loading}
          label={tPages("wastage.rateOf", { antigen: antigen.name })}
          value={rateNow ? formatPercent(rateNow.value) : "—"}
          status={rateStatus === "suspect" ? null : rateStatus}
          hint={[
            tPages("wastage.maxHint", { max: bounds.warning, vial: antigen.vial }),
            rateNow ? formatDhis2PeriodShort(rateNow.period) : null,
            rateStatus === "suspect" ? tPages("wastage.suspect") : null,
          ].filter(Boolean).join(" · ")}
        />
        <StatCard
          icon={Recycle}
          loading={loading}
          label={tPages("wastage.globalRate")}
          value={globalNow ? formatPercent(globalNow.value) : "—"}
          status={globalNow ? thresholdStatus(globalNow.value, PEV_THRESHOLDS.wastage, false) : null}
          hint={globalNow ? formatDhis2PeriodShort(globalNow.period) : undefined}
        />
        <StatCard
          icon={PackageOpen}
          loading={loading}
          label={tPages("wastage.usedOf", { antigen: antigen.name })}
          value={usedNow ? formatDhis2Value(usedNow.value) : "—"}
          hint={usedNow ? formatDhis2PeriodShort(usedNow.period) : undefined}
        />
        <StatCard
          icon={Syringe}
          loading={loading}
          label={tPages("wastage.administeredOf", { antigen: antigen.name })}
          value={adminNow ? formatDhis2Value(adminNow.value) : "—"}
          hint={adminNow ? formatDhis2PeriodShort(adminNow.period) : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MultiTrendChart result={rateTrend} loading={loading} title={tPages("wastage.rateTrend")} unit=" %" />
        <MultiTrendChart result={dosesTrend} loading={loading} title={tPages("wastage.dosesTrend", { antigen: antigen.name })} />
      </div>

      <div className={cn("grid grid-cols-1 gap-4", national && "xl:grid-cols-2")}>
        <ChildrenTable
          unitLabel={tPages("unit")}
          title={tPages("wastage.byUnit", { antigen: antigen.name })}
          result={childrenDerived}
          excludeOrgUnit={filter.orgUnitId}
          loading={loading}
          columns={[
            { id: "rate", label: tPages("wastage.rate"), format: formatPercent, status: tableStatus(bounds) },
            { id: "used", label: tPages("wastage.used") },
            { id: "admin", label: tPages("wastage.administered") },
          ]}
        />
        {/* The base map only has provinces. */}
        {national && (
          <SectionCard title={tPages("wastage.mapTitle", { antigen: antigen.name })} subtitle={mapPeriod}>
            <div className="h-[360px]">
              <Dhis2ChoroplethMap result={mapResult} loading={loading} status={mapStatus} hideHeader />
            </div>
          </SectionCard>
        )}
      </div>

      <SectionCard title={tPages("wastage.byAntigen")}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{tPages("supply.antigen")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("wastage.vial")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("wastage.rate")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("wastage.max")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("wastage.used")}</th>
                <th className="pb-2 pr-4 font-medium">{tPages("wastage.administered")}</th>
                <th className="pb-2 font-medium">{tPages("wastage.month")}</th>
              </tr>
            </thead>
            <tbody>
              {byAntigen.map((r) => {
                const status = r.rate === undefined ? null : wastageStatus(r.rate, r.bounds);
                return (
                  <tr
                    key={r.id}
                    className={cn("cursor-pointer border-b last:border-0 hover:bg-muted/50", r.id === antigenId && "bg-muted/40")}
                    onClick={() => setAntigenId(r.id)}
                  >
                    <td className="py-2 pr-4 font-medium">{r.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{r.vial}</td>
                    <td className={cn("py-2 pr-4", status && STATUS_TEXT[status])}>
                      {r.rate === undefined ? "—" : formatPercent(r.rate)}
                      {status === "suspect" && ` (${tPages("wastage.suspect")})`}
                    </td>
                    <td className="py-2 pr-4">{`≤ ${r.bounds.warning} %`}</td>
                    <td className="py-2 pr-4">{r.used === undefined ? "—" : formatDhis2Value(r.used)}</td>
                    <td className="py-2 pr-4">{r.admin === undefined ? "—" : formatDhis2Value(r.admin)}</td>
                    <td className="py-2 text-muted-foreground">{r.period ? formatDhis2PeriodShort(r.period) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <p className="text-[11px] text-muted-foreground">{tPages("wastage.method")}</p>
    </div>
  );
}
