"use client";

import { useEffect, useState, useMemo } from "react";
import { Bar } from "react-chartjs-2";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { primaryColor } from "@/lib/chart-setup";

/**
 * Performance — coverage by antigen + province ranking.
 *
 * This is the "Gap" space: which provinces are below threshold?
 * Data comes from /api/provinces?domain=vaccination
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

const COVERAGE_INDICATORS = [
  { id: "v9b9aYsA5PM", name: "Penta3", threshold: 80, inverted: false },
  { id: "k26tJ22Ncpd", name: "Penta1", threshold: 80, inverted: false },
  { id: "cWJXYKCXrLx", name: "BCG", threshold: 50, inverted: false },
  { id: "tNZxs1kE6fy", name: "VAP4", threshold: 80, inverted: false },
];

const DROPOUT_INDICATORS = [
  { id: "MULXtL8iom8", name: "Abandon Penta1-Penta3", threshold: 10, inverted: true },
];

function coverageColor(value: number, threshold: number, inverted?: boolean): string {
  if (inverted) {
    if (value <= threshold * 0.5) return "bg-emerald-500";
    if (value <= threshold) return "bg-amber-500";
    return "bg-rose-500";
  }
  if (value >= threshold + 10) return "bg-emerald-500";
  if (value >= threshold) return "bg-amber-500";
  return "bg-rose-500";
}

function statusBadge(value: number, threshold: number, inverted?: boolean): { label: string; color: string } {
  if (inverted) {
    if (value <= threshold * 0.5) return { label: "Acceptable", color: "text-emerald-600" };
    if (value <= threshold) return { label: "Attention", color: "text-amber-600" };
    return { label: "Critique", color: "text-rose-600" };
  }
  if (value >= threshold + 10) return { label: "Satisfaisant", color: "text-emerald-600" };
  if (value >= threshold) return { label: "Attention", color: "text-amber-600" };
  return { label: "Critique", color: "text-rose-600" };
}

export function Performance() {
  const [loading, setLoading] = useState(true);
  const [provinces, setProvinces] = useState<ProvinceData[]>([]);
  const [selectedIndicator, setSelectedIndicator] = useState("v9b9aYsA5PM");

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

  const allIndicators = [...COVERAGE_INDICATORS, ...DROPOUT_INDICATORS];
  const currentIndicator = allIndicators.find((i) => i.id === selectedIndicator)!;

  const ranking = useMemo(() => {
    return provinces
      .filter((p) => p.indicator_id === selectedIndicator)
      .sort((a, b) => currentIndicator.inverted
        ? b.latest_value - a.latest_value  // descending for dropout (high = bad)
        : b.latest_value - a.latest_value  // descending for coverage (high = good)
      );
  }, [provinces, selectedIndicator, currentIndicator]);

  const chartData = useMemo(() => {
    const color = primaryColor();
    const top10 = ranking.slice(0, 10);
    return {
      labels: top10.map((p) => p.org_unit_name),
      datasets: [{
        label: currentIndicator.name,
        data: top10.map((p) => p.latest_value),
        backgroundColor: top10.map((p) =>
          currentIndicator.inverted
            ? (p.latest_value > currentIndicator.threshold ? "#DC2626" : "#F59E0B")
            : (p.latest_value < currentIndicator.threshold ? "#DC2626" : "#16A34A")
        ),
        borderWidth: 0,
      }],
    };
  }, [ranking, currentIndicator]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (provinces.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border bg-card">
        <p className="text-sm text-muted-foreground">
          Données de province en cours de synchronisation.
          Lancez l'ETL pour récupérer les données DHIS2.
        </p>
      </div>
    );
  }

  const belowThreshold = ranking.filter((p) =>
    currentIndicator.inverted
      ? p.latest_value > currentIndicator.threshold
      : p.latest_value < currentIndicator.threshold
  );

  return (
    <div className="space-y-4">
      {/* ─── Indicator selector ─── */}
      <div className="flex flex-wrap gap-2">
        {allIndicators.map((ind) => (
          <button
            key={ind.id}
            onClick={() => setSelectedIndicator(ind.id)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              selectedIndicator === ind.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            )}
          >
            {ind.name}
          </button>
        ))}
      </div>

      {/* ─── Summary bar ─── */}
      <div className="flex items-center gap-4 rounded-lg border bg-card p-3 text-xs">
        <span className="font-medium">{currentIndicator.name}</span>
        <span className="text-muted-foreground">
          {ranking.length} provinces — Seuil: {currentIndicator.threshold}{currentIndicator.inverted ? "% (max)" : "% (min)"}
        </span>
        <span className="text-rose-600 font-medium">
          {belowThreshold.length} sous le seuil
        </span>
      </div>

      {/* ─── Top 10 chart ─── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">
          Top 10 provinces — {currentIndicator.name}
        </h3>
        <div className="h-64 w-full">
          <Bar
            data={chartData}
            options={{
              indexAxis: "y" as const,
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: { beginAtZero: true },
              },
            }}
          />
        </div>
      </div>

      {/* ─── Full ranking table ─── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Classement complet par province</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">#</th>
                <th className="pb-2 pr-4 font-medium">Province</th>
                <th className="pb-2 pr-4 font-medium">Valeur</th>
                <th className="pb-2 pr-4 font-medium">Statut</th>
                <th className="pb-2 font-medium">Barre</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((p, i) => {
                const badge = statusBadge(p.latest_value, currentIndicator.threshold, currentIndicator.inverted);
                const barWidth = currentIndicator.inverted
                  ? Math.min(p.latest_value / (currentIndicator.threshold * 2) * 100, 100)
                  : Math.min(p.latest_value, 100);
                return (
                  <tr key={p.org_unit_id} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium">{p.org_unit_name}</td>
                    <td className="py-2 pr-4">
                      {p.latest_value.toFixed(1)}{p.unit === "percent" ? "%" : ""}
                    </td>
                    <td className={cn("py-2 pr-4 font-medium", badge.color)}>{badge.label}</td>
                    <td className="py-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", coverageColor(p.latest_value, currentIndicator.threshold, currentIndicator.inverted))}
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
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
