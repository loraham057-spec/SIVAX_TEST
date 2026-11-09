/**
 * GET /api/kpis
 *
 * Returns KPI card data for the dashboard.
 *
 * Tries to compute KPIs from real DHIS2 data (via v_latest_kpi_values view).
 * Falls back to the static kpis table if no ETL data is available yet.
 *
 * Vaccination KPIs (computed from fact_indicator_values):
 *   - Couverture Penta3 (v9b9aYsA5PM)
 *   - Couverture BCG (cWJXYKCXrLx)
 *   - Abandon Penta1-Penta3 (MULXtL8iom8)
 *   - Enfants sous-vaccinés (RMHgIqfBG7N)
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiError } from "../_lib/proxy";
import type { KpiCard, Trend } from "@/types";

// Mapping: KPI title → DHIS2 indicator ID
const VACCINATION_KPI_MAP: Record<string, {
  indicatorId: string;
  unit: "count" | "percent";
  description: string;
  sortOrder: number;
}> = {
  "Couverture Penta3": {
    indicatorId: "v9b9aYsA5PM",
    unit: "percent",
    description: "Taux de couverture vaccinale Pentavalent 3 (national)",
    sortOrder: 1,
  },
  "Couverture BCG": {
    indicatorId: "cWJXYKCXrLx",
    unit: "percent",
    description: "Taux de couverture vaccinale BCG (national)",
    sortOrder: 2,
  },
  "Abandon Penta1-Penta3": {
    indicatorId: "MULXtL8iom8",
    unit: "percent",
    description: "Taux d'abandon entre Penta1 et Penta3 (national)",
    sortOrder: 3,
  },
  "Enfants sous-vaccinés": {
    indicatorId: "RMHgIqfBG7N",
    unit: "count",
    description: "Nombre d'enfants sous-vaccinés (national)",
    sortOrder: 4,
  },
};

function formatValue(value: number, unit: "count" | "percent"): string {
  if (unit === "percent") {
    return `${value.toFixed(1)}%`;
  }
  return new Intl.NumberFormat("fr-FR").format(Math.round(value));
}

function formatChange(pctChange: number | null): { change: string; trend: Trend } {
  if (pctChange === null || isNaN(pctChange)) {
    return { change: "—", trend: "neutral" };
  }
  const sign = pctChange >= 0 ? "+" : "";
  return {
    change: `${sign}${pctChange.toFixed(1)}%`,
    trend: pctChange > 0.5 ? "up" : pctChange < -0.5 ? "down" : "neutral",
  };
}

export async function GET() {
  const supabase = createSupabaseAdminClient();

  // ─── Try computing KPIs from real DHIS2 data ──────────────
  const { data: realData, error: realError } = await supabase
    .from("v_latest_kpi_values")
    .select("*")
    .in("indicator_id", Object.values(VACCINATION_KPI_MAP).map(k => k.indicatorId));

  if (!realError && realData && realData.length > 0) {
    // Build a lookup: indicator_id → latest value
    const valueMap = new Map(realData.map(r => [r.indicator_id, r]));

    const kpis: KpiCard[] = Object.entries(VACCINATION_KPI_MAP).map(([title, config]) => {
      const row = valueMap.get(config.indicatorId);
      if (!row || row.latest_value === null) {
        return {
          title,
          value: "—",
          change: "—",
          trend: "neutral" as Trend,
          description: config.description,
        };
      }
      const { change, trend } = formatChange(row.pct_change);
      return {
        title,
        value: formatValue(Number(row.latest_value), config.unit),
        change,
        trend,
        description: config.description,
      };
    });

    // Sort by sortOrder
    kpis.sort((a, b) => {
      const sa = Object.entries(VACCINATION_KPI_MAP).find(([t]) => t === a.title)?.[1].sortOrder ?? 99;
      const sb = Object.entries(VACCINATION_KPI_MAP).find(([t]) => t === b.title)?.[1].sortOrder ?? 99;
      return sa - sb;
    });

    return Response.json(kpis);
  }

  // ─── Fallback: static kpis table (may contain placeholder "—" values) ───
  const { data, error } = await supabase
    .from("kpis")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    return apiError(error.message, 500);
  }

  const kpis: KpiCard[] = (data ?? []).map((row) => ({
    title: row.title,
    value: row.value,
    change: row.change,
    trend: row.trend,
    description: row.description,
  }));

  return Response.json(kpis);
}
