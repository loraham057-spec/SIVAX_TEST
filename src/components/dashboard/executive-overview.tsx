"use client";

import { useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Syringe,
  Users,
  AlertTriangle,
  ShieldAlert,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { KpiCard, AlertItem, Trend } from "@/types";

/**
 * Executive Overview — national KPIs + alerts + quick synthesis.
 *
 * This is the "Situation" space: where are we nationally?
 * Data comes from /api/kpis (computed from DHIS2 via ETL) and /api/alerts.
 */

const ICON_MAP: Record<string, LucideIcon> = {
  syringe: Syringe,
  users: Users,
  "trending-down": TrendingDown,
  "check-circle": ShieldAlert,
  alert: AlertTriangle,
  activity: Activity,
};

function trendColor(trend: Trend): string {
  if (trend === "up") return "text-emerald-600";
  if (trend === "down") return "text-rose-600";
  return "text-muted-foreground";
}

function severityColor(severity: string): string {
  if (severity === "critical") return "border-rose-500/50 bg-rose-500/10";
  if (severity === "warning") return "border-amber-500/50 bg-amber-500/10";
  return "border-blue-500/50 bg-blue-500/10";
}

export function ExecutiveOverview() {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KpiCard[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/kpis").then((r) => r.json()),
      fetch("/api/alerts").then((r) => r.json()),
    ])
      .then(([k, a]) => {
        if (!active) return;
        setKpis(k ?? []);
        setAlerts(a ?? []);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");

  return (
    <div className="space-y-4">
      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi, i) => {
          const iconName = ["syringe", "syringe", "trending-down", "users"][i] ?? "activity";
          const Icon = ICON_MAP[iconName] ?? Activity;
          const isPlaceholder = kpi.value === "—";
          return (
            <div
              key={kpi.title}
              className={cn(
                "rounded-xl border bg-card p-4 shadow-sm",
                isPlaceholder && "opacity-60"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                {!isPlaceholder && (
                  <span className={cn("flex items-center gap-0.5 text-xs font-medium", trendColor(kpi.trend))}>
                    {kpi.trend === "up" && <TrendingUp className="h-3.5 w-3.5" />}
                    {kpi.trend === "down" && <TrendingDown className="h-3.5 w-3.5" />}
                    {kpi.change}
                  </span>
                )}
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight">{kpi.value}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{kpi.title}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/70">{kpi.description}</p>
            </div>
          );
        })}
      </div>

      {/* ─── Alerts Summary ─── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Alertes prioritaires</h3>
          <div className="flex gap-3 text-xs">
            <span className="flex items-center gap-1 text-rose-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              {criticalAlerts.length} critique(s)
            </span>
            <span className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              {warningAlerts.length} avertissement(s)
            </span>
          </div>
        </div>
        {alerts.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Aucune alerte — données en cours de synchronisation
          </p>
        ) : (
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-xs",
                  severityColor(alert.severity)
                )}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">{alert.title}</p>
                  <p className="mt-0.5 text-muted-foreground">{alert.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">
                    {alert.source} — {alert.timestamp}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Provenance ─── */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span>
          Source: DHIS2 SNIS RDC — données synchronisées via ETL.
          KPIs calculés depuis fact_indicator_values.
        </span>
      </div>
    </div>
  );
}
