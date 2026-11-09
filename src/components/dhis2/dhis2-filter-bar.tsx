"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { MapPin, Calendar, Syringe, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilterSelect } from "@/components/ui/filter-select";
import { dhis2Service } from "@/services";
import { useTranslations } from "next-intl";
import { selectOrgUnit } from "@/lib/dhis2-filters";
import type { Dhis2OrgUnit, Dhis2FilterState, Dhis2PeriodPreset } from "@/types";

/** Antigènes de couverture vaccinale disponibles avec UIDs DHIS2 confirmés. */
const ANTIGEN_OPTIONS = [
  { value: "k26tJ22Ncpd", labelKey: "antigenPenta1" },
  { value: "v9b9aYsA5PM", labelKey: "antigenPenta3" },
  { value: "cWJXYKCXrLx", labelKey: "antigenBcg" },
  { value: "tNZxs1kE6fy", labelKey: "antigenVap4" },
  { value: "RZuHoUKI3fc", labelKey: "antigenVap1" },
  { value: "PR35pwZEAny", labelKey: "antigenVpo3" },
  { value: "F35ZsGcz2Lv", labelKey: "antigenVpi1" },
  { value: "khtnBZ1Ispo", labelKey: "antigenVpi2" },
  { value: "Dx7fV8rLg5F", labelKey: "antigenPcv1" },
  { value: "biBItnhkMUe", labelKey: "antigenPcv3" },
  { value: "k8womY2OabA", labelKey: "antigenRota1" },
  { value: "HX6kfUl1auv", labelKey: "antigenRota3" },
  { value: "OKaDG2t6LtN", labelKey: "antigenVar1" },
  { value: "j2RPbYTGkAf", labelKey: "antigenVaa" },
  { value: "z4Iqy42FhNf", labelKey: "antigenTd2" },
  { value: "nvPe9ZZiEaH", labelKey: "antigenFullyVaccinated" },
] as const;

interface Dhis2FilterBarProps {
  filter: Dhis2FilterState;
  onChange: (filter: Dhis2FilterState) => void;
  yearPeriod?: {
    value: number;
    options: number[];
    onChange: (year: number) => void;
  };
  /** Show the antigen selector (only for pages whose indicators depend on it). */
  showAntigen?: boolean;
  /** Deepest selectable level: 2 = province, 3 = zone, 4 = aire, 5 = FOSA. */
  maxLevel?: number;
  /** Page-specific filters, laid out inline between the location and the period. */
  children?: ReactNode;
}

// "Ce mois" / "Mois dernier" are still being reported (never in the ETL
// snapshot) and no page compares years, so neither is offered here.
const PERIOD_PRESET_KEYS: { value: Dhis2PeriodPreset; labelKey: string }[] = [
  { value: "LAST_COMPLETE_MONTH", labelKey: "lastCompleteMonth" },
  { value: "LAST_3_MONTHS", labelKey: "last3Months" },
  { value: "LAST_6_MONTHS", labelKey: "last6Months" },
  { value: "LAST_12_MONTHS", labelKey: "last12Months" },
  { value: "THIS_YEAR", labelKey: "thisYear" },
  { value: "LAST_YEAR", labelKey: "lastYear" },
  { value: "CUSTOM", labelKey: "customPeriod" },
];

/** Org units of `level` under `parentId`; empty while no parent is selected. */
function useOrgUnits(level: number, parentId: string | undefined, enabled = true) {
  const [state, setState] = useState<{ units: Dhis2OrgUnit[]; loading: boolean }>({ units: [], loading: false });
  useEffect(() => {
    if (!enabled || (level > 2 && !parentId)) {
      setState({ units: [], loading: false });
      return;
    }
    let active = true;
    setState({ units: [], loading: true });
    dhis2Service
      .getOrgUnits(level > 2 ? { level, parent: parentId } : { level })
      .then((res) => active && setState({ units: res.organisationUnits ?? [], loading: false }))
      .catch(() => active && setState({ units: [], loading: false }));
    return () => {
      active = false;
    };
  }, [level, parentId, enabled]);
  return state;
}

const LEVEL_PLACEHOLDER: Record<number, string> = { 2: "drcCountry", 3: "healthZone", 4: "healthArea", 5: "fosa" };

export function Dhis2FilterBar({ filter, onChange, yearPeriod, showAntigen = false, maxLevel = 5, children }: Dhis2FilterBarProps) {
  const t = useTranslations("filters");
  const path = (filter.orgUnitPath ?? []).slice(0, Math.max(maxLevel - 1, 0));
  const provinces = useOrgUnits(2, undefined, maxLevel >= 2);
  const zones = useOrgUnits(3, path[0], maxLevel >= 3);
  const areas = useOrgUnits(4, path[1], maxLevel >= 4);
  const fosas = useOrgUnits(5, path[2], maxLevel >= 5);
  const lists: Record<number, { units: Dhis2OrgUnit[]; loading: boolean }> = { 2: provinces, 3: zones, 4: areas, 5: fosas };

  const inputClass =
    "h-11 rounded-xl border border-input bg-background px-3 text-[15px] ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  const antigenOptions = ANTIGEN_OPTIONS.map((a) => ({
    value: a.value,
    label: t(a.labelKey),
  }));

  const periodPresets = PERIOD_PRESET_KEYS.map((p) => ({ value: p.value, label: t(p.labelKey) }));
  // A level is shown once its parent is selected (the province select always).
  const levels = [2, 3, 4, 5].filter((lvl) => lvl <= maxLevel && path.length >= lvl - 2);

  return (
    <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-[0_6px_18px_rgba(23,43,77,0.045)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {/* Org Unit cascade: Pays → Province → Zone → Aire → FOSA */}
        {maxLevel >= 2 && (
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <label className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
              <MapPin className="h-3 w-3" /> {t("location")}
            </label>
            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center">
              {levels.map((lvl) => {
                const { units, loading } = lists[lvl];
                const placeholder = t(LEVEL_PLACEHOLDER[lvl]);
                return (
                  <Fragment key={lvl}>
                    {lvl > 2 && <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />}
                    <FilterSelect
                      options={[{ value: "", label: placeholder }, ...units.map((u) => ({ value: u.id, label: u.name }))]}
                      value={path[lvl - 2] ?? ""}
                      onChange={(value) => onChange(selectOrgUnit(filter, lvl, value))}
                      isDisabled={lvl > 2 && units.length === 0 && !loading}
                      isLoading={loading}
                      placeholder={placeholder}
                      minWidth={lvl === 5 ? 180 : 160}
                      className="w-full sm:w-auto"
                    />
                  </Fragment>
                );
              })}
            </div>
          </div>
        )}

        {children}

        {showAntigen && (
          <div className="flex w-full flex-col gap-1 sm:w-auto">
            <label className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
              <Syringe className="h-3 w-3" /> {t("antigen")}
            </label>
            <FilterSelect
              options={antigenOptions}
              value={filter.antigeId ?? "v9b9aYsA5PM"}
              onChange={(value) => onChange({ ...filter, antigeId: value })}
              placeholder={t("antigen")}
              minWidth={200}
              className="w-full sm:w-auto"
            />
          </div>
        )}

        {/* Period preset */}
        <div className="flex w-full flex-col gap-1 sm:w-auto">
          <label className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
            <Calendar className="h-3 w-3" /> {t("period")}
          </label>
          {yearPeriod ? (
            <FilterSelect
              options={yearPeriod.options.map((y) => ({ value: String(y), label: String(y) }))}
              value={String(yearPeriod.value)}
              onChange={(value) => yearPeriod.onChange(Number(value))}
              placeholder={t("selectPeriod")}
              minWidth={120}
              className="w-full sm:w-auto"
            />
          ) : (
            <FilterSelect
              options={periodPresets}
              value={filter.periodPreset}
              onChange={(value) =>
                onChange({ ...filter, periodPreset: value as Dhis2PeriodPreset })
              }
              placeholder={t("selectPeriod")}
              minWidth={160}
              className="w-full sm:w-auto"
            />
          )}
        </div>

        {/* Custom date range */}
        {!yearPeriod && filter.periodPreset === "CUSTOM" && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-muted-foreground">{t("start")}</label>
              <input
                type="date"
                className={cn(inputClass, "min-w-[130px]")}
                value={filter.customPeriodStart ?? ""}
                onChange={(e) =>
                  onChange({ ...filter, customPeriodStart: e.target.value })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-bold text-muted-foreground">{t("end")}</label>
              <input
                type="date"
                className={cn(inputClass, "min-w-[130px]")}
                value={filter.customPeriodEnd ?? ""}
                onChange={(e) =>
                  onChange({ ...filter, customPeriodEnd: e.target.value })
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
