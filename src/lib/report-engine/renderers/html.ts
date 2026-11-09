/**
 * HTML Renderer — produces a self-contained, responsive, printable
 * HTML document from a ReportDocument (SVG vector charts inline).
 */

import { buildChartModel, renderChartSvg } from "../chart-model";
import { getReportTheme } from "../templates";
import type { KPI, ReportBlock, ReportDocument, ReportTemplateId } from "../types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const SEVERITY_LABELS: Record<string, string> = { low: "Faible", medium: "Moyen", high: "Élevé", critical: "Critique" };
const PRIORITY_LABELS: Record<string, string> = { low: "Priorité faible", medium: "Priorité moyenne", high: "Priorité élevée" };
const INSIGHT_LABELS: Record<string, string> = { finding: "Constat", trend: "Tendance", anomaly: "Anomalie", risk: "Risque" };

function trendArrow(kpi: KPI): string {
  if (kpi.trend === "up") return "▲";
  if (kpi.trend === "down") return "▼";
  return "";
}

export function renderReportHtml(doc: ReportDocument, templateOverride?: ReportTemplateId): string {
  const theme = getReportTheme(templateOverride ?? doc.template);
  const c = theme.colors;
  const t = theme.typography;
  const kpiById = new Map(doc.kpis.map((k) => [k.id, k]));
  const chartById = new Map(doc.charts.map((ch) => [ch.id, ch]));
  const tableById = new Map(doc.tables.map((tb) => [tb.id, tb]));

  const renderKpi = (kpi: KPI) => `
    <div class="kpi">
      <div class="kpi-value">${esc(kpi.value)}${kpi.unit ? ` <span class="kpi-unit">${esc(kpi.unit)}</span>` : ""}</div>
      <div class="kpi-label">${esc(kpi.label)}</div>
      ${kpi.change ? `<div class="kpi-change ${kpi.trend ?? "neutral"}">${trendArrow(kpi)} ${esc(kpi.change)}${kpi.comparisonLabel ? ` <span class="muted">${esc(kpi.comparisonLabel)}</span>` : ""}</div>` : kpi.comparisonLabel ? `<div class="kpi-change neutral muted">${esc(kpi.comparisonLabel)}</div>` : ""}
    </div>`;

  const renderBlock = (block: ReportBlock): string => {
    switch (block.type) {
      case "paragraph":
        return `<p>${esc(block.text)}</p>`;
      case "kpis":
        return `<div class="kpi-grid">${block.kpiIds.map((id) => kpiById.get(id)).filter(Boolean).map((k) => renderKpi(k as KPI)).join("")}</div>`;
      case "chart": {
        const chart = chartById.get(block.chartId);
        if (!chart) return "";
        const svg = renderChartSvg(buildChartModel(chart, theme), theme, { width: 680, height: chart.type === "donut" ? 240 : 300 });
        return `<figure class="chart">
          <figcaption><strong>${esc(chart.title)}</strong>${chart.subtitle ? `<span class="muted"> — ${esc(chart.subtitle)}</span>` : ""}</figcaption>
          ${svg}
          ${chart.source ? `<div class="source">Source : ${esc(chart.source)}</div>` : ""}
        </figure>`;
      }
      case "table": {
        const table = tableById.get(block.tableId);
        if (!table) return "";
        return `<div class="table-wrap"><table>
          <caption>${esc(table.title)}</caption>
          <thead><tr>${table.columns.map((col) => `<th style="text-align:${col.align ?? "left"}">${esc(col.label)}</th>`).join("")}</tr></thead>
          <tbody>${table.rows.map((row) => `<tr>${table.columns.map((col) => `<td style="text-align:${col.align ?? "left"}">${esc(String(row[col.key] ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>
        </table>${table.source ? `<div class="source">Source : ${esc(table.source)}</div>` : ""}${table.footnote ? `<div class="source">${esc(table.footnote)}</div>` : ""}</div>`;
      }
      case "insights":
        return doc.insights
          .map(
            (ins) => `<div class="card insight sev-${ins.severity ?? "medium"}">
              <div class="card-tag">${esc(INSIGHT_LABELS[ins.type] ?? ins.type)}${ins.severity ? ` · ${esc(SEVERITY_LABELS[ins.severity])}` : ""}</div>
              <div class="card-title">${esc(ins.title)}</div>
              <p>${esc(ins.description)}</p>
            </div>`,
          )
          .join("");
      case "recommendations":
        return doc.recommendations
          .map(
            (rec) => `<div class="card rec prio-${rec.priority}">
              <div class="card-tag">${esc(PRIORITY_LABELS[rec.priority])}${rec.timeframe ? ` · ${esc(rec.timeframe)}` : ""}${rec.responsibleEntity ? ` · ${esc(rec.responsibleEntity)}` : ""}</div>
              <div class="card-title">${esc(rec.title)}</div>
              <p>${esc(rec.description)}</p>
              ${rec.rationale ? `<p class="muted">Justification : ${esc(rec.rationale)}</p>` : ""}
              ${rec.expectedImpact ? `<p class="muted">Impact attendu : ${esc(rec.expectedImpact)}</p>` : ""}
            </div>`,
          )
          .join("");
      case "callout":
        return `<div class="callout ${block.variant}">${esc(block.text)}</div>`;
    }
  };

  const toc = doc.sections
    .map((s) => `<li><a href="#${esc(s.id)}">${esc(s.narrativeTitle ?? s.title)}</a></li>`)
    .join("");

  const sectionsHtml = doc.sections
    .map(
      (s) => `<section id="${esc(s.id)}">
        <h2>${esc(s.narrativeTitle ?? s.title)}</h2>
        ${s.narrativeTitle ? `<div class="section-kicker">${esc(s.title)}</div>` : ""}
        ${s.subtitle ? `<p class="muted">${esc(s.subtitle)}</p>` : ""}
        ${s.blocks.map(renderBlock).join("\n")}
      </section>`,
    )
    .join("\n");

  const summary = doc.executiveSummary;

  return `<!DOCTYPE html>
<html lang="${esc(doc.metadata.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.metadata.title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${c.surface}; color: ${c.text}; font-family: ${t.bodyFont}; font-size: 15px; line-height: 1.6; }
  .page { max-width: ${theme.layout.pageWidth}; margin: 0 auto; background: ${c.background}; padding: ${theme.layout.margins}; }
  h1, h2, h3 { font-family: ${t.headingFont}; color: ${c.secondary}; line-height: 1.25; }
  h2 { font-size: 24px; border-bottom: 2px solid ${c.primary}; padding-bottom: 6px; margin-top: 44px; }
  p { margin: 10px 0; }
  .muted { color: ${c.muted}; }
  .source { color: ${c.muted}; font-size: 12px; margin-top: 4px; }
  .cover { background: ${c.coverBackground}; color: ${c.coverText}; padding: 72px ${theme.layout.margins}; }
  .cover .org { text-transform: uppercase; letter-spacing: 2px; font-size: 13px; opacity: .85; }
  .cover h1 { color: ${c.coverText}; font-size: 38px; margin: 18px 0 6px; }
  .cover .subtitle { font-size: 18px; opacity: .9; }
  .cover .meta { margin-top: 36px; font-size: 14px; opacity: .85; }
  .cover .badge { display: inline-block; border: 1px solid ${c.coverText}55; border-radius: 4px; padding: 2px 10px; font-size: 12px; margin-top: 14px; }
  .ai-note { background: ${c.surface}; border: 1px solid ${c.border}; border-left: 4px solid ${c.accent}; padding: 10px 14px; font-size: 13px; color: ${c.muted}; margin: 24px 0; }
  .exec { background: ${c.surface}; border: 1px solid ${c.border}; padding: 24px; margin-top: 28px; }
  .exec h2 { margin-top: 0; border: none; }
  .key-messages li { margin: 6px 0; }
  .toc { columns: 2; font-size: 14px; padding-left: 18px; }
  .toc a { color: ${c.primary}; text-decoration: none; }
  .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; margin: 18px 0; }
  .kpi { border: 1px solid ${c.border}; border-top: 3px solid ${c.primary}; padding: 14px; background: ${c.background}; }
  .kpi-value { font-size: 26px; font-weight: 700; color: ${c.secondary}; }
  .kpi-unit { font-size: 13px; font-weight: 400; color: ${c.muted}; }
  .kpi-label { font-size: 13px; color: ${c.muted}; margin-top: 2px; }
  .kpi-change { font-size: 12.5px; margin-top: 6px; }
  .kpi-change.up { color: ${c.success}; } .kpi-change.down { color: ${c.danger}; } .kpi-change.neutral { color: ${c.muted}; }
  figure.chart { margin: 22px 0; }
  figure.chart svg { width: 100%; height: auto; }
  figcaption { font-size: 14px; margin-bottom: 8px; }
  .table-wrap { overflow-x: auto; margin: 20px 0; }
  table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
  caption { text-align: left; font-weight: 600; margin-bottom: 8px; color: ${c.secondary}; }
  th { background: ${c.surface}; border-bottom: 2px solid ${c.primary}; padding: 8px 10px; font-size: 12.5px; text-transform: uppercase; letter-spacing: .4px; }
  td { border-bottom: 1px solid ${c.border}; padding: 7px 10px; }
  .card { border: 1px solid ${c.border}; border-left: 4px solid ${c.primary}; padding: 14px 16px; margin: 12px 0; background: ${c.background}; }
  .card-tag { font-size: 11.5px; text-transform: uppercase; letter-spacing: .5px; color: ${c.muted}; }
  .card-title { font-weight: 600; margin: 4px 0; color: ${c.secondary}; }
  .card.sev-high, .card.sev-critical, .card.prio-high { border-left-color: ${c.danger}; }
  .card.sev-medium, .card.prio-medium { border-left-color: ${c.warning}; }
  .callout { border: 1px solid ${c.border}; padding: 12px 16px; margin: 14px 0; font-size: 14px; background: ${c.surface}; }
  .callout.warning { border-left: 4px solid ${c.warning}; }
  .callout.critical { border-left: 4px solid ${c.danger}; }
  .callout.success { border-left: 4px solid ${c.success}; }
  .callout.information { border-left: 4px solid ${c.accent}; }
  .section-kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: ${c.muted}; margin-top: -8px; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid ${c.border}; font-size: 12px; color: ${c.muted}; }
  @media print {
    body { background: ${c.background}; }
    .page { max-width: none; padding: 0; }
    section { break-inside: avoid-page; }
    .cover { break-after: page; }
  }
</style>
</head>
<body>
  <div class="cover">
    <div class="org">${esc(doc.cover.organization)}</div>
    <h1>${esc(doc.cover.title)}</h1>
    ${doc.cover.subtitle ? `<div class="subtitle">${esc(doc.cover.subtitle)}</div>` : ""}
    <div class="meta">
      ${doc.cover.periodLabel ? `Période : ${esc(doc.cover.periodLabel)}<br>` : ""}
      ${esc(doc.metadata.geographicScope ?? "")}<br>
      ${doc.cover.author ? `Préparé par ${esc(doc.cover.author)} — ` : ""}${esc(doc.cover.date)}
    </div>
    ${doc.cover.classification ? `<div class="badge">${esc(doc.cover.classification)}</div>` : ""}
  </div>
  <div class="page">
    <div class="ai-note">${esc(doc.branding.aiDisclosure)}</div>
    ${summary ? `<div class="exec">
      <h2>Résumé exécutif</h2>
      <p>${esc(summary.summary)}</p>
      ${summary.keyMessages.length ? `<h3>Messages clés</h3><ul class="key-messages">${summary.keyMessages.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    </div>` : ""}
    <h2>Table des matières</h2>
    <ol class="toc">${toc}</ol>
    ${sectionsHtml}
    <footer>
      ${esc(doc.branding.productName)} · ${esc(doc.metadata.title)} · ${esc(doc.metadata.version)} · Généré le ${esc(new Date(doc.generatedAt).toLocaleString("fr-FR"))} par ${esc(doc.generatedBy)}
    </footer>
  </div>
</body>
</html>`;
}
