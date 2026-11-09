"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDhis2Period, formatDhis2Value, resolveDhis2Name } from "@/lib/dhis2-format";
import type { Dhis2AnalyticsResult } from "@/types";

interface Dhis2DataTableProps {
  result: Dhis2AnalyticsResult | null;
  loading: boolean;
}

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 80;
const FOOTER_HEIGHT = 48;

export function Dhis2DataTable({ result, loading }: Dhis2DataTableProps) {
  const t = useTranslations("dhis2");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
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

  const { columns, rows, totalPages } = useMemo(() => {
    if (!result?.rows || !result?.metaData) {
      return { columns: [] as string[], rows: [] as string[][], totalPages: 0 };
    }

    const dxItems = result.metaData.dimensions.dx ?? [];
    const peItems = result.metaData.dimensions.pe ?? [];
    const ouItems = result.metaData.dimensions.ou ?? [];

    const cols: string[] = [];
    if (dxItems.length > 1) cols.push(t("indicator"));
    cols.push(t("period"));
    if (ouItems.length > 1) cols.push(t("orgUnit"));
    cols.push(t("value"));

    const displayRows = result.rows.map((r) => {
      const row: string[] = [];
      if (dxItems.length > 1) {
        row.push(resolveDhis2Name(result.metaData?.items, r[0]));
      }
      // Period: convert YYYYMM → "juillet 2025" instead of raw code
      row.push(formatDhis2Period(r[1]) || resolveDhis2Name(result.metaData?.items, r[1]));
      if (ouItems.length > 1) {
        row.push(resolveDhis2Name(result.metaData?.items, r[2]));
      }
      // Value: format large numbers in French locale. Never surface a raw
      // dimension UID (or any non-numeric string) as a measurement value —
      // show "—" instead so a metadata column can't masquerade as data.
      const numValue = Number(r[3]);
      row.push(Number.isFinite(numValue) ? formatDhis2Value(numValue) : "—");
      return row;
    });

    const total = Math.ceil(displayRows.length / pageSize);
    return { columns: cols, rows: displayRows, totalPages: total };
  }, [result, pageSize]);

  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    setPage(0);
  }, [result, pageSize]);

  if (loading) {
    return (
      <div className="h-[calc(2*18rem+1rem)] animate-pulse rounded-xl border bg-card shadow-sm" />
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-[calc(2*18rem+1rem)] items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        {t("noData")}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex h-[calc(2*18rem+1rem)] flex-col rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h3 className="text-sm font-semibold">{t("detailedData")}</h3>
        <span className="text-xs text-muted-foreground">
          {rows.length} {t("rows")}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b text-left text-xs text-muted-foreground">
              {columns.map((col, i) => (
                <th key={i} className="pb-2 pr-4 font-medium">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0" style={{ height: ROW_HEIGHT }}>
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "py-2 pr-4",
                      j === row.length - 1 && "font-medium tabular-nums",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex shrink-0 items-center justify-between">
          <span className="text-xs text-muted-foreground">
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
