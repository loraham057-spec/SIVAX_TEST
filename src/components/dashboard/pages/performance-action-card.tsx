"use client";

/**
 * Performance page — « Où agir en priorité » (national level only: the base
 * map only has provinces).
 *
 * A province average hides its zones: Ituri is at ~96 % Penta3 while a third
 * of its zones are under 80 %. Two views:
 *   - zones : each province coloured by the share of its health zones beyond
 *     the WHO alert bound (IA2030 applies 80 % per district) for the selected
 *     indicator, cumulative over the period. Suspect zones (> 100 %, negative
 *     dropout) are counted apart and left out of the share.
 *   - lost  : children who received Penta1 but not Penta3 over the period
 *     (Σ Penta1 − Σ Penta3 doses) — an absolute number, independent of the
 *     target population, so usable even where coverage exceeds 100 %.
 */

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Dhis2ChoroplethMap, type MapStatus } from "@/components/dhis2/dhis2-choropleth-map";
import { SectionCard, useMultiIndicatorAnalytics } from "@/components/dashboard/pages/_shared";
import {
  cumulativeAnnualized,
  cumulativeRatio,
  cumulativeTotals,
  withDimensions,
  type CumulativeValue,
} from "@/lib/dhis2-analytics";
import { formatDhis2PeriodRange } from "@/lib/dhis2-format";
import { PEV_THRESHOLDS, thresholdStatus } from "@/lib/pev/thresholds";
import { cn } from "@/lib/utils";
import type { Dhis2AnalyticsResult, Dhis2FilterState } from "@/types";

/** DTC-HepB-Hib 1 / 3 doses administered. */
export const PENTA1_DOSES = "uNdFg1eymsa";
export const PENTA3_DOSES = "WWxqaHSeiwd";

export type PerfKind = "coverage" | "dropout";
export interface PerfIndicator { id: string; name: string; kind: PerfKind }

/** Cumulative value of an indicator per org unit over the period. */
export function cumulativeIndicator(
  source: Dhis2AnalyticsResult | null,
  indicator: PerfIndicator,
  exclude: string[],
): CumulativeValue[] {
  return indicator.kind === "dropout"
    ? cumulativeRatio(source, { num: PENTA1_DOSES, subtract: PENTA3_DOSES, den: PENTA1_DOSES, factor: 100 }, { exclude })
    : cumulativeAnnualized(source, indicator.id, { exclude });
}

const ZONES_DX = "ZONES_BELOW_THRESHOLD";
const LOST_DX = "PENTA1_NOT_PENTA3";
const ZONE_LEVEL = 3;

type View = "zones" | "lost";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const nf = (v: number) => Math.round(v).toLocaleString("fr-FR");
/** "kn Kinshasa Province" → "Kinshasa" (SNIS RDC naming). */
const shortName = (name: string) => name.replace(/^[a-z]{2} /, "").replace(/ (Province|Zone de Santé|Zone de santé)$/i, "");
const spanOf = (values: { first: string; last: string }[]) => {
  if (values.length === 0) return "";
  const first = values.reduce((a, v) => (v.first < a ? v.first : a), values[0].first);
  const last = values.reduce((a, v) => (v.last > a ? v.last : a), values[0].last);
  return formatDhis2PeriodRange(first, last);
};

interface ProvinceZones {
  ouId: string;
  name: string;
  valid: number;
  below: CumulativeValue[];
  suspect: number;
  share: number;
  last: string;
}

export function PerformanceActionCard({
  filter,
  indicator,
  provinces,
  loading,
  statusOf,
}: {
  filter: Dhis2FilterState;
  indicator: PerfIndicator;
  /** Province-level result of the page (names, doses). */
  provinces: Dhis2AnalyticsResult | null;
  loading: boolean;
  statusOf: (value: number) => Exclude<MapStatus, null>;
}) {
  const t = useTranslations("analyticsPageContent.performance");
  const [view, setView] = useState<View>("zones");

  // Every zone of the country, for the selected indicator only.
  const zoneData = useMultiIndicatorAnalytics({
    indicatorIds: indicator.kind === "dropout" ? [PENTA1_DOSES, PENTA3_DOSES] : [indicator.id],
    filter,
    childLevel: ZONE_LEVEL,
    enabled: view === "zones",
  });

  const zones = useMemo<ProvinceZones[]>(() => {
    const values = cumulativeIndicator(zoneData.children, indicator, [filter.orgUnitId]);
    const byProvince = new Map<string, CumulativeValue[]>();
    for (const v of values) {
      const prov = zoneData.parents[v.ouId];
      if (prov) byProvince.set(prov, [...(byProvince.get(prov) ?? []), v]);
    }
    return [...byProvince.entries()].flatMap(([ouId, list]) => {
      const suspect = list.filter((v) => statusOf(v.value) === "suspect").length;
      const below = list.filter((v) => statusOf(v.value) === "critical")
        .sort((a, b) => (indicator.kind === "dropout" ? b.value - a.value : a.value - b.value));
      const valid = list.length - suspect;
      if (valid === 0) return [];
      return [{
        ouId,
        name: provinces?.metaData.items[ouId]?.name ?? ouId,
        valid,
        below,
        suspect,
        share: (below.length / valid) * 100,
        last: list.reduce((a, v) => (v.last > a ? v.last : a), ""),
      }];
    });
  }, [zoneData.children, zoneData.parents, indicator, filter.orgUnitId, statusOf, provinces]);

  const lost = useMemo(
    () => cumulativeTotals(provinces, [PENTA1_DOSES, PENTA3_DOSES], { exclude: [filter.orgUnitId] }).map((v) => {
      const p1 = v.totals[PENTA1_DOSES];
      const p3 = v.totals[PENTA3_DOSES];
      return { ...v, p1, p3, lost: p1 - p3, dropout: p1 > 0 ? ((p1 - p3) / p1) * 100 : 0 };
    }),
    [provinces, filter.orgUnitId],
  );

  const zoneNames = zoneData.children?.metaData.items;
  const zonesById = useMemo(() => new Map(zones.map((z) => [z.ouId, z])), [zones]);
  const lostById = useMemo(() => new Map(lost.map((l) => [l.ouId, l])), [lost]);

  const mapResult = useMemo(() => {
    const items = { ...provinces?.metaData.items };
    if (view === "zones") {
      if (zones.length === 0) return null;
      return withDimensions(
        { rows: zones.map((z) => [ZONES_DX, z.last, z.ouId, String(z.share)]), metaData: { items: { ...items, [ZONES_DX]: { name: t("zonesMetric") } }, dimensions: {} } },
        [ZONES_DX],
      );
    }
    if (lost.length === 0) return null;
    return withDimensions(
      { rows: lost.map((l) => [LOST_DX, l.last, l.ouId, String(l.lost)]), metaData: { items: { ...items, [LOST_DX]: { name: t("lostMetric") } }, dimensions: {} } },
      [LOST_DX],
    );
  }, [view, zones, lost, provinces, t]);

  const zoneStatus = useCallback(
    (v: number): MapStatus => thresholdStatus(v, PEV_THRESHOLDS.zones_below_threshold, false),
    [],
  );

  const describe = useCallback((ouId: string): string | null => {
    if (view === "zones") {
      const z = zonesById.get(ouId);
      if (!z) return null;
      const names = z.below.slice(0, 4).map((v) => esc(shortName(zoneNames?.[v.ouId]?.name ?? v.ouId)));
      return [
        esc(t("zonesBelow", { below: z.below.length, total: z.valid })),
        z.suspect ? esc(t("zonesSuspect", { count: z.suspect })) : null,
        names.length ? `<span style="font-size:11px">${names.join(", ")}${z.below.length > 4 ? "…" : ""}</span>` : null,
      ].filter(Boolean).join("<br/>");
    }
    const l = lostById.get(ouId);
    return l ? esc(t("lostDetail", { p1: nf(l.p1), p3: nf(l.p3), dropout: l.dropout.toFixed(1) })) : null;
  }, [view, zonesById, lostById, zoneNames, t]);

  const top = view === "zones"
    ? [...zones].filter((z) => z.below.length > 0).sort((a, b) => b.below.length - a.below.length || b.share - a.share).slice(0, 5)
    : [];
  const topLost = view === "lost" ? [...lost].sort((a, b) => b.lost - a.lost).slice(0, 5) : [];

  const period = view === "zones"
    ? spanOf(cumulativeIndicator(zoneData.children, indicator, [filter.orgUnitId]))
    : spanOf(lost);
  const subtitle = view === "zones"
    ? t("zonesSubtitle", { indicator: indicator.name, period })
    : t("lostSubtitle", { period });
  const mapLoading = view === "zones" ? zoneData.loading : loading;
  const zoneThreshold = PEV_THRESHOLDS[indicator.kind].warning;

  return (
    <SectionCard title={t("actionTitle")} subtitle={subtitle}>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["zones", "lost"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              view === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
            )}
          >
            {v === "zones" ? t("viewZones") : t("viewLost")}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="h-[400px] xl:col-span-2">
          <Dhis2ChoroplethMap
            result={mapResult}
            loading={mapLoading}
            status={view === "zones" ? zoneStatus : undefined}
            formatValue={view === "zones" ? undefined : nf}
            describe={describe}
            periodLabel={period || undefined}
            hideHeader
          />
        </div>

        <div className="space-y-2 text-xs">
          <p className="font-medium">{view === "zones" ? t("topZones") : t("topLost")}</p>
          {view === "zones" && !mapLoading && zones.length === 0 && (
            <p className="text-muted-foreground">{t("noZoneData")}</p>
          )}
          {view === "zones" && !mapLoading && zones.length > 0 && top.length === 0 && (
            <p className="text-emerald-600">{t("noZoneBelow", { threshold: zoneThreshold })}</p>
          )}
          <ol className="space-y-2">
            {top.map((z) => (
              <li key={z.ouId} className="rounded-lg border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{shortName(z.name)}</span>
                  <span className="font-medium text-rose-600">{t("zonesBelow", { below: z.below.length, total: z.valid })}</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {z.below.slice(0, 4).map((v) => `${shortName(zoneNames?.[v.ouId]?.name ?? v.ouId)} ${v.value.toFixed(0)} %`).join(" · ")}
                  {z.below.length > 4 && " …"}
                </p>
              </li>
            ))}
            {topLost.map((l) => (
              <li key={l.ouId} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <span className="font-medium">{shortName(l.name)}</span>
                <span className="text-right">
                  <span className="font-medium">{t("lostChildren", { count: nf(l.lost) })}</span>
                  <span className="ml-1 text-muted-foreground">({t("dropoutShort", { dropout: l.dropout.toFixed(1) })})</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="pt-1 text-[11px] text-muted-foreground">
            {view === "zones"
              ? t("zonesNote", { indicator: indicator.name, threshold: zoneThreshold, unit: indicator.kind === "dropout" ? "> " : "< " })
              : t("lostNote")}
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
