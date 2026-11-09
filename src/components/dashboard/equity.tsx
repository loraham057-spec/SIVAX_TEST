"use client";

import { useEffect, useState, useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Equity — disparities between provinces.
 *
 * This space answers: what are the gaps between the best and worst performing provinces?
 * Shows: min/max/median, gap ratio, and a comparative table.
 */

interface ProvinceData {
  indicator_id: string;
  label: string;
  unit: string;
  domain: string;
  org_unit_id: string;
  org_unit_name: string;
  latest_period: string;
  latest_value: number;
}

const EQUITY_INDICATORS = [
  { id: "v9b9aYsA5PM", name: "Couverture Penta3" },
  { id: "cWJXYKCXrLx", name: "Couverture BCG" },
  { id: "k26tJ22Ncpd", name: "Couverture Penta1" },
  { id: "MULXtL8iom8", name: "Abandon Penta1-Penta3" },
];

function quartile(values: number[]): { min: number; q1: number; median: number; q3: number; max: number } {
  if (values.length === 0) return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const lowerHalf = sorted.slice(0, mid);
  const upperHalf = sorted.slice(mid + (sorted.length % 2 ? 1 : 0));
  return {
    min: sorted[0],
    q1: lowerHalf.length ? lowerHalf[Math.floor(lowerHalf.length / 2)] : sorted[0],
    median,
    q3: upperHalf.length ? upperHalf[Math.floor(upperHalf.length / 2)] : sorted[sorted.length - 1],
    max: sorted[sorted.length - 1],
  };
}

export function Equity() {
  const [loading, setLoading] = useState(true);
  const [provinces, setProvinces] = useState<ProvinceData[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/provinces?domain=vaccination")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setProvinces(data ?? []);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const equityData = useMemo(() => {
    return EQUITY_INDICATORS.map((ind) => {
      const values = provinces
        .filter((p) => p.indicator_id === ind.id)
        .map((p) => p.latest_value);
      const stats = quartile(values);
      const gap = stats.max - stats.min;
      const gapRatio = stats.min > 0 ? stats.max / stats.min : Infinity;
      return { ...ind, stats, gap, gapRatio, count: values.length };
    });
  }, [provinces]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (provinces.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border bg-card">
        <p className="text-sm text-muted-foreground">
          Données de province en cours de synchronisation.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─── Equity summary cards ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {equityData.map((ind) => {
          const gapLevel = ind.gapRatio > 3 ? "critical" : ind.gapRatio > 2 ? "warning" : "good";
          const gapColor = gapLevel === "critical" ? "text-rose-600" : gapLevel === "warning" ? "text-amber-600" : "text-emerald-600";
          const gapLabel = gapLevel === "critical" ? "Inégalité critique" : gapLevel === "warning" ? "Inégalité modérée" : "Équité acceptable";
          return (
            <div key={ind.id} className="rounded-xl border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-semibold">{ind.name}</h3>
              <div className="mt-3 grid grid-cols-5 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">Min</p>
                  <p className="text-sm font-bold text-rose-600">{ind.stats.min.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Q1</p>
                  <p className="text-sm font-bold">{ind.stats.q1.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Méd</p>
                  <p className="text-sm font-bold text-primary">{ind.stats.median.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Q3</p>
                  <p className="text-sm font-bold">{ind.stats.q3.toFixed(1)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Max</p>
                  <p className="text-sm font-bold text-emerald-600">{ind.stats.max.toFixed(1)}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs">
                <span className="text-muted-foreground">
                  Écart: {ind.gap.toFixed(1)} — Ratio: {ind.gapRatio === Infinity ? "∞" : ind.gapRatio.toFixed(1)}x
                </span>
                <span className={cn("font-medium", gapColor)}>{gapLabel}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Comparative table: best vs worst ─── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Comparatif: meilleures vs pires provinces</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Indicateur</th>
                <th className="pb-2 pr-4 font-medium">Meilleure province</th>
                <th className="pb-2 pr-4 font-medium">Valeur</th>
                <th className="pb-2 pr-4 font-medium">Pire province</th>
                <th className="pb-2 pr-4 font-medium">Valeur</th>
                <th className="pb-2 font-medium">Écart</th>
              </tr>
            </thead>
            <tbody>
              {equityData.map((ind) => {
                const indProvinces = provinces
                  .filter((p) => p.indicator_id === ind.id)
                  .sort((a, b) => b.latest_value - a.latest_value);
                const best = indProvinces[0];
                const worst = indProvinces[indProvinces.length - 1];
                if (!best || !worst) return null;
                return (
                  <tr key={ind.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{ind.name}</td>
                    <td className="py-2 pr-4 text-emerald-600">{best.org_unit_name}</td>
                    <td className="py-2 pr-4 font-bold">{best.latest_value.toFixed(1)}</td>
                    <td className="py-2 pr-4 text-rose-600">{worst.org_unit_name}</td>
                    <td className="py-2 pr-4 font-bold">{worst.latest_value.toFixed(1)}</td>
                    <td className="py-2 font-bold text-amber-600">
                      {(best.latest_value - worst.latest_value).toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
