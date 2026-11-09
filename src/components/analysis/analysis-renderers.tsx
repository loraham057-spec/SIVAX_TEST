"use client";

/**
 * 8 specialized analysis renderers for the Decision Intelligence platform.
 *
 * Each renderer consumes the AnalysisPayload produced by the backend agent
 * and renders a decision-oriented visual answer.
 *
 * Render types:
 * 1. kpi_answer       — KPI cards with thresholds and status
 * 2. ranking_answer   — ranked table of provinces
 * 3. trend_answer     — time series with direction
 * 4. diagnostic_answer — gaps + correlations + hypotheses
 * 5. geographic_answer — risk scores by province + factors
 * 6. comparative_answer — comparative table between provinces
 * 7. alert_answer     — prioritized alert cards
 * 8. executive_brief  — executive summary + action recommendations
 */

import { useMemo } from "react";
import { Line, Bar } from "react-chartjs-2";
import {
  TrendingUp,
  TrendingDown,
  Syringe,
  Users,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Lightbulb,
  Target,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { primaryColor } from "@/lib/chart-setup";
import { formatDhis2PeriodAxis, formatDhis2PeriodShort } from "@/lib/dhis2-format";
import { ConfidenceBadge, confidenceLabelToVariant } from "@/components/analysis/confidence-badge";
import type { AnalysisPayload, AnalysisCell, Trend } from "@/types";

// ─── Shared helpers ─────────────────────────────────────────

function formatNum(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("fr-FR");
}

function comparisonLabel(operator: string): string {
  return { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" }[operator] ?? operator;
}

function thresholdStatus(value: number, thresholds?: Record<string, number> | null, inverted?: boolean): {
  label: string;
  color: string;
} {
  if (!thresholds) return { label: "—", color: "text-muted-foreground" };
  if (inverted) {
    if (value >= (thresholds.critical ?? Infinity)) return { label: "Critique", color: "text-rose-600" };
    if (value >= (thresholds.warning ?? Infinity)) return { label: "Attention", color: "text-amber-600" };
    return { label: "Acceptable", color: "text-emerald-600" };
  }
  if (value < (thresholds.critical ?? -Infinity)) return { label: "Critique", color: "text-rose-600" };
  if (value < (thresholds.warning ?? -Infinity)) return { label: "Attention", color: "text-amber-600" };
  return { label: "Satisfaisant", color: "text-emerald-600" };
}

function riskLevel(score: number): { label: string; color: string; icon: LucideIcon } {
  if (score >= 70) return { label: "Critique", color: "text-rose-600 bg-rose-500/10", icon: ShieldAlert };
  if (score >= 50) return { label: "Élevé", color: "text-amber-600 bg-amber-500/10", icon: AlertTriangle };
  if (score >= 30) return { label: "Modéré", color: "text-blue-600 bg-blue-500/10", icon: AlertTriangle };
  return { label: "Faible", color: "text-emerald-600 bg-emerald-500/10", icon: ShieldCheck };
}

// ─── 1. KPI Answer ──────────────────────────────────────────

export function KpiAnswerRenderer({ payload }: { payload: AnalysisPayload }) {
  const summary = payload.summary;
  const metric = payload.metric;
  const facts = payload.verified_facts;
  const indicators = payload.indicators ?? [];

  // If we have indicators with thresholds, show them as KPI cards
  if (indicators.length > 0 && facts?.cells) {
    const cellsByIndicator: Record<string, AnalysisCell[]> = {};
    for (const cell of facts.cells) {
      if (!cellsByIndicator[cell.orgUnitId]) cellsByIndicator[cell.orgUnitId] = [];
      // Group by indicator — but cells don't carry indicator_id, so use the metric
    }
  }

  // Single KPI mode
  const total = summary?.total ?? facts?.total ?? 0;
  const unit = indicators[0]?.unit ?? "count";
  const thresholds = indicators[0]?.thresholds;
  const isPercent = unit === "percent" || ["proportion", "rate"].includes(payload.response_contract?.measurement_type ?? "");
  const displayValue = isPercent ? `${total.toFixed(1)}%` : formatNum(total);
  const status = thresholdStatus(total, thresholds, false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Primary KPI */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Syringe className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-center gap-1.5">
              {facts?.cells && facts.cells.length > 0 && (
                <ConfidenceBadge variant="verified" />
              )}
              <span className={cn("text-xs font-medium", status.color)}>{status.label}</span>
            </div>
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight">{displayValue}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {metric?.display_name ?? metric?.name ?? "Indicateur"}
          </p>
          {payload.query_scope && (
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              {payload.query_scope.orgUnitName} — {payload.query_scope.periods?.map(formatDhis2PeriodShort).join(", ")}
            </p>
          )}
        </div>

        {/* Summary stats */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Activity className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-3 text-2xl font-bold tracking-tight">{summary?.rowCount ?? 0}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Lignes de données</p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            {summary?.orgUnitCount ?? 0} unités — {summary?.periodCount ?? 0} périodes
          </p>
        </div>

        {/* Threshold info */}
        {thresholds && (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-4 w-4 text-primary" />
            </div>
            <p className="mt-3 text-sm font-bold">Seuils de référence</p>
            <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground">
              <p>Cible: {thresholds.target}{isPercent ? "%" : ""}</p>
              <p>Attention: {thresholds.warning}{isPercent ? "%" : ""}</p>
              <p>Critique: {thresholds.critical}{isPercent ? "%" : ""}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 2. Ranking Answer ──────────────────────────────────────

export function RankingAnswerRenderer({ payload }: { payload: AnalysisPayload }) {
  const facts = payload.verified_facts;
  const cells = facts?.cells ?? [];
  const indicators = payload.indicators ?? [];
  const thresholds = indicators[0]?.thresholds;
  const isPercent = indicators[0]?.unit === "percent" || ["proportion", "rate"].includes(payload.response_contract?.measurement_type ?? "");
  const derived = payload.summary?.derived;

  // Group by org unit and take the latest value
  const ranking = useMemo(() => {
    const byOrg: Record<string, { name: string; value: number; period: string }> = {};
    for (const cell of cells) {
      const existing = byOrg[cell.orgUnitId];
      if (!existing || cell.period > existing.period) {
        byOrg[cell.orgUnitId] = {
          name: cell.orgUnitName,
          value: cell.value,
          period: cell.period,
        };
      }
    }
    return Object.entries(byOrg)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.value - a.value);
  }, [cells]);

  if (ranking.length === 0) {
    return <EmptyState message="Aucune donnée de classement disponible" />;
  }

  return (
    <div className="space-y-4">
      {derived?.value != null && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Proportion conforme</p>
            <p className="mt-1 text-2xl font-bold">{derived.value.toFixed(1)}%</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Numérateur / dénominateur</p>
            <p className="mt-1 text-2xl font-bold">{derived.numerator} / {derived.denominator}</p>
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Règle appliquée</p>
            <p className="mt-1 text-2xl font-bold">
              {comparisonLabel(derived.comparison_operator)} {derived.threshold}%
            </p>
          </div>
        </div>
      )}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">
          Classement — {indicators[0]?.short_name ?? payload.metric?.name ?? "Indicateur"}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">#</th>
                <th className="pb-2 pr-4 font-medium">Province / Zone</th>
                <th className="pb-2 pr-4 font-medium">Valeur</th>
                {thresholds && <th className="pb-2 pr-4 font-medium">Statut</th>}
                <th className="pb-2 font-medium">Période</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((row, i) => {
                const status = thresholdStatus(row.value, thresholds, false);
                return (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium">{row.name}</td>
                    <td className="py-2 pr-4 font-bold">
                      {isPercent ? `${row.value.toFixed(1)}%` : formatNum(row.value)}
                    </td>
                    {thresholds && <td className={cn("py-2 pr-4 font-medium", status.color)}>{status.label}</td>}
                    <td className="py-2 text-muted-foreground">{formatDhis2PeriodShort(row.period)}</td>
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

// ─── 3. Trend Answer ────────────────────────────────────────

export function TrendAnswerRenderer({ payload }: { payload: AnalysisPayload }) {
  const facts = payload.verified_facts;
  const cells = facts?.cells ?? [];
  const metric = payload.metric;
  const isPercent = payload.indicators?.[0]?.unit === "percent" || ["proportion", "rate"].includes(payload.response_contract?.measurement_type ?? "");

  // Group by period, sum counts and average rates across org units
  const series = useMemo(() => {
    const byPeriod: Record<string, number[]> = {};
    for (const cell of cells) {
      if (!byPeriod[cell.period]) byPeriod[cell.period] = [];
      byPeriod[cell.period].push(cell.value);
    }
    return Object.entries(byPeriod)
      .map(([period, values]) => ({
        period,
        value: isPercent
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : values.reduce((sum, value) => sum + value, 0),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }, [cells, isPercent]);

  const chartData = useMemo(() => {
    const color = primaryColor();
    return {
      labels: series.map((s) => formatDhis2PeriodAxis(s.period)),
      datasets: [{
        label: metric?.display_name ?? metric?.name ?? "Valeur",
        data: series.map((s) => s.value),
        borderColor: color,
        backgroundColor: color + "20",
        fill: true,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
        pointBackgroundColor: color,
        borderWidth: 2,
      }],
    };
  }, [series, metric]);

  if (series.length < 2) {
    return <EmptyState message="Données insuffisantes pour afficher une tendance" />;
  }

  // Compute trend direction
  const first = series[0].value;
  const last = series[series.length - 1].value;
  const pctChange = first > 0 ? ((last - first) / first) * 100 : 0;
  const trend: Trend = pctChange > 0.5 ? "up" : pctChange < -0.5 ? "down" : "neutral";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Évolution — {metric?.display_name ?? metric?.name ?? "Indicateur"}
          </h3>
          <div className="flex items-center gap-2">
            {cells.length > 0 && <ConfidenceBadge variant="verified" />}
            <span className={cn(
              "flex items-center gap-1 text-xs font-medium",
              trend === "up" ? "text-emerald-600" : trend === "down" ? "text-rose-600" : "text-muted-foreground"
            )}>
              {trend === "up" && <TrendingUp className="h-3.5 w-3.5" />}
              {trend === "down" && <TrendingDown className="h-3.5 w-3.5" />}
              {pctChange >= 0 ? "+" : ""}{pctChange.toFixed(1)}%
            </span>
          </div>
        </div>
        <div className="h-56 w-full">
          <Line data={chartData} options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
          }} />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>Début: {isPercent ? `${first.toFixed(1)}%` : formatNum(first)}</span>
          <span>Fin: {isPercent ? `${last.toFixed(1)}%` : formatNum(last)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── 4. Diagnostic Answer ───────────────────────────────────

export function DiagnosticAnswerRenderer({ payload }: { payload: AnalysisPayload }) {
  const diag = payload.diagnostic;
  if (!diag) {
    return <EmptyState message="Aucun diagnostic disponible" />;
  }

  return (
    <div className="space-y-4">
      {/* Gap summary */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Diagnostic — {diag.primary_indicator.name}</h3>
          <span className="text-xs text-rose-600 font-medium">
            {diag.provinces_below_threshold} province(s) sous le seuil
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Province</th>
                <th className="pb-2 pr-4 font-medium">Valeur</th>
                <th className="pb-2 pr-4 font-medium">Statut</th>
                <th className="pb-2 font-medium">Écart à la cible</th>
              </tr>
            </thead>
            <tbody>
              {diag.gaps.map((gap) => (
                <tr key={gap.org_unit_id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{gap.org_unit_name}</td>
                  <td className="py-2 pr-4 font-bold">{gap.value.toFixed(1)}%</td>
                  <td className={cn(
                    "py-2 pr-4 font-medium",
                    gap.status === "critical" ? "text-rose-600" : "text-amber-600"
                  )}>
                    {gap.label}
                  </td>
                  <td className="py-2 text-amber-600 font-medium">
                    {gap.gap_to_target !== null ? `${gap.gap_to_target.toFixed(1)} pts` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Correlations */}
      {diag.factors.length > 0 && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Facteurs associés</h3>
          <div className="space-y-2">
            {diag.factors.map((f) => (
              <div key={f.indicator_id} className="flex items-center justify-between rounded-lg border p-2 text-xs">
                <span className="font-medium">{f.name}</span>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "font-bold",
                    Math.abs(f.correlation) >= 0.7 ? "text-rose-600" : Math.abs(f.correlation) >= 0.4 ? "text-amber-600" : "text-muted-foreground"
                  )}>
                    r = {f.correlation.toFixed(2)}
                  </span>
                  <span className="text-muted-foreground">{f.interpretation}</span>
                  {f.confidence && (
                    <ConfidenceBadge
                      variant={confidenceLabelToVariant(f.confidence.label)}
                      score={f.confidence.score}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hypotheses */}
      {diag.hypotheses.length > 0 && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
          <div className="flex items-start gap-2">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-blue-600">Hypothèses</p>
              <ul className="mt-1 space-y-2 text-xs text-muted-foreground">
                {diag.hypotheses.map((h, i) => {
                  // Hypotheses can be either a string (legacy) or an object
                  // with text + confidence (new format from diagnostic_engine)
                  const text = typeof h === "string" ? h : h.text;
                  const conf = typeof h === "string" ? null : h.confidence;
                  return (
                    <li key={i} className="leading-relaxed">
                      <span>{text}</span>
                      {conf && !conf.factors?.disclaimer && (
                        <span className="ml-2">
                          <ConfidenceBadge
                            variant={confidenceLabelToVariant(conf.label)}
                            score={conf.score}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 5. Geographic Answer (Risk Scores) ─────────────────────

export function GeographicAnswerRenderer({ payload }: { payload: AnalysisPayload }) {
  const scores = payload.risk_scores ?? [];
  if (scores.length === 0) {
    return <EmptyState message="Aucun score de risque disponible" />;
  }

  const critical = scores.filter((s) => s.score >= 70);
  const high = scores.filter((s) => s.score >= 50 && s.score < 70);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-lg border bg-card p-3 text-xs">
        <span className="font-medium">Zones à risque</span>
        <span className="text-rose-600 font-medium">{critical.length} critique(s)</span>
        <span className="text-amber-600 font-medium">{high.length} élevé(s)</span>
        <span className="text-muted-foreground">{scores.length} provinces</span>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Classement par score de risque</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">#</th>
                <th className="pb-2 pr-4 font-medium">Province</th>
                <th className="pb-2 pr-4 font-medium">Score</th>
                <th className="pb-2 pr-4 font-medium">Niveau</th>
                <th className="pb-2 font-medium">Facteurs clés</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s, i) => {
                const level = riskLevel(s.score);
                const Icon = level.icon;
                const factorList = Object.entries(s.factors)
                  .sort((a, b) => b[1].contribution - a[1].contribution)
                  .slice(0, 2)
                  .map(([k]) => k.replace(/_/g, " "));
                return (
                  <tr key={s.org_unit_id} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium">{s.org_unit_name}</td>
                    <td className="py-2 pr-4"><span className="text-base font-bold">{s.score}</span><span className="text-[10px] text-muted-foreground">/100</span></td>
                    <td className="py-2 pr-4">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", level.color)}>
                        <Icon className="h-3 w-3" />{level.label}
                      </span>
                    </td>
                    <td className="py-2 text-muted-foreground">{factorList.join(", ") || "—"}</td>
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

// ─── 6. Comparative Answer ──────────────────────────────────

export function ComparativeAnswerRenderer({ payload }: { payload: AnalysisPayload }) {
  const facts = payload.verified_facts;
  const cells = facts?.cells ?? [];
  const indicators = payload.indicators ?? [];

  // Build comparative table: rows = provinces, columns = indicators
  const comparative = useMemo(() => {
    const orgUnits: Record<string, string> = {};
    const values: Record<string, Record<string, number>> = {};

    for (const cell of cells) {
      orgUnits[cell.orgUnitId] = cell.orgUnitName;
      if (!values[cell.orgUnitId]) values[cell.orgUnitId] = {};
      // Use the latest period for each org unit + indicator
      values[cell.orgUnitId][cell.period] = cell.value; // simplified
    }

    return Object.entries(orgUnits).map(([id, name]) => ({
      id,
      name,
      values: values[id] ?? {},
    }));
  }, [cells]);

  if (comparative.length === 0) {
    return <EmptyState message="Aucune donnée comparative disponible" />;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Comparaison entre provinces</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Province</th>
                {indicators.map((ind) => (
                  <th key={ind.id} className="pb-2 pr-4 font-medium text-right">{ind.short_name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparative.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{row.name}</td>
                  {indicators.map((ind) => {
                    const val = Object.values(row.values)[0];
                    return (
                      <td key={ind.id} className="py-2 pr-4 text-right font-bold">
                        {val !== undefined ? (ind.unit === "percent" ? `${val.toFixed(1)}%` : formatNum(val)) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 7. Alert Answer ────────────────────────────────────────

export function AlertAnswerRenderer({ payload }: { payload: AnalysisPayload }) {
  const alerts = payload.alerts ?? [];
  if (alerts.length === 0) {
    return <EmptyState message="Aucune alerte disponible" />;
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => {
        const severityColor = alert.severity === "critical"
          ? "border-rose-500/50 bg-rose-500/10"
          : alert.severity === "warning"
          ? "border-amber-500/50 bg-amber-500/10"
          : "border-blue-500/50 bg-blue-500/10";
        const Icon = alert.severity === "critical" ? ShieldAlert : AlertTriangle;
        return (
          <div key={alert.id} className={cn("flex items-start gap-2 rounded-lg border p-3 text-xs", severityColor)}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">{alert.title}</p>
              <p className="mt-0.5 text-muted-foreground">{alert.message}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/70">{alert.source}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 8. Executive Brief ─────────────────────────────────────

export function ExecutiveBriefRenderer({ payload }: { payload: AnalysisPayload }) {
  const brief = payload.executive_brief;
  if (!brief) {
    // Auto-generate a brief from available payload data
    const summary = payload.summary;
    const metric = payload.metric;
    const facts = payload.verified_facts;
    return (
      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Synthèse décisionnelle</h3>
          <div className="space-y-3 text-xs">
            <div>
              <p className="font-medium text-foreground">Situation</p>
              <p className="mt-0.5 text-muted-foreground">
                {metric?.display_name ?? metric?.name ?? "Indicateur"}:{" "}
                {summary ? (payload.indicators?.[0]?.unit === "percent"
                  ? `${summary.total.toFixed(1)}%`
                  : formatNum(summary.total)) : "données en cours"}
                {" "}sur {summary?.orgUnitCount ?? 0} unités géographiques.
              </p>
            </div>
            {payload.diagnostic && (
              <div>
                <p className="font-medium text-foreground">Écarts</p>
                <p className="mt-0.5 text-muted-foreground">
                  {payload.diagnostic.provinces_below_threshold} province(s) sous le seuil.
                </p>
              </div>
            )}
            {payload.risk_scores && payload.risk_scores.length > 0 && (
              <div>
                <p className="font-medium text-foreground">Zones prioritaires</p>
                <p className="mt-0.5 text-muted-foreground">
                  {payload.risk_scores.filter((s) => s.score >= 70).length} province(s) en risque critique.
                  Top 3: {payload.risk_scores.slice(0, 3).map((s) => s.org_unit_name).join(", ")}.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Synthèse décisionnelle</h3>
        <div className="space-y-3 text-xs">
          {brief.situation && (
            <div>
              <p className="font-medium text-foreground">Situation</p>
              <p className="mt-0.5 text-muted-foreground">{brief.situation}</p>
            </div>
          )}
          {brief.gaps && (
            <div>
              <p className="font-medium text-foreground">Écarts identifiés</p>
              <p className="mt-0.5 text-muted-foreground">{brief.gaps}</p>
            </div>
          )}
          {brief.diagnosis && (
            <div>
              <p className="font-medium text-foreground">Diagnostic</p>
              <p className="mt-0.5 text-muted-foreground">{brief.diagnosis}</p>
            </div>
          )}
          {brief.risk && (
            <div>
              <p className="font-medium text-foreground">Zones à risque</p>
              <p className="mt-0.5 text-muted-foreground">{brief.risk}</p>
            </div>
          )}
          {brief.actions.length > 0 && (
            <div className="border-t pt-2">
              <p className="font-medium text-foreground">Pistes d'action</p>
              <ul className="mt-1 space-y-1 text-muted-foreground">
                {brief.actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-primary">→</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty State ────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-xl border bg-card">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
