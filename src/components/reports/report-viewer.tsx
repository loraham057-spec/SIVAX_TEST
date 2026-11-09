"use client";

/**
 * ReportViewer — document-like preview of a canonical ReportDocument.
 * Uses the shared design tokens (templates.ts) and the shared SVG chart
 * engine (chart-model.ts), so the preview matches the HTML/PDF exports.
 */

import { useMemo } from "react";
import { buildChartModel, renderChartSvg } from "@/lib/report-engine/chart-model";
import { getReportTheme } from "@/lib/report-engine/templates";
import type {
  KPI,
  ReportBlock,
  ReportDocument,
  ReportTemplateId,
} from "@/lib/report-engine/types";

const SEVERITY_LABELS: Record<string, string> = { low: "Faible", medium: "Moyen", high: "Élevé", critical: "Critique" };
const PRIORITY_LABELS: Record<string, string> = { low: "Priorité faible", medium: "Priorité moyenne", high: "Priorité élevée" };
const INSIGHT_LABELS: Record<string, string> = { finding: "Constat", trend: "Tendance", anomaly: "Anomalie", risk: "Risque" };

interface ReportViewerProps {
  document: ReportDocument;
  template: ReportTemplateId;
}

export function ReportViewer({ document: doc, template }: ReportViewerProps) {
  const theme = useMemo(() => getReportTheme(template), [template]);
  const c = theme.colors;
  const kpiById = useMemo(() => new Map(doc.kpis.map((k) => [k.id, k])), [doc]);
  const chartById = useMemo(() => new Map(doc.charts.map((ch) => [ch.id, ch])), [doc]);
  const tableById = useMemo(() => new Map(doc.tables.map((tb) => [tb.id, tb])), [doc]);

  const renderKpi = (kpi: KPI) => (
    <div key={kpi.id} className="p-4" style={{ border: `1px solid ${c.border}`, borderTop: `3px solid ${c.primary}`, background: c.background }}>
      <div className="text-2xl font-bold" style={{ color: c.secondary }}>{kpi.value}</div>
      <div className="mt-0.5 text-xs" style={{ color: c.muted }}>{kpi.label}</div>
      {(kpi.change || kpi.comparisonLabel) && (
        <div className="mt-1.5 text-xs" style={{ color: kpi.trend === "up" ? c.success : kpi.trend === "down" ? c.danger : c.muted }}>
          {kpi.trend === "up" ? "▲ " : kpi.trend === "down" ? "▼ " : ""}
          {kpi.change} <span style={{ color: c.muted }}>{kpi.comparisonLabel}</span>
        </div>
      )}
    </div>
  );

  const renderBlock = (block: ReportBlock, index: number) => {
    switch (block.type) {
      case "paragraph":
        return <p key={index} className="my-2.5 text-sm leading-relaxed" style={{ color: c.text }}>{block.text}</p>;
      case "kpis":
        return (
          <div key={index} className="my-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {block.kpiIds.map((id) => kpiById.get(id)).filter((k): k is KPI => Boolean(k)).map(renderKpi)}
          </div>
        );
      case "chart": {
        const chart = chartById.get(block.chartId);
        if (!chart) return null;
        const svg = renderChartSvg(buildChartModel(chart, theme), theme, { width: 680, height: chart.type === "donut" ? 240 : 300 });
        return (
          <figure key={index} className="my-5">
            <figcaption className="mb-2 text-sm">
              <strong style={{ color: c.secondary }}>{chart.title}</strong>
              {chart.subtitle && <span style={{ color: c.muted }}> — {chart.subtitle}</span>}
            </figcaption>
            <div className="[&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
            {chart.source && <div className="mt-1 text-xs" style={{ color: c.muted }}>Source : {chart.source}</div>}
          </figure>
        );
      }
      case "table": {
        const table = tableById.get(block.tableId);
        if (!table) return null;
        return (
          <div key={index} className="my-5 overflow-x-auto">
            <div className="mb-2 text-sm font-semibold" style={{ color: c.secondary }}>{table.title}</div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {table.columns.map((col) => (
                    <th key={col.key} className="px-2.5 py-2 text-[11px] uppercase tracking-wide" style={{ background: c.surface, borderBottom: `2px solid ${c.primary}`, textAlign: col.align ?? "left", color: c.secondary }}>
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, ri) => (
                  <tr key={ri}>
                    {table.columns.map((col) => (
                      <td key={col.key} className="px-2.5 py-1.5" style={{ borderBottom: `1px solid ${c.border}`, textAlign: col.align ?? "left", color: c.text }}>
                        {String(row[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {table.source && <div className="mt-1 text-xs" style={{ color: c.muted }}>Source : {table.source}</div>}
          </div>
        );
      }
      case "insights":
        return (
          <div key={index} className="space-y-3">
            {doc.insights.map((ins) => (
              <div key={ins.id} className="px-4 py-3" style={{ border: `1px solid ${c.border}`, borderLeft: `4px solid ${ins.severity === "high" || ins.severity === "critical" ? c.danger : c.warning}`, background: c.background }}>
                <div className="text-[11px] uppercase tracking-wide" style={{ color: c.muted }}>
                  {INSIGHT_LABELS[ins.type] ?? ins.type}{ins.severity ? ` · ${SEVERITY_LABELS[ins.severity]}` : ""}
                </div>
                <div className="mt-0.5 text-sm font-semibold" style={{ color: c.secondary }}>{ins.title}</div>
                <p className="mt-1 text-sm" style={{ color: c.text }}>{ins.description}</p>
              </div>
            ))}
          </div>
        );
      case "recommendations":
        return (
          <div key={index} className="space-y-3">
            {doc.recommendations.map((rec) => (
              <div key={rec.id} className="px-4 py-3" style={{ border: `1px solid ${c.border}`, borderLeft: `4px solid ${rec.priority === "high" ? c.danger : rec.priority === "medium" ? c.warning : c.primary}`, background: c.background }}>
                <div className="text-[11px] uppercase tracking-wide" style={{ color: c.muted }}>
                  {PRIORITY_LABELS[rec.priority]}{rec.timeframe ? ` · ${rec.timeframe}` : ""}{rec.responsibleEntity ? ` · ${rec.responsibleEntity}` : ""}
                </div>
                <div className="mt-0.5 text-sm font-semibold" style={{ color: c.secondary }}>{rec.title}</div>
                <p className="mt-1 text-sm" style={{ color: c.text }}>{rec.description}</p>
                {rec.expectedImpact && <p className="mt-1 text-xs" style={{ color: c.muted }}>Impact attendu : {rec.expectedImpact}</p>}
              </div>
            ))}
          </div>
        );
      case "callout":
        return (
          <div key={index} className="my-3.5 px-4 py-3 text-sm" style={{ border: `1px solid ${c.border}`, borderLeft: `4px solid ${block.variant === "critical" ? c.danger : block.variant === "warning" ? c.warning : block.variant === "success" ? c.success : c.accent}`, background: c.surface, color: c.text }}>
            {block.text}
          </div>
        );
    }
  };

  return (
    <div className="mx-auto max-w-4xl shadow-lg print:shadow-none" style={{ background: c.background, fontFamily: theme.typography.bodyFont }}>
      {/* Cover */}
      <div className="px-10 py-16 lg:px-14" style={{ background: c.coverBackground, color: c.coverText }}>
        <div className="text-xs uppercase tracking-[2px] opacity-80">{doc.cover.organization}</div>
        <h1 className="mt-4 text-3xl font-bold lg:text-4xl" style={{ fontFamily: theme.typography.headingFont }}>{doc.cover.title}</h1>
        {doc.cover.subtitle && <div className="mt-2 text-lg opacity-90">{doc.cover.subtitle}</div>}
        <div className="mt-8 text-sm opacity-85">
          {doc.cover.periodLabel && <div>Période : {doc.cover.periodLabel}</div>}
          {doc.metadata.geographicScope && <div>{doc.metadata.geographicScope}</div>}
          <div>{doc.cover.author ? `Préparé par ${doc.cover.author} — ` : ""}{doc.cover.date}</div>
        </div>
        {doc.cover.classification && (
          <div className="mt-4 inline-block rounded border px-2.5 py-0.5 text-xs" style={{ borderColor: `${c.coverText}55` }}>{doc.cover.classification}</div>
        )}
      </div>

      <div className="px-8 py-10 lg:px-14">
        {/* AI disclosure */}
        <div className="mb-6 px-3.5 py-2.5 text-xs" style={{ background: c.surface, border: `1px solid ${c.border}`, borderLeft: `4px solid ${c.accent}`, color: c.muted }}>
          {doc.branding.aiDisclosure}
        </div>

        {/* Executive summary */}
        {doc.executiveSummary && (
          <div className="mb-8 p-6" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
            <h2 className="text-xl font-bold" style={{ color: c.secondary, fontFamily: theme.typography.headingFont }}>Résumé exécutif</h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: c.text }}>{doc.executiveSummary.summary}</p>
            {doc.executiveSummary.keyMessages.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-semibold" style={{ color: c.secondary }}>Messages clés</h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm" style={{ color: c.text }}>
                  {doc.executiveSummary.keyMessages.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </>
            )}
          </div>
        )}

        {/* Table of contents */}
        <h2 className="mb-2 text-lg font-bold" style={{ color: c.secondary, fontFamily: theme.typography.headingFont }}>Table des matières</h2>
        <ol className="mb-8 space-y-1 pl-5 text-sm lg:columns-2">
          {doc.sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="hover:underline" style={{ color: c.primary }}>{s.narrativeTitle ?? s.title}</a>
            </li>
          ))}
        </ol>

        {/* Sections */}
        {doc.sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="mt-10 pb-1.5 text-xl font-bold lg:text-2xl" style={{ color: c.secondary, borderBottom: `2px solid ${c.primary}`, fontFamily: theme.typography.headingFont }}>
              {section.narrativeTitle ?? section.title}
            </h2>
            {section.narrativeTitle && (
              <div className="mt-1 text-[11px] uppercase tracking-wider" style={{ color: c.muted }}>{section.title}</div>
            )}
            <div className="mt-3">{section.blocks.map(renderBlock)}</div>
          </section>
        ))}

        <footer className="mt-12 border-t pt-4 text-xs" style={{ borderColor: c.border, color: c.muted }}>
          {doc.branding.productName} · {doc.metadata.title} · {doc.metadata.version} · Généré le {new Date(doc.generatedAt).toLocaleString("fr-FR")} par {doc.generatedBy}
        </footer>
      </div>
    </div>
  );
}
