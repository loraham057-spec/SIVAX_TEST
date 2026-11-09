"use client";

/**
 * Page « Cibles » — Population et cibles vaccinales
 *
 * Affiche les données démographiques de population depuis DHIS2 (périodes
 * annuelles) avec filtres géographiques (province, ZS, AS, FOSA) et année.
 *
 * Contenu :
 *   1. Filtres : barre géographique + sélecteur d'année
 *   2. KPI cards : population totale, naissances vivantes, 0-11 mois,
 *      12-59 mois, 0-59 mois, 0-15 ans, femmes enceintes, cibles HPV
 *   3. Tableau détaillé par unité d'organisation
 *   4. Évolution annuelle (population totale + naissances vivantes)
 *   5. Répartition par âge (histogramme)
 *   6. Carte choroplèthe de la population totale
 *   7. Top 10 / Bottom 10 zones par population
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Users, Baby, Calendar, Layers, TrendingUp } from "lucide-react";
import { Bar, Doughnut } from "react-chartjs-2";
import { useTranslations } from "next-intl";
import { Dhis2FilterBar } from "@/components/dhis2/dhis2-filter-bar";
import { FilterSelect } from "@/components/ui/filter-select";
import {
  PageHeader,
  SectionCard,
  SourceBar,
  StatusBadge,
  useDescribeSource,
  usePageFilter,
} from "@/components/dashboard/pages/_shared";
import { cn } from "@/lib/utils";
import { formatDhis2Value } from "@/lib/dhis2-format";
import { CHART_PALETTE } from "@/lib/chart-setup";

// ─── Types ──────────────────────────────────────────────────────────────

interface CibleRow {
  orgUnitId: string;
  orgUnitName: string;
  values: Record<string, number | null>;
}

interface CiblesResponse {
  source: string;
  syncedAt?: string | null;
  year: string;
  level: number;
  orgUnitId: string;
  rows: CibleRow[];
  dataElements: { id: string; label: string; shortLabel: string; measured: boolean }[];
}

interface TrendResponse {
  source: string;
  years: Record<string, { popTotale: number | null; livebirths: number | null }>;
}

// ─── Proportions démographiques (estimations RDC) ───────────────────────
// Basées sur les données démographiques de la RDC (EDS, MICS, projections INS).
// Utilisées uniquement quand les données mesurées DHIS2 ne sont pas disponibles.

const DEMO_RATIOS = {
  pop011: 0.027,       // 0-11 mois ≈ 2.7% de la population totale
  pop1223: 0.027,      // 12-23 mois ≈ 2.7%
  pop1228: 0.032,      // 12-28 mois ≈ 3.2% (approximativement 12-23 + moitié 24-35)
  pop1259: 0.135,      // 12-59 mois ≈ 13.5%
  pop059: 0.162,       // 0-59 mois ≈ 16.2% (0-11 + 12-59)
  pop015: 0.45,        // 0-15 ans ≈ 45% de la population totale
  femmesEnceintes: 1.12, // Femmes enceintes ≈ 112% des naissances vivantes (pertes incluses)
  hpvFilles9: 0.0019,  // Filles de 9 ans ≈ 0.19% de la population totale
  hpvGarcons9: 0.0019, // Garçons de 9 ans ≈ 0.19%
  pop1014F: 0.044,     // 10-14 ans féminin ≈ 4.4%
  pop59F: 0.048,       // 5-9 ans féminin ≈ 4.8%
  pop59M: 0.048,       // 5-9 ans masculin ≈ 4.8%
};

// ─── Measured first, estimated otherwise ────────────────────────────────

type Values = Record<string, number | null | undefined>;

/** A population figure and whether it was estimated from DEMO_RATIOS. */
interface Figure {
  value: number | null;
  estimated: boolean;
}

const NONE: Figure = { value: null, estimated: false };

/** Sum of measured data elements; null unless every one of them is present. */
function measuredSum(v: Values, keys: string[]): number | null {
  const parts = keys.map((k) => v[k]);
  return parts.every((p) => typeof p === "number") ? (parts as number[]).reduce((s, p) => s + p, 0) : null;
}

/** Measured value when DHIS2 has it, otherwise `ratio` × the base figure. */
function figure(measured: number | null | undefined, base: number | null | undefined, ratio: number): Figure {
  if (typeof measured === "number") return { value: measured, estimated: false };
  if (!base) return NONE;
  return { value: Math.round(base * ratio), estimated: true };
}

const measuredOnly = (key: string) => (v: Values): Figure =>
  typeof v[key] === "number" ? { value: v[key] as number, estimated: false } : NONE;

const pop04 = (v: Values) => measuredSum(v, ["pop04M", "pop04F"]);

/** Population figures shown in the KPI cards and the detailed table. */
const FIGURES: Record<string, (v: Values) => Figure> = {
  popTotale: measuredOnly("popTotale"),
  livebirths: measuredOnly("livebirths"),
  cibleVaccinale: measuredOnly("cibleVaccinale"),
  pop011: (v) => figure(v.pop011, v.popTotale, DEMO_RATIOS.pop011),
  pop1228: (v) => figure(null, v.popTotale, DEMO_RATIOS.pop1228),
  pop1259: (v) => {
    const p04 = pop04(v);
    return figure(p04 !== null && typeof v.pop011 === "number" ? p04 - v.pop011 : null, v.popTotale, DEMO_RATIOS.pop1259);
  },
  pop059: (v) => figure(pop04(v), v.popTotale, DEMO_RATIOS.pop059),
  pop015: (v) => figure(measuredSum(v, ["pop04M", "pop04F", "pop59F", "pop59M", "pop1014F", "pop1014M"]), v.popTotale, DEMO_RATIOS.pop015),
  femmesEnceintes: (v) => figure(v.femmesEnceintes, v.livebirths, DEMO_RATIOS.femmesEnceintes),
  hpvFilles9: (v) => figure(null, v.popTotale, DEMO_RATIOS.hpvFilles9),
  hpvGarcons9: (v) => figure(null, v.popTotale, DEMO_RATIOS.hpvGarcons9),
  pop1014F: (v) => figure(v.pop1014F, v.popTotale, DEMO_RATIOS.pop1014F),
};

/** Age pyramid buckets: measured age groups when available, ratios otherwise. */
function ageBuckets(v: Values): { values: number[]; estimated: boolean } | null {
  const total = v.popTotale;
  if (!total) return null;
  const buckets = [
    FIGURES.pop011(v),
    FIGURES.pop1259(v),
    figure(measuredSum(v, ["pop59F", "pop59M"]), total, DEMO_RATIOS.pop59F + DEMO_RATIOS.pop59M),
    figure(measuredSum(v, ["pop1014F", "pop1014M"]), total, DEMO_RATIOS.pop1014F * 2),
    figure(measuredSum(v, ["pop1519F", "pop1519M"]), total, 0.044 * 2),
  ];
  const under20 = buckets.reduce((s, b) => s + (b.value ?? 0), 0);
  return {
    values: [...buckets.map((b) => b.value ?? 0), Math.max(total - under20, 0)],
    estimated: buckets.some((b) => b.estimated),
  };
}

// ─── KPI definitions ────────────────────────────────────────────────────

interface KpiDef {
  key: keyof typeof FIGURES;
  labelKey: string;
  icon: typeof Users;
  accent: string;
}

const KPI_DEFS: KpiDef[] = [
  { key: "popTotale", labelKey: "cibles.popTotale", icon: Users, accent: "bg-indigo-500/10 text-indigo-600" },
  { key: "livebirths", labelKey: "cibles.livebirths", icon: Baby, accent: "bg-rose-500/10 text-rose-600" },
  { key: "pop011", labelKey: "cibles.pop011", icon: Baby, accent: "bg-amber-500/10 text-amber-600" },
  { key: "pop1228", labelKey: "cibles.pop1228", icon: Baby, accent: "bg-orange-500/10 text-orange-600" },
  { key: "pop1259", labelKey: "cibles.pop1259", icon: Baby, accent: "bg-lime-500/10 text-lime-600" },
  { key: "pop059", labelKey: "cibles.pop059", icon: Baby, accent: "bg-emerald-500/10 text-emerald-600" },
  { key: "pop015", labelKey: "cibles.pop015", icon: Users, accent: "bg-blue-500/10 text-blue-600" },
  { key: "femmesEnceintes", labelKey: "cibles.femmesEnceintes", icon: Calendar, accent: "bg-pink-500/10 text-pink-600" },
  { key: "hpvFilles9", labelKey: "cibles.hpvFilles", icon: Users, accent: "bg-purple-500/10 text-purple-600" },
  { key: "hpvGarcons9", labelKey: "cibles.hpvGarcons", icon: Users, accent: "bg-cyan-500/10 text-cyan-600" },
  { key: "pop1014F", labelKey: "cibles.pop1014F", icon: Users, accent: "bg-teal-500/10 text-teal-600" },
  { key: "cibleVaccinale", labelKey: "cibles.cibleVaccinale", icon: TrendingUp, accent: "bg-violet-500/10 text-violet-600" },
];

const TABLE_COLUMNS: { key: keyof typeof FIGURES; labelKey: string }[] = [
  { key: "popTotale", labelKey: "cibles.popTotale" },
  { key: "livebirths", labelKey: "cibles.livebirths" },
  { key: "pop011", labelKey: "cibles.pop011" },
  { key: "pop059", labelKey: "cibles.pop059" },
  { key: "pop015", labelKey: "cibles.pop015" },
  { key: "femmesEnceintes", labelKey: "cibles.femmesEnceintes" },
  { key: "hpvFilles9", labelKey: "cibles.hpvFilles" },
  { key: "cibleVaccinale", labelKey: "cibles.cibleVaccinale" },
];

const LEVEL_LABEL_KEYS: Record<number, string> = {
  2: "cibles.levelProvince",
  3: "cibles.levelZone",
  4: "cibles.levelAire",
  5: "cibles.levelFosa",
};

// ─── Component ───────────────────────────────────────────────────────────

export function CiblesPage() {
  const tPages = useTranslations("analyticsPageContent");
  const { filter, setFilter, reset: resetScope } = usePageFilter();
  const describeSource = useDescribeSource();

  const [year, setYear] = useState(new Date().getFullYear());
  const [levelChoice, setLevelChoice] = useState(2); // Province by default
  const [data, setData] = useState<CiblesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendResponse | null>(null);
  const [unitRow, setUnitRow] = useState<CibleRow | null>(null);

  const reset = useCallback(() => {
    resetScope();
    setYear(new Date().getFullYear());
    setLevelChoice(2);
  }, [resetScope]);

  const orgUnitId = filter.orgUnitId ?? "ymGeqzoPhN3";
  const orgUnitLevel = filter.orgUnitLevel ?? 1;
  // The detail level must sit below the selected unit; a FOSA has no children.
  const level = orgUnitLevel >= 5 ? 0 : Math.max(levelChoice, orgUnitLevel + 1);
  const trendYears = useMemo(
    () => [year - 3, year - 2, year - 1, year].filter((y) => y >= 2020),
    [year],
  );

  // ─── Fetch data for the selected year + org unit + level ───
  const fetchData = useCallback(
    async (y: number, ou: string, lvl: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/dhis2/cibles?orgUnitId=${encodeURIComponent(ou)}&level=${lvl}&year=${y}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const json: CiblesResponse = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur de chargement");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchData(year, orgUnitId, level);
  }, [year, orgUnitId, level, fetchData]);

  // ─── Trend (one call for every year, for the selected unit) ───
  useEffect(() => {
    let active = true;
    setTrend(null);
    fetch(
      `/api/dhis2/cibles?mode=trend&orgUnitId=${encodeURIComponent(orgUnitId)}&years=${trendYears.join(",")}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((json: TrendResponse | null) => {
        if (active) setTrend(json);
      })
      .catch(() => {
        if (active) setTrend(null);
      });
    return () => {
      active = false;
    };
  }, [orgUnitId, trendYears]);

  // ─── Selected unit's own figures (not a sum of possibly incomplete children) ───
  useEffect(() => {
    let active = true;
    setUnitRow(null);
    fetch(`/api/dhis2/cibles?orgUnitId=${encodeURIComponent(orgUnitId)}&level=0&year=${year}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: CiblesResponse | null) => {
        if (active) setUnitRow(json?.rows.find((r) => r.orgUnitId === orgUnitId) ?? null);
      })
      .catch(() => active && setUnitRow(null));
    return () => {
      active = false;
    };
  }, [orgUnitId, year]);

  // Sum of the detail rows: fallback when the unit itself has no row.
  const totals = useMemo(() => {
    const agg: Values = {};
    for (const row of data?.rows ?? []) {
      for (const [key, val] of Object.entries(row.values)) {
        if (val !== null && val !== undefined) agg[key] = (agg[key] ?? 0) + val;
      }
    }
    return agg;
  }, [data]);
  const unitValues: Values = unitRow?.values ?? totals;

  // ─── Trend chart data ───
  const trendChart = useMemo(() => ({
    years: trendYears,
    popTotale: trendYears.map((y) => trend?.years[String(y)]?.popTotale ?? null),
    livebirths: trendYears.map((y) => trend?.years[String(y)]?.livebirths ?? null),
  }), [trend, trendYears]);

  // ─── Age distribution chart ───
  const ageChart = useMemo(() => {
    const buckets = ageBuckets(unitValues);
    if (!buckets) return null;
    return {
      estimated: buckets.estimated,
      data: {
        labels: ["0-11 mois", "12-59 mois", "5-9 ans", "10-14 ans", "15-19 ans", "20+ ans"],
        datasets: [{ data: buckets.values, backgroundColor: CHART_PALETTE.slice(0, 6), borderWidth: 0 }],
      },
    };
  }, [unitValues]);

  // ─── Top/Bottom ranking ───
  const ranking = useMemo(() => {
    if (!data?.rows) return { top: [], bottom: [] };
    const sorted = [...data.rows]
      .filter((r) => r.values.popTotale != null)
      .sort((a, b) => (b.values.popTotale ?? 0) - (a.values.popTotale ?? 0));
    return {
      top: sorted.slice(0, 10),
      bottom: sorted.slice(-10).reverse(),
    };
  }, [data]);

  // Only levels strictly below the selected unit can be listed as its children.
  const levelOptions = useMemo(
    () =>
      Object.entries(LEVEL_LABEL_KEYS)
        .filter(([lvl]) => Number(lvl) > orgUnitLevel)
        .map(([lvl, key]) => ({ value: lvl, label: tPages(key) })),
    [orgUnitLevel, tPages],
  );

  // The annual ETL loads the current year and the 3 previous ones.
  const availableYears = useMemo(() => {
    const current = new Date().getFullYear();
    return [current, current - 1, current - 2, current - 3];
  }, []);

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4 sm:p-6">
      <PageHeader
        icon={Users}
        accent="bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
        title={tPages("cibles.title")}
        description={tPages("cibles.description")}
      />

      <SourceBar
        source={data ? describeSource(data.source, null, data.syncedAt) : "DHIS2 — SNIS RDC"}
        onReset={reset}
        resetLabel={tPages("reset")}
      />

      {/* Filters: location → breakdown level → year, on one row */}
      <Dhis2FilterBar
        filter={filter}
        onChange={setFilter}
        yearPeriod={{ value: year, options: availableYears, onChange: setYear }}
      >
        {level > 0 && (
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Layers className="h-3 w-3" /> {tPages("cibles.breakdownBy")}
            </label>
            <FilterSelect
              options={levelOptions}
              value={String(level)}
              onChange={(value) => value && setLevelChoice(Number(value))}
              placeholder={tPages("cibles.breakdownBy")}
              minWidth={160}
              className="w-full sm:w-auto"
            />
          </div>
        )}
      </Dhis2FilterBar>

      {/* Loading / Error states */}
      {loading && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border bg-card shadow-sm" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-600">
          {error}
        </div>
      )}

      {/* KPI cards */}
      {!loading && data && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {KPI_DEFS.map((kpi) => {
            const { value: val, estimated } = FIGURES[kpi.key](unitValues);
            const Icon = kpi.icon;
            return (
              <div key={kpi.key} className="flex flex-col rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", kpi.accent)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {estimated ? (
                    <StatusBadge status="neutral" label={tPages("cibles.estimated")} />
                  ) : val === null ? (
                    <StatusBadge status="neutral" label={tPages("cibles.noData")} />
                  ) : (
                    <StatusBadge status="good" label={tPages("cibles.measured")} />
                  )}
                </div>
                <p className="mt-3 text-2xl font-bold tracking-tight">
                  {val !== null ? formatDhis2Value(val) : "—"}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight font-medium">
                  {tPages(kpi.labelKey)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Trend + Age distribution */}
      {!loading && data && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SectionCard title={tPages("cibles.trendTitle")} subtitle={tPages("cibles.trendSubtitle")}>
            <div className="h-72 w-full">
              <Bar
                data={{
                  labels: trendChart.years.map(String),
                  datasets: [
                    {
                      label: tPages("cibles.popTotale"),
                      data: trendChart.popTotale,
                      backgroundColor: CHART_PALETTE[0],
                      borderWidth: 0,
                    },
                    {
                      label: tPages("cibles.livebirths"),
                      data: trendChart.livebirths,
                      backgroundColor: CHART_PALETTE[4],
                      borderWidth: 0,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: true, position: "bottom" as const, labels: { font: { size: 13 }, color: "#64748b", boxWidth: 12 } },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: {
                        font: { size: 13 },
                        color: "#64748b",
                        callback: function (value) {
                          const n = Number(value);
                          if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
                          if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
                          return String(value);
                        },
                      },
                    },
                    x: { ticks: { font: { size: 13 }, color: "#64748b" } },
                  },
                }}
              />
            </div>
          </SectionCard>

          <SectionCard
            title={tPages("cibles.ageDistribution")}
            subtitle={tPages(ageChart && !ageChart.estimated ? "cibles.ageDistributionMeasured" : "cibles.ageDistributionSubtitle")}
          >
            {ageChart ? (
              <div className="h-72 w-full">
                <Doughnut
                  data={ageChart.data}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "60%",
                    plugins: {
                      legend: { display: true, position: "right" as const, labels: { font: { size: 12 }, color: "#64748b", boxWidth: 10, padding: 6 } },
                    },
                  }}
                />
              </div>
            ) : (
              <div className="flex h-72 items-center justify-center text-xs text-muted-foreground">
                {tPages("cibles.noPopData")}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* Top/Bottom ranking */}
      {!loading && data && ranking.top.length > 0 && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SectionCard title={tPages("cibles.top10")}>
            <div className="space-y-1.5">
              {ranking.top.map((r, i) => (
                <div key={r.orgUnitId} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-muted-foreground">{i + 1}</span>
                  <span className="flex-1 truncate font-medium">{r.orgUnitName}</span>
                  <span className="font-bold">{formatDhis2Value(r.values.popTotale ?? 0)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title={tPages("cibles.bottom10")}>
            <div className="space-y-1.5">
              {ranking.bottom.map((r, i) => (
                <div key={r.orgUnitId} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-muted-foreground">{i + 1}</span>
                  <span className="flex-1 truncate font-medium">{r.orgUnitName}</span>
                  <span className="font-bold">{formatDhis2Value(r.values.popTotale ?? 0)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}

      {/* Detailed table */}
      {!loading && data && data.rows.length > 0 && (
        <SectionCard title={tPages("cibles.detailedTable")} subtitle={`${data.rows.length} ${tPages("cibles.units")}${LEVEL_LABEL_KEYS[level] ? ` · ${tPages(LEVEL_LABEL_KEYS[level])}` : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="sticky left-0 bg-card pb-2 pr-4 font-medium">{tPages("cibles.orgUnit")}</th>
                  {TABLE_COLUMNS.map((c) => (
                    <th key={c.key} className="pb-2 pr-3 font-medium">{tPages(c.labelKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.slice(0, 50).map((row) => (
                  <tr key={row.orgUnitId} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 pr-4 font-medium">{row.orgUnitName}</td>
                    {TABLE_COLUMNS.map((c) => {
                      const { value, estimated } = FIGURES[c.key](row.values);
                      return (
                        <td
                          key={c.key}
                          className={cn("py-2 pr-3", estimated && "italic text-muted-foreground")}
                          title={estimated ? tPages("cibles.estimated") : undefined}
                        >
                          {value !== null ? formatDhis2Value(value) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* No data state */}
      {!loading && !error && data && data.rows.length === 0 && (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold">{tPages("cibles.noDataTitle")}</h3>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">{tPages("cibles.noDataMessage")}</p>
          </div>
        </div>
      )}

      {/* Provenance footer */}
      {!loading && data && (
        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span>{data.source} — {tPages("cibles.year")}: {data.year}</span>
          <span>{tPages("cibles.disclaimer")}</span>
        </div>
      )}
    </div>
  );
}
