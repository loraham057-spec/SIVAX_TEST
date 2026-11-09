"use client";

/**
 * Page 9 — Surveillance MPV
 *
 * Source : eSurveillance hebdomadaire (agrégée par mois).
 *   1. Totaux de la période : PFA, rougeole (cas, létalité), MAPI graves,
 *      fièvre jaune, tétanos néonatal
 *   2. Taux de notification PFA / 100 000 < 15 ans (annualisé, population
 *      0-14 ans de la page Cibles)
 *   3. Cas par mois et par unité enfant, complétude du rapport hebdomadaire
 * Les délais d'investigation et de laboratoire ne sont pas renseignés.
 */

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertCircle, Baby, FlaskConical, Radar, ShieldAlert, Skull, Syringe, Bug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { Dhis2StackedBarChart } from "@/components/dhis2/dhis2-stacked-bar-chart";
import {
  ChildrenTable,
  PageHeader,
  ScopeNotice,
  SourceBar,
  StatCard,
  UnavailableCard,
  useDescribeSource,
  usePageFilter,
  formatPercent,
  useMultiIndicatorAnalytics,
} from "@/components/dashboard/pages/_shared";
import { latestByOrgUnit, periodSpan, pickIndicators, totalOverPeriods } from "@/lib/dhis2-analytics";
import { formatDhis2PeriodRange, formatDhis2Value } from "@/lib/dhis2-format";
import { FilterSelect } from "@/components/ui/filter-select";

const AFP_CASES = "KWjTStRWD7G";
const MEASLES_CASES = "qefGtS4yIRf";
const MEASLES_DEATHS = "I9b3EuPa3vy";
const YF_CASES = "zDdJIzArBCt";
const NNT_CASES = "vfwGMNLW4Ud";
const AEFI_SEVERE = "Msq4aeFkV4o";
const SURV_RR = "YCYOKxjY2vk.REPORTING_RATE";
const CASES = [AFP_CASES, MEASLES_CASES, YF_CASES, NNT_CASES, AEFI_SEVERE];
const SURVEILLANCE_INDICATORS = [...CASES, MEASLES_DEATHS, "SUHNj4sKNJu", "K0F71TaN8aB", "gNzNzI3r8S0", "DRTMvzMD7wG", SURV_RR];
const UNDER15_KEYS = ["pop04M", "pop04F", "pop59F", "pop59M", "pop1014F", "pop1014M"];
const ALL = "all";
/** Disease selector: `columns` are the per-unit table columns (cols.* labels). */
const DISEASES = [
  { id: MEASLES_CASES, labelKey: "measles", columns: [MEASLES_CASES, MEASLES_DEATHS] },
  { id: AFP_CASES, labelKey: "afp", columns: [AFP_CASES] },
  { id: YF_CASES, labelKey: "yellowFever", columns: [YF_CASES] },
  { id: NNT_CASES, labelKey: "nnt", columns: [NNT_CASES] },
  { id: AEFI_SEVERE, labelKey: "aefiSevere", columns: [AEFI_SEVERE] },
] as const;
const COLUMN_LABELS: Record<string, string> = {
  [MEASLES_CASES]: "measles",
  [MEASLES_DEATHS]: "measlesDeaths",
  [AFP_CASES]: "afp",
  [YF_CASES]: "yellowFever",
  [NNT_CASES]: "nnt",
  [AEFI_SEVERE]: "aefiSevere",
};

export function SurveillancePage() {
  const t = useTranslations("analyticsPages");
  const tPages = useTranslations("analyticsPageContent");
  // eSurveillance is reported by the health zones.
  const { filter, setFilter, reset, clamped, maxLevel } = usePageFilter(3);
  const describeSource = useDescribeSource();
  const analytics = useMultiIndicatorAnalytics({
    indicatorIds: SURVEILLANCE_INDICATORS,
    filter,
  });
  const { result, focus, children, loading, error, source, latestPeriod, syncedAt } = analytics;

  // Population < 15 years of the selected unit (annual, Cibles data).
  const popYear = latestPeriod ? latestPeriod.slice(0, 4) : String(new Date().getFullYear());
  const [under15, setUnder15] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setUnder15(null);
    fetch(`/api/dhis2/cibles?orgUnitId=${encodeURIComponent(filter.orgUnitId)}&level=0&year=${popYear}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { rows?: { values: Record<string, number | null> }[] } | null) => {
        const values = json?.rows?.[0]?.values;
        const total = values ? UNDER15_KEYS.reduce((s, k) => s + (values[k] ?? 0), 0) : 0;
        if (active) setUnder15(total > 0 ? total : null);
      })
      .catch(() => active && setUnder15(null));
    return () => { active = false; };
  }, [filter.orgUnitId, popYear]);

  const ou = filter.orgUnitId;
  const total = (dx: string) => totalOverPeriods(focus, dx, ou);
  // Months actually summed in a total (the window may hold unreported months).
  const covered = (...dx: string[]) => {
    const span = periodSpan(focus, dx, ou);
    return span ? formatDhis2PeriodRange(span.first, span.last) : undefined;
  };
  const months = new Set((focus?.rows ?? []).filter((r) => r[0] === AFP_CASES).map((r) => r[1])).size;
  const afp = total(AFP_CASES);
  const measles = total(MEASLES_CASES);
  const measlesDeaths = total(MEASLES_DEATHS);
  const cfr = measles && measlesDeaths !== null ? (measlesDeaths / measles) * 100 : null;
  const afpRate = afp !== null && under15 && months > 0 ? (afp * (12 / months) / under15) * 100_000 : null;
  const completeness = latestByOrgUnit(focus, SURV_RR)[0];
  // "" = all diseases.
  const [diseaseId, setDiseaseId] = useState("");
  const disease = DISEASES.find((d) => d.id === diseaseId);
  const shows = (dx: string) => !disease || disease.id === dx;
  const casesByMonth = useMemo(() => pickIndicators(focus, disease ? [disease.id] : CASES), [focus, disease]);
  const tableColumns: readonly string[] = disease ? disease.columns : Object.keys(COLUMN_LABELS);
  const fmt = (v: number | null) => (v === null ? "—" : formatDhis2Value(v));
  const diseaseOptions = [{ value: ALL, label: tPages("surveillance.allDiseases") }, ...DISEASES.map((d) => ({ value: d.id, label: tPages(`cols.${d.labelKey}`) }))];

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={Radar}
        accent="bg-orange-500/10 text-orange-600 dark:text-orange-400"
        title={t("pages.surveillance.title")}
        description={t("pages.surveillance.description")}
      />

      <SourceBar source={describeSource(source, latestPeriod, syncedAt)} onReset={reset} resetLabel={tPages("reset")} />
      <Dhis2FilterBar filter={filter} onChange={setFilter} maxLevel={maxLevel}>
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Bug className="h-3 w-3" /> {tPages("surveillance.disease")}
          </label>
          <FilterSelect
            options={diseaseOptions}
            value={diseaseId || ALL}
            onChange={(value) => setDiseaseId(value === ALL ? "" : value)}
            placeholder={tPages("surveillance.disease")}
            minWidth={160}
            className="w-full sm:w-auto"
          />
        </div>
      </Dhis2FilterBar>
      <ScopeNotice filter={filter} state={analytics} clamped={clamped} maxLevel={maxLevel} />

      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">{error}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {shows(AFP_CASES) && (
          <>
            <StatCard icon={Activity} loading={loading} label={tPages("surveillance.afpCases")} value={fmt(afp)} hint={covered(AFP_CASES)} />
            <StatCard
              icon={Activity}
              loading={loading}
              label={tPages("surveillance.afpRate")}
              value={afpRate === null ? "—" : afpRate.toFixed(1)}
              hint={tPages("surveillance.afpRateHint")}
              status={afpRate === null ? null : afpRate >= 2 ? "good" : afpRate >= 1 ? "warning" : "critical"}
            />
          </>
        )}
        {shows(MEASLES_CASES) && (
          <>
            <StatCard icon={AlertCircle} loading={loading} label={tPages("surveillance.measlesCases")} value={fmt(measles)} hint={covered(MEASLES_CASES)} />
            <StatCard
              icon={Skull}
              loading={loading}
              label={tPages("surveillance.measlesCfr")}
              value={cfr === null ? "—" : formatPercent(cfr)}
              hint={measlesDeaths !== null
                ? [tPages("cols.deaths", { count: formatDhis2Value(measlesDeaths) }), covered(MEASLES_CASES, MEASLES_DEATHS)].filter(Boolean).join(" · ")
                : undefined}
              status={cfr === null ? null : cfr <= 1 ? "good" : cfr <= 3 ? "warning" : "critical"}
            />
          </>
        )}
        {shows(AEFI_SEVERE) && <StatCard icon={ShieldAlert} loading={loading} label={tPages("surveillance.mapiSevere")} value={fmt(total(AEFI_SEVERE))} hint={covered(AEFI_SEVERE)} />}
        {shows(YF_CASES) && <StatCard icon={Bug} loading={loading} label={tPages("surveillance.yellowFever")} value={fmt(total(YF_CASES))} hint={covered(YF_CASES)} />}
        {shows(NNT_CASES) && <StatCard icon={Baby} loading={loading} label={tPages("surveillance.nnt")} value={fmt(total(NNT_CASES))} hint={covered(NNT_CASES)} />}
        <StatCard
          icon={Syringe}
          loading={loading}
          label={tPages("surveillance.completeness")}
          value={completeness ? formatPercent(completeness.value) : "—"}
          status={completeness ? (completeness.value >= 90 ? "good" : completeness.value >= 80 ? "warning" : "critical") : null}
        />
      </div>

      <Dhis2StackedBarChart result={casesByMonth} loading={loading} />

      <ChildrenTable
        unitLabel={tPages("unit")}
        title={tPages("surveillance.byUnit")}
        result={children ?? result}
        excludeOrgUnit={ou}
        loading={loading}
        mode="sum"
        columns={tableColumns.map((id) => ({ id, label: tPages(`cols.${COLUMN_LABELS[id]}`) }))}
      />

      <UnavailableCard icon={FlaskConical} title={tPages("surveillance.labTitle")} message={tPages("surveillance.labUnavailable")} />
    </div>
  );
}
