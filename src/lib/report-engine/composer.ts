/**
 * Report composer — assembles the canonical ReportDocument from the
 * plan, the retrieved data and the analysis results.
 */

import { getReportType } from "./registry";
import { periodLabel, type ReportAnalysis } from "./analysis";
import type { ReportData } from "./data-provider";
import type {
  ReportChart,
  ReportDocument,
  ReportPlan,
  ReportSection,
  ReportTable,
} from "./types";

const AUDIENCE_LABELS: Record<string, string> = {
  EXECUTIVE: "Direction",
  TECHNICAL: "Expert technique",
  PARTNER: "Partenaire",
  DONOR: "Donateur",
  PUBLIC: "Public",
};

export function composeReportDocument(params: {
  plan: ReportPlan;
  data: ReportData;
  analysis: ReportAnalysis;
  generatedBy: string;
  version?: number;
  /** Pre-allocated report/job ID (persistent generation tracking). */
  id?: string;
}): ReportDocument {
  const { plan, data, analysis, generatedBy, version = 1 } = params;
  const definition = getReportType(plan.reportType);
  const now = new Date().toISOString();
  const first = data.periods[0] ?? "";
  const last = data.periods[data.periods.length - 1] ?? "";
  const periodText = first === last ? periodLabel(first) : `${periodLabel(first)} – ${periodLabel(last)}`;
  const coveredText = data.coveredPeriods.length
    ? (data.coveredPeriods.length === 1
        ? periodLabel(data.coveredPeriods[0])
        : `${periodLabel(data.coveredPeriods[0])} – ${periodLabel(data.coveredPeriods[data.coveredPeriods.length - 1])}`)
    : null;
  const title = plan.title || `${definition.name} — ${data.scope.name}`;

  // ─── Transparency callouts (data freshness, scope resolution) ──
  const transparencyBlocks: { type: "callout"; variant: "information" | "warning"; text: string }[] = [];
  if (!data.scope.resolved && data.scope.query) {
    transparencyBlocks.push({
      type: "callout",
      variant: "warning",
      text: `Le périmètre demandé « ${data.scope.query} » n'a pas pu être associé à une unité géographique connue : le rapport est généré au niveau national (RDC). Vérifiez l'orthographe du lieu ou choisissez une province/zone de santé dans les paramètres.`,
    });
  }
  const syncedText = data.syncedAt
    ? ` Snapshot synchronisé le ${new Date(data.syncedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.`
    : "";
  if (coveredText && data.latestPeriod && data.latestPeriod < last) {
    transparencyBlocks.push({
      type: "callout",
      variant: "information",
      text: `Période demandée : ${periodText}. Données effectivement disponibles : ${coveredText} (les mois récents sont encore en cours de rapportage dans le SNIS).${syncedText}`,
    });
  } else if (coveredText && syncedText) {
    transparencyBlocks.push({
      type: "callout",
      variant: "information",
      text: `Données couvrant ${coveredText}.${syncedText}`,
    });
  }

  // ─── Charts ────────────────────────────────────────────────
  const charts: ReportChart[] = [];
  const availableMetrics = data.metrics.filter((m) => m.available);

  for (const metric of availableMetrics.slice(0, 3)) {
    if (metric.trend.length < 2) continue;
    charts.push({
      id: `chart-trend-${charts.length}`,
      type: "line",
      title: `Évolution mensuelle — ${metric.requirement.label}`,
      subtitle: `${data.scope.name}, ${periodText}`,
      categories: metric.trend.map((t) => periodLabel(t.period)),
      series: [{ name: metric.requirement.label, data: metric.trend.map((t) => t.value) }],
      source: metric.source,
    });
  }

  const geoMetric = availableMetrics.find((m) => m.geo.length > 1);
  const geoIsPercent = geoMetric?.requirement.unit === "percent";
  const aggLabel = geoIsPercent ? "Moyenne" : "Cumul";
  if (geoMetric) {
    const top = geoMetric.geo.slice(0, 12);
    charts.push({
      id: "chart-geo",
      type: "bar",
      title: `Comparaison géographique — ${geoMetric.requirement.label}`,
      subtitle: `${aggLabel} ${periodText}, par ${data.scope.level === 1 ? "province" : "zone de santé"}`,
      categories: top.map((g) => g.name),
      series: [{ name: geoMetric.requirement.label, data: top.map((g) => g.value) }],
      source: geoMetric.source,
    });
    if (geoMetric.requirement.unit !== "percent" && geoMetric.geo.length >= 3) {
      const top5 = geoMetric.geo.slice(0, 5);
      const rest = geoMetric.geo.slice(5).reduce((s, g) => s + g.value, 0);
      charts.push({
        id: "chart-distribution",
        type: "donut",
        title: `Répartition — ${geoMetric.requirement.label}`,
        subtitle: `Part des principales unités, cumul ${periodText}`,
        categories: [...top5.map((g) => g.name), ...(rest > 0 ? ["Autres"] : [])],
        series: [{ name: geoMetric.requirement.label, data: [...top5.map((g) => g.value), ...(rest > 0 ? [rest] : [])] }],
        source: geoMetric.source,
      });
    }
  }

  // ─── Tables ────────────────────────────────────────────────
  const tables: ReportTable[] = [];
  if (geoMetric) {
    const total = geoMetric.geo.reduce((s, g) => s + g.value, 0) || 1;
    tables.push({
      id: "table-geo",
      title: `${geoMetric.requirement.label} par unité géographique (${aggLabel.toLowerCase()} ${periodText})`,
      columns: [
        { key: "rank", label: "#", align: "right" },
        { key: "name", label: data.scope.level === 1 ? "Province" : "Zone de santé" },
        { key: "value", label: geoIsPercent ? "Moyenne (%)" : "Valeur cumulée", align: "right" },
        ...(geoIsPercent ? [] : [{ key: "share", label: "Part (%)", align: "right" as const }]),
      ],
      rows: geoMetric.geo.slice(0, 15).map((g, i) => ({
        rank: i + 1,
        name: g.name,
        value: g.value.toLocaleString("fr-FR", { maximumFractionDigits: 1 }),
        ...(geoIsPercent ? {} : { share: `${((g.value / total) * 100).toFixed(1)}%` }),
      })),
      source: geoMetric.source,
    });
  }

  tables.push({
    id: "table-indicators",
    title: "Indicateurs requis et disponibilité des données",
    columns: [
      { key: "label", label: "Indicateur" },
      { key: "status", label: "Disponibilité" },
      { key: "source", label: "Source" },
    ],
    rows: data.metrics.map((m) => ({
      label: m.requirement.label,
      status: m.available
        ? "Disponible"
        : m.requirement.unavailableReason
          ? "Non synchronisé"
          : "Données indisponibles",
      source: m.available ? (m.source ?? "—") : (m.requirement.unavailableReason ?? "—"),
    })),
  });

  // ─── Sections ──────────────────────────────────────────────
  const n = analysis.narrative;
  const sections: ReportSection[] = [];
  let num = 0;
  const numbered = (label: string) => `${++num}. ${label}`;

  sections.push({
    id: "context",
    title: numbered("Contexte et périmètre"),
    blocks: [
      ...transparencyBlocks,
      { type: "paragraph", text: n.context },
      { type: "paragraph", text: definition.description },
      { type: "table", tableId: "table-indicators" },
    ],
  });

  sections.push({
    id: "kpis",
    title: numbered("Indicateurs clés"),
    narrativeTitle: analysis.kpis.some((k) => k.value !== "—")
      ? undefined
      : "Les indicateurs clés n'ont pas pu être évalués faute de données",
    blocks: [{ type: "kpis", kpiIds: analysis.kpis.map((k) => k.id) }],
  });

  const trendCharts = charts.filter((c) => c.id.startsWith("chart-trend"));
  sections.push({
    id: "trend_analysis",
    title: numbered("Analyse des tendances"),
    narrativeTitle: n.keyMessages[0],
    blocks: [
      { type: "paragraph", text: n.trendCommentary },
      ...trendCharts.map((c) => ({ type: "chart" as const, chartId: c.id })),
      ...(trendCharts.length === 0
        ? [{ type: "callout" as const, variant: "warning" as const, text: "Données insuffisantes pour tracer une tendance sur la période demandée." }]
        : []),
    ],
  });

  sections.push({
    id: "geographic_performance",
    title: numbered("Performance géographique"),
    narrativeTitle: n.keyMessages[1],
    blocks: [
      { type: "paragraph", text: n.geoCommentary },
      ...(charts.some((c) => c.id === "chart-geo") ? [{ type: "chart" as const, chartId: "chart-geo" }] : []),
      ...(charts.some((c) => c.id === "chart-distribution") ? [{ type: "chart" as const, chartId: "chart-distribution" }] : []),
      ...(tables.some((t) => t.id === "table-geo") ? [{ type: "table" as const, tableId: "table-geo" }] : []),
      ...(!geoMetric
        ? [{ type: "callout" as const, variant: "warning" as const, text: "Aucune ventilation géographique disponible pour ce périmètre." }]
        : []),
    ],
  });

  sections.push({
    id: "risks",
    title: numbered("Constats, risques et anomalies"),
    blocks: [
      analysis.insights.length > 0
        ? { type: "insights" }
        : { type: "callout", variant: "information", text: "Aucun constat significatif n'a été identifié à partir des données disponibles." },
    ],
  });

  sections.push({
    id: "recommendations",
    title: numbered("Recommandations"),
    blocks: [
      analysis.recommendations.length > 0
        ? { type: "recommendations" }
        : { type: "callout", variant: "information", text: "Aucune recommandation générée : données insuffisantes." },
      { type: "callout", variant: "information", text: "Les recommandations ci-dessus sont des interprétations générées par IA à partir des faits observés ; elles sont distinctes des données sources." },
    ],
  });

  sections.push({
    id: "methodology",
    title: numbered("Méthodologie"),
    blocks: [
      {
        type: "paragraph",
        text:
          "Les données sont extraites de l'entrepôt SIVAX (snapshot synchronisé par pipeline ETL depuis DHIS2 — SNIS RDC et SIGL ESS 2025) et, à défaut, de l'API analytics DHIS2 en temps réel (tentative unique). " +
          "Chaque indicateur correspond à un identifiant DHIS2/SIGL curé — aucune recherche libre de métadonnées n'est utilisée. Les statuts (critique/alerte/cible) appliquent les seuils PEV/OMS du référentiel SIVAX. " +
          "Les mois demandés mais non encore rapportés sont signalés ; les périodes futures sont exclues. " +
          "Les indicateurs sont agrégés mensuellement sur le périmètre sélectionné. Les tendances comparent la première et la dernière période ; les anomalies sont détectées au-delà de 2 écarts-types de la moyenne. " +
          "Le narratif est rédigé par IA exclusivement à partir des faits calculés ; aucune valeur n'est inventée et les indicateurs sans données sont marqués « Données indisponibles ».",
      },
    ],
  });

  sections.push({
    id: "sources",
    title: numbered("Sources de données"),
    blocks: [
      {
        type: "paragraph",
        text: data.sources.length
          ? `Sources utilisées : ${data.sources.join(" ; ")}. Identifiants DHIS2 des métriques : ${data.metrics.filter((m) => m.metricId).map((m) => `${m.requirement.label} (${m.metricId})`).join(", ")}.`
          : "Aucune source de données n'a pu être interrogée avec succès pour ce rapport.",
      },
    ],
  });

  return {
    id: params.id ?? crypto.randomUUID(),
    metadata: {
      title,
      subtitle: definition.name,
      reportType: plan.reportType,
      description: definition.description,
      period: plan.period,
      geographicScope: data.scope.name,
      organizationScope: "PEV RDC / Ministère de la Santé Publique",
      audience: plan.audience,
      language: "fr",
      generatedAt: now,
      version: `v${version}`,
    },
    cover: {
      logoUrl: "/logo_diav1.png",
      title,
      subtitle: definition.name,
      periodLabel: periodText,
      organization: "SIVAX — Decision Intelligence pour la Vaccination",
      author: generatedBy,
      date: new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
      classification: plan.audience === "PUBLIC" ? undefined : "Usage interne",
    },
    executiveSummary: {
      context: n.context,
      summary: n.summary,
      keyResults: n.keyResults,
      keyMessages: n.keyMessages,
    },
    sections,
    kpis: analysis.kpis,
    charts,
    tables,
    insights: analysis.insights,
    recommendations: analysis.recommendations,
    methodology: { description: "Voir la section Méthodologie." },
    sources: data.sources.map((s, i) => ({ id: `src-${i}`, name: s })),
    branding: {
      organization: "SIVAX",
      productName: "SIVAX Report Engine",
      aiDisclosure: `Analyse générée par IA (${AUDIENCE_LABELS[plan.audience] ?? plan.audience} — SIVAX Report Engine). Les faits chiffrés proviennent exclusivement des sources listées.`,
    },
    template: plan.template,
    audit: {
      generatedBy,
      generatedAt: now,
      prompt: plan.prompt,
      aiModel: analysis.aiModel,
      dataSourceIds: data.metrics.filter((m) => m.metricId).map((m) => m.metricId as string),
      reportVersion: version,
    },
    generatedAt: now,
    generatedBy,
  };
}
