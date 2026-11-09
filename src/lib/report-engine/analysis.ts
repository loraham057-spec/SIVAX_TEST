/**
 * ReportAnalysisEngine — turns retrieved data into indicators, trends,
 * anomalies, insights and recommendations.
 *
 * No-hallucination policy: every quantitative statement is computed from
 * the retrieved data. The optional LLM pass only rewrites the narrative
 * from pre-computed facts and is instructed to never add figures.
 * Unavailable data is reported as such.
 */

import { DEFAULT_OPENAI_MODEL, getSetting } from "@/lib/settings";
import { evaluateRequirementThreshold } from "./registry";
import type { Insight, KPI, Recommendation, ReportPlan } from "./types";
import type { MetricData, ReportData } from "./data-provider";

export interface ReportAnalysis {
  kpis: KPI[];
  insights: Insight[];
  recommendations: Recommendation[];
  /** Deterministic factual statements used to build narratives. */
  facts: string[];
  narrative: {
    context: string;
    summary: string;
    keyResults: string[];
    keyMessages: string[];
    trendCommentary: string;
    geoCommentary: string;
  };
  aiModel?: string;
}

const nf = (v: number, digits = 0) => v.toLocaleString("fr-FR", { maximumFractionDigits: digits });

function formatMetricValue(metric: MetricData, value: number): string {
  if (metric.requirement.unit === "percent") return `${nf(value, 1)}%`;
  // Small non-integer counts (e.g. months of stock) keep one decimal.
  return Math.abs(value) < 100 && !Number.isInteger(value) ? nf(value, 1) : nf(value);
}

export function periodLabel(period: string): string {
  const months = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const m = parseInt(period.slice(4, 6), 10);
  return `${months[m - 1] ?? period.slice(4, 6)} ${period.slice(0, 4)}`;
}

interface MetricStats {
  metric: MetricData;
  latest?: { period: string; value: number };
  previous?: { period: string; value: number };
  total: number;
  mean: number;
  deltaPct: number | null;
  trendDirection: "up" | "down" | "neutral";
  top?: { name: string; value: number };
  bottom?: { name: string; value: number };
  anomalies: { period: string; value: number }[];
}

function computeStats(metric: MetricData): MetricStats {
  const trend = metric.trend;
  const values = trend.map((t) => t.value);
  const total = values.reduce((s, v) => s + v, 0);
  const mean = values.length ? total / values.length : 0;
  const latest = trend[trend.length - 1];
  const previous = trend[trend.length - 2];
  const first = trend[0];
  const deltaPct = latest && first && first.value !== 0 ? ((latest.value - first.value) / Math.abs(first.value)) * 100 : null;
  const std = values.length > 2 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length) : 0;
  const anomalies = std > 0 ? trend.filter((t) => Math.abs(t.value - mean) > 2 * std) : [];
  return {
    metric,
    latest,
    previous,
    total,
    mean,
    deltaPct,
    trendDirection: deltaPct === null || Math.abs(deltaPct) < 2 ? "neutral" : deltaPct > 0 ? "up" : "down",
    top: metric.geo[0],
    bottom: metric.geo.length > 1 ? metric.geo[metric.geo.length - 1] : undefined,
    anomalies,
  };
}

function buildKpis(stats: MetricStats[]): KPI[] {
  return stats.map((s, i) => {
    const { metric } = s;
    if (!metric.available || !s.latest) {
      return {
        id: `kpi-${i}`,
        label: metric.requirement.label,
        value: "—",
        comparisonLabel: metric.requirement.unavailableReason ? "Non synchronisé" : "Données indisponibles",
        trend: "neutral" as const,
        status: "neutral" as const,
      };
    }
    const changePct = s.previous && s.previous.value !== 0
      ? ((s.latest.value - s.previous.value) / Math.abs(s.previous.value)) * 100
      : null;
    return {
      id: `kpi-${i}`,
      label: metric.requirement.label,
      value: formatMetricValue(metric, s.latest.value),
      change: changePct === null ? undefined : `${changePct >= 0 ? "+" : ""}${nf(changePct, 1)}%`,
      trend: changePct === null || Math.abs(changePct) < 0.5 ? ("neutral" as const) : changePct > 0 ? ("up" as const) : ("down" as const),
      status: evaluateRequirementThreshold(metric.requirement, s.latest.value),
      comparisonLabel: s.previous
        ? `${periodLabel(s.latest.period)} vs ${periodLabel(s.previous.period)}`
        : `Dernière valeur (${periodLabel(s.latest.period)})`,
    };
  });
}

function buildInsights(stats: MetricStats[], scopeName: string): { insights: Insight[]; facts: string[] } {
  const insights: Insight[] = [];
  const facts: string[] = [];
  let n = 0;

  for (const s of stats) {
    const { metric } = s;
    const name = metric.requirement.label;
    if (!metric.available) {
      facts.push(
        metric.requirement.unavailableReason
          ? `${name} : ${metric.requirement.unavailableReason}`
          : `${name} : données indisponibles pour la période et le périmètre demandés.`,
      );
      continue;
    }

    // Threshold breach on the latest value (PEV semantic layer thresholds)
    if (s.latest && metric.requirement.threshold) {
      const status = evaluateRequirementThreshold(metric.requirement, s.latest.value);
      if (status === "danger" || status === "warning") {
        const t = metric.requirement.threshold;
        const bound = status === "danger" ? t.warning : t.target;
        const sense = metric.requirement.betterLower ? "dépasse" : "est sous";
        const unit = metric.requirement.unit === "percent" ? "%" : "";
        const fact = `${name} : ${formatMetricValue(metric, s.latest.value)} en ${periodLabel(s.latest.period)} ${sense} ${status === "danger" ? "le seuil critique" : "la cible"} de ${nf(bound, 1)}${unit}.`;
        facts.push(fact);
        insights.push({
          id: `insight-${n++}`,
          type: "risk",
          title: `${name} ${status === "danger" ? "au niveau critique" : "en zone d'alerte"} (${formatMetricValue(metric, s.latest.value)})`,
          description: fact,
          severity: status === "danger" ? "critical" : "medium",
          sourceData: metric.metricId ? [metric.metricId] : [],
        });
      }
    }

    if (s.latest && s.deltaPct !== null && s.trendDirection !== "neutral") {
      const dir = s.trendDirection === "up" ? "hausse" : "baisse";
      const fact = `${name} : ${dir} de ${nf(Math.abs(s.deltaPct), 1)}% entre ${periodLabel(metric.trend[0].period)} (${formatMetricValue(metric, metric.trend[0].value)}) et ${periodLabel(s.latest.period)} (${formatMetricValue(metric, s.latest.value)}).`;
      facts.push(fact);
      insights.push({
        id: `insight-${n++}`,
        type: "trend",
        title: `${name} en ${dir} (${s.deltaPct > 0 ? "+" : ""}${nf(s.deltaPct, 1)}%)`,
        description: fact,
        severity: Math.abs(s.deltaPct) > 25 ? "high" : "medium",
        sourceData: metric.metricId ? [metric.metricId] : [],
      });
    }

    if (s.top && s.bottom && s.top.name !== s.bottom.name) {
      const agg = metric.requirement.unit === "percent" ? "moyenne" : "cumulée";
      const fact = `${name} — ${scopeName} : valeur ${agg} la plus élevée à ${s.top.name} (${formatMetricValue(metric, s.top.value)}), la plus faible à ${s.bottom.name} (${formatMetricValue(metric, s.bottom.value)}).`;
      facts.push(fact);
      insights.push({
        id: `insight-${n++}`,
        type: "finding",
        title: `Fortes disparités géographiques — ${name}`,
        description: fact,
        severity: "medium",
        sourceData: metric.metricId ? [metric.metricId] : [],
      });
    }

    for (const anomaly of s.anomalies.slice(0, 2)) {
      const fact = `${name} : valeur atypique en ${periodLabel(anomaly.period)} (${formatMetricValue(metric, anomaly.value)}), écart supérieur à 2 écarts-types par rapport à la moyenne de la période (${formatMetricValue(metric, s.mean)}).`;
      facts.push(fact);
      insights.push({
        id: `insight-${n++}`,
        type: "anomaly",
        title: `Valeur atypique — ${name} (${periodLabel(anomaly.period)})`,
        description: fact,
        severity: "high",
        sourceData: metric.metricId ? [metric.metricId] : [],
      });
    }
  }

  const unavailable = stats.filter((s) => !s.metric.available);
  if (unavailable.length > 0) {
    insights.push({
      id: `insight-${n++}`,
      type: "risk",
      title: "Données partiellement indisponibles",
      description: `${unavailable.length} indicateur(s) requis n'ont pas pu être évalués faute de données : ${unavailable.map((s) => s.metric.requirement.label).join(", ")}. Les constats correspondants sont marqués « Données indisponibles ».`,
      severity: "medium",
    });
  }

  return { insights, facts };
}

function buildRecommendations(stats: MetricStats[], scopeName: string): Recommendation[] {
  const recs: Recommendation[] = [];
  let n = 0;

  for (const s of stats) {
    if (!s.metric.available) continue;
    const name = s.metric.requirement.label;
    const isNegativeMetric = s.metric.requirement.betterLower ?? /abandon|sous-vaccin|rupture|perte/i.test(name);
    const worsening = isNegativeMetric ? s.trendDirection === "up" : s.trendDirection === "down";

    // Threshold breach → corrective action recommendation
    if (s.latest && s.metric.requirement.threshold) {
      const status = evaluateRequirementThreshold(s.metric.requirement, s.latest.value);
      if (status === "danger") {
        recs.push({
          id: `rec-${n++}`,
          title: `Plan d'action correctif — « ${name} »`,
          description: `La dernière valeur observée (${formatMetricValue(s.metric, s.latest.value)} en ${periodLabel(s.latest.period)}) franchit le seuil critique. Déclencher une analyse causale et un plan d'action correctif avec les niveaux concernés.`,
          priority: "high",
          rationale: "Seuil critique PEV/OMS franchi sur la dernière période disponible.",
          expectedImpact: "Retour sous le seuil d'alerte puis vers la cible.",
          timeframe: "Immédiat (≤ 1 mois)",
          responsibleEntity: "PEV / DPS concernées",
        });
      }
    }

    if (worsening && s.deltaPct !== null) {
      recs.push({
        id: `rec-${n++}`,
        title: `Renforcer le suivi de « ${name} »`,
        description: `L'indicateur évolue défavorablement (${s.deltaPct > 0 ? "+" : ""}${nf(s.deltaPct, 1)}% sur la période). Mettre en place une revue mensuelle ciblée et un plan d'action correctif.`,
        priority: Math.abs(s.deltaPct) > 25 ? "high" : "medium",
        rationale: "Tendance défavorable observée dans les données de la période.",
        expectedImpact: "Stabilisation puis amélioration de l'indicateur.",
        timeframe: "1 à 3 mois",
        responsibleEntity: "PEV / DPS concernées",
      });
    }
    if (s.bottom && s.top && s.top.value > 0) {
      // For "lower is better" metrics (ruptures, pertes…), the unit needing
      // support is the one with the HIGHEST value; otherwise the lowest.
      const target = isNegativeMetric ? s.top : s.bottom;
      const direction = isNegativeMetric ? "la plus défavorable (valeur la plus élevée)" : "la plus faible";
      recs.push({
        id: `rec-${n++}`,
        title: `Appui prioritaire aux zones les moins performantes — ${name}`,
        description: `Cibler en priorité ${target.name}, qui présente la valeur ${direction} du périmètre ${scopeName} pour « ${name} ».`,
        priority: "medium",
        rationale: "Disparités géographiques constatées dans les données.",
        expectedImpact: "Réduction des écarts entre zones.",
        timeframe: "3 à 6 mois",
        responsibleEntity: "DPS / Zones de santé",
      });
      break; // one geographic recommendation is enough
    }
  }

  if (stats.some((s) => !s.metric.available)) {
    recs.push({
      id: `rec-${n++}`,
      title: "Améliorer la complétude des données",
      description: "Certains indicateurs requis pour ce type de rapport ne sont pas disponibles dans les sources connectées (DHIS2/entrepôt SIVAX). Vérifier la complétude du rapportage et l'intégration des données logistiques (SMT).",
      priority: "high",
      rationale: "Des indicateurs requis sont marqués « Données indisponibles ».",
      expectedImpact: "Rapports plus complets et décisions mieux informées.",
      timeframe: "1 à 2 mois",
      responsibleEntity: "Équipe data / SNIS",
    });
  }

  return recs.slice(0, 6);
}

function deterministicNarrative(plan: ReportPlan, data: ReportData, stats: MetricStats[], facts: string[]): ReportAnalysis["narrative"] {
  const available = stats.filter((s) => s.metric.available);
  const first = data.periods[0] ?? "";
  const last = data.periods[data.periods.length - 1] ?? "";
  const coverageNote = data.latestPeriod && data.latestPeriod < last
    ? ` Les données ne sont disponibles que jusqu'à ${periodLabel(data.latestPeriod)}.`
    : "";
  const context = `Ce rapport couvre le périmètre ${data.scope.name} sur la période ${periodLabel(first)} – ${periodLabel(last)}.${coverageNote} Il s'appuie sur ${available.length} indicateur(s) disponible(s) sur ${stats.length} requis, issus de ${data.sources.join(" et ") || "sources non disponibles"}.`;
  const summary = available.length
    ? `Sur la période analysée, ${available.length} indicateur(s) ont été évalués. ${facts.slice(0, 3).join(" ")}`
    : "Aucune donnée n'était disponible pour les indicateurs requis sur la période et le périmètre demandés. Les sections analytiques sont présentées avec la mention « Données indisponibles ».";

  const trendFacts = facts.filter((f) => /hausse|baisse/.test(f));
  const geoFacts = facts.filter((f) => /plus élevée|plus faible/.test(f));

  return {
    context,
    summary,
    keyResults: facts.slice(0, 5),
    keyMessages: [
      ...trendFacts.slice(0, 2),
      ...geoFacts.slice(0, 2),
    ].slice(0, 4),
    trendCommentary: trendFacts.join(" ") || "Aucune tendance significative n'a pu être établie à partir des données disponibles.",
    geoCommentary: geoFacts.join(" ") || "Aucune comparaison géographique n'a pu être établie à partir des données disponibles.",
  };
}

async function llmNarrative(
  plan: ReportPlan,
  base: ReportAnalysis["narrative"],
  facts: string[],
): Promise<{ narrative: ReportAnalysis["narrative"]; aiModel?: string } | null> {
  const [apiKey, model] = await Promise.all([getSetting("openai_api_key"), getSetting("openai_model")]);
  if (!apiKey || facts.length === 0) return null;

  const system = `You write the narrative of an institutional health report in French for audience ${plan.audience}.
STRICT RULES: use ONLY the facts provided; NEVER add numbers, dates, trends or claims not present in the facts; keep an institutional, factual tone.
Respond ONLY with JSON: {"context": string, "summary": string (4-6 sentences), "keyMessages": string[] (3-4 short analytical messages), "trendCommentary": string, "geoCommentary": string}.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || DEFAULT_OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Contexte: ${base.context}\n\nFaits calculés (seule source autorisée):\n${facts.map((f) => `- ${f}`).join("\n")}` },
        ],
        reasoning_effort: "none",
        temperature: 0.3,
        max_completion_tokens: 700,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const raw = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    const str = (v: unknown, fb: string) => (typeof v === "string" && v.trim() ? v.trim() : fb);
    return {
      narrative: {
        context: str(raw.context, base.context),
        summary: str(raw.summary, base.summary),
        keyResults: base.keyResults,
        keyMessages: Array.isArray(raw.keyMessages) && raw.keyMessages.length
          ? raw.keyMessages.filter((m: unknown) => typeof m === "string").slice(0, 4)
          : base.keyMessages,
        trendCommentary: str(raw.trendCommentary, base.trendCommentary),
        geoCommentary: str(raw.geoCommentary, base.geoCommentary),
      },
      aiModel: (model as string) || DEFAULT_OPENAI_MODEL,
    };
  } catch {
    return null;
  }
}

export async function analyzeReportData(plan: ReportPlan, data: ReportData): Promise<ReportAnalysis> {
  const stats = data.metrics.map(computeStats);
  const kpis = buildKpis(stats);
  const { insights, facts } = buildInsights(stats, data.scope.name);
  const recommendations = buildRecommendations(stats, data.scope.name);
  const base = deterministicNarrative(plan, data, stats, facts);
  const llm = await llmNarrative(plan, base, facts);

  return {
    kpis,
    insights,
    recommendations,
    facts,
    narrative: llm?.narrative ?? base,
    aiModel: llm?.aiModel,
  };
}
