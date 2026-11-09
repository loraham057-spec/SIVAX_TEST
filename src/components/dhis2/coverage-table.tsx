"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatDhis2Period,
  formatDhis2PeriodShort,
  formatCoveragePercent,
  resolveDhis2Name,
} from "@/lib/dhis2-format";
import { getThresholdStatus, thresholdTextColor } from "@/lib/kpi-thresholds";
import type { Dhis2AnalyticsResult } from "@/types";

interface CoverageTableProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
  /** Selected antigen indicator ID (for threshold lookup). Kept for API symmetry. */
  antigenId?: string;
}

type SortDir = "asc" | "desc";
type SortKey = "name" | number; // number = column index (period)

const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 70;
const FOOTER_HEIGHT = 48;

export function CoverageTable({ result, loading }: CoverageTableProps) {
  const t = useTranslations("dhis2");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const containerRef = useRef<HTMLDivElement>(null);

  const updatePageSize = useCallback(() => {
    if (!containerRef.current) return;
    const height = containerRef.current.clientHeight;
    const available = height - HEADER_HEIGHT - FOOTER_HEIGHT;
    if (available > 0) {
      setPageSize(Math.max(5, Math.floor(available / ROW_HEIGHT)));
    }
  }, []);

  useEffect(() => {
    updatePageSize();
    const observer = new ResizeObserver(() => updatePageSize());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updatePageSize]);

  /** Build a pivot table: rows = org units, columns = periods. */
  const { orgUnitRows, periods, indicatorLabel } = useMemo(() => {
    if (!result?.rows || !result?.metaData) {
      return { orgUnitRows: [] as Array<{ id: string; name: string; values: Record<string, number | null> }>, periods: [] as string[], indicatorLabel: "" };
    }

    const dxItems = result.metaData.dimensions.dx ?? [];
    const peItems = result.metaData.dimensions.pe ?? [];
    const ouItems = result.metaData.dimensions.ou ?? [];

    if (dxItems.length === 0 || peItems.length === 0) {
      return { orgUnitRows: [], periods: [], indicatorLabel: "", totalCount: 0 };
    }

    const dxId = dxItems[0];
    const label = resolveDhis2Name(result.metaData?.items, dxId);

    // Sort periods chronologically
    const sortedPeriods = [...peItems].sort((a, b) => a.localeCompare(b));

    // Build a map: ouId → { period → value }
    const ouMap = new Map<string, Record<string, number | null>>();
    for (const ouId of ouItems) {
      ouMap.set(ouId, {});
    }

    for (const row of result.rows) {
      if (row[0] !== dxId) continue;
      const pe = row[1];
      const ou = row[2];
      const val = Number(row[3]);
      if (!ouMap.has(ou)) ouMap.set(ou, {});
      ouMap.get(ou)![pe] = Number.isFinite(val) ? val : null;
    }

    // Build display rows
    const rows = Array.from(ouMap.entries()).map(([id, values]) => ({
      id,
      name: resolveDhis2Name(result.metaData?.items, id),
      values,
    }));

    return {
      orgUnitRows: rows,
      periods: sortedPeriods,
      indicatorLabel: label,
    };
  }, [result]);

  // Sort rows
  const sortedRows = useMemo(() => {
    const rows = [...orgUnitRows];
    rows.sort((a, b) => {
      if (sortKey === "name") {
        return sortDir === "asc"
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      }
      // sortKey is a period index
      const period = periods[sortKey];
      if (!period) return 0;
      const va = a.values[period] ?? -Infinity;
      const vb = b.values[period] ?? -Infinity;
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return rows;
  }, [orgUnitRows, sortKey, sortDir, periods]);

  const totalPages = Math.ceil(sortedRows.length / pageSize);
  const pageRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    setPage(0);
  }, [result, pageSize, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  if (loading) {
    return (
      <div className="h-[calc(2*20rem+1rem)] animate-pulse rounded-xl border bg-card shadow-sm" />
    );
  }

  if (sortedRows.length === 0) {
    return (
      <div className="flex h-[calc(2*20rem+1rem)] items-center justify-center rounded-2xl border bg-card text-[15px] text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-[calc(2*20rem+1rem)] flex-col rounded-2xl border border-border/80 bg-card p-5 shadow-[0_6px_18px_rgba(23,43,77,0.045)]">
      {/* Header */}
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <div>
          <h3 className="text-base font-extrabold tracking-tight">{t("coverageTable")}</h3>
          {indicatorLabel && (
            <p className="mt-1 text-sm text-muted-foreground truncate max-w-[250px]" title={indicatorLabel}>
              {indicatorLabel}
            </p>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {sortedRows.length} {t("orgUnitsLabel")}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b text-left text-sm font-semibold text-muted-foreground">
              {/* Org unit name column */}
              <th
                className="cursor-pointer pb-2 pr-4 font-medium hover:text-foreground"
                onClick={() => toggleSort("name")}
              >
                <span className="flex items-center gap-1">
                  {t("orgUnit")}
                  {sortKey === "name" && (
                    <ArrowUpDown className="h-3 w-3" />
                  )}
                </span>
              </th>
              {/* Period columns */}
              {periods.map((pe, idx) => (
                <th
                  key={pe}
                  className="cursor-pointer whitespace-nowrap pb-2 pr-3 text-right font-medium hover:text-foreground"
                  onClick={() => toggleSort(idx)}
                >
                  <span className="flex items-center justify-end gap-1">
                    {formatDhis2PeriodShort(pe)}
                    {sortKey === idx && (
                      <ArrowUpDown className="h-3 w-3" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.id} className="border-b border-border/50 last:border-0 hover:bg-muted/30" style={{ height: ROW_HEIGHT }}>
                {/* Org unit name */}
                <td className="py-1.5 pr-4">
                  <span className="text-sm font-medium truncate block max-w-[180px]" title={row.name}>
                    {row.name}
                  </span>
                </td>
                {/* Values per period */}
                {periods.map((pe) => {
                  const val = row.values[pe];
                  const status = val !== null && val !== undefined
                    ? getThresholdStatus(val, indicatorLabel)
                    : null;
                  return (
                    <td key={pe} className="py-1.5 pr-3 text-right">
                      {val === null || val === undefined ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        <span
                          className={cn(
                            "tabular-nums font-medium",
                            status ? thresholdTextColor(status) : "",
                          )}
                          title={formatDhis2Period(pe)}
                        >
                          {formatCoveragePercent(val)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex shrink-0 items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t("page")} {page + 1} / {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              className="rounded-md border p-1.5 hover:bg-accent disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              className="rounded-md border p-1.5 hover:bg-accent disabled:opacity-50"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
