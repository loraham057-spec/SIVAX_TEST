/**
 * DOCX Renderer — builds a Word document from the same ReportDocument
 * (never converted from PDF/HTML). Charts are included as data tables
 * for full Word editability.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { getReportTheme, type ReportTheme } from "../templates";
import type { KPI, ReportBlock, ReportChart, ReportDocument, ReportTable, ReportTemplateId } from "../types";

const color = (hexColor: string) => hexColor.replace("#", "");

function para(text: string, opts: { bold?: boolean; size?: number; colorHex?: string; italics?: boolean } = {}): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({
        text,
        bold: opts.bold,
        italics: opts.italics,
        size: (opts.size ?? 11) * 2,
        color: opts.colorHex ? color(opts.colorHex) : undefined,
      }),
    ],
  });
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ text, heading: level, spacing: { before: 280, after: 140 } });
}

function dataTable(theme: ReportTheme, columns: string[], rows: (string | number)[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: color(theme.colors.border) };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: columns.map(
          (label) =>
            new TableCell({
              shading: { fill: color(theme.colors.surface) },
              borders: { top: border, bottom: border, left: border, right: border },
              children: [para(label, { bold: true, size: 9, colorHex: theme.colors.secondary })],
            }),
        ),
      }),
      ...rows.map(
        (row) =>
          new TableRow({
            children: row.map(
              (value) =>
                new TableCell({
                  borders: { top: border, bottom: border, left: border, right: border },
                  children: [para(String(value), { size: 9 })],
                }),
            ),
          }),
      ),
    ],
  });
}

function kpiTable(theme: ReportTheme, kpis: KPI[]): Table {
  return dataTable(
    theme,
    ["Indicateur", "Valeur", "Variation", "Comparaison"],
    kpis.map((k) => [k.label, k.value, k.change ?? "—", k.comparisonLabel ?? "—"]),
  );
}

function chartAsTable(theme: ReportTheme, chart: ReportChart): (Paragraph | Table)[] {
  const columns = ["Catégorie", ...chart.series.map((s) => s.name)];
  const rows = chart.categories.map((cat, i) => [
    cat,
    ...chart.series.map((s) => {
      const v = s.data[i];
      return v === null || v === undefined ? "—" : v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    }),
  ]);
  return [
    para(chart.title, { bold: true, size: 11, colorHex: theme.colors.secondary }),
    ...(chart.subtitle ? [para(chart.subtitle, { size: 9, colorHex: theme.colors.muted })] : []),
    dataTable(theme, columns, rows),
    ...(chart.source ? [para(`Source : ${chart.source}`, { size: 8, colorHex: theme.colors.muted, italics: true })] : []),
  ];
}

function reportTable(theme: ReportTheme, table: ReportTable): (Paragraph | Table)[] {
  return [
    para(table.title, { bold: true, size: 11, colorHex: theme.colors.secondary }),
    dataTable(
      theme,
      table.columns.map((c) => c.label),
      table.rows.map((row) => table.columns.map((c) => row[c.key] ?? "")),
    ),
    ...(table.source ? [para(`Source : ${table.source}`, { size: 8, colorHex: theme.colors.muted, italics: true })] : []),
  ];
}

export async function renderReportDocx(report: ReportDocument, templateOverride?: ReportTemplateId): Promise<Buffer> {
  const theme = getReportTheme(templateOverride ?? report.template);
  const children: (Paragraph | Table)[] = [];

  // ─── Cover ─────────────────────────────────────────────────
  children.push(
    new Paragraph({ spacing: { before: 2400, after: 240 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: report.cover.organization.toUpperCase(), size: 22, color: color(theme.colors.primary) })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: report.cover.title, bold: true, size: 56, color: color(theme.colors.secondary) })] }),
    ...(report.cover.subtitle ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 480 }, children: [new TextRun({ text: report.cover.subtitle, size: 28, color: color(theme.colors.muted) })] })] : []),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: [report.cover.periodLabel ? `Période : ${report.cover.periodLabel}` : null, report.metadata.geographicScope, report.cover.date].filter(Boolean).join(" — "),
          size: 20,
        }),
      ],
    }),
    ...(report.cover.classification ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: report.cover.classification, size: 18, color: color(theme.colors.muted) })] })] : []),
    new Paragraph({ pageBreakBefore: true, children: [] }),
  );

  // ─── AI disclosure + executive summary ─────────────────────
  children.push(para(report.branding.aiDisclosure, { size: 9, colorHex: theme.colors.muted, italics: true }));
  if (report.executiveSummary) {
    children.push(heading("Résumé exécutif", HeadingLevel.HEADING_1));
    children.push(para(report.executiveSummary.summary));
    if (report.executiveSummary.keyMessages.length) {
      children.push(heading("Messages clés", HeadingLevel.HEADING_2));
      report.executiveSummary.keyMessages.forEach((m) => children.push(new Paragraph({ text: m, bullet: { level: 0 }, spacing: { after: 80 } })));
    }
  }

  // ─── Sections ──────────────────────────────────────────────
  const kpiById = new Map(report.kpis.map((k) => [k.id, k]));
  const chartById = new Map(report.charts.map((c) => [c.id, c]));
  const tableById = new Map(report.tables.map((t) => [t.id, t]));

  const renderBlock = (block: ReportBlock) => {
    switch (block.type) {
      case "paragraph":
        children.push(para(block.text));
        break;
      case "kpis":
        children.push(kpiTable(theme, block.kpiIds.map((id) => kpiById.get(id)).filter(Boolean) as KPI[]));
        break;
      case "chart": {
        const chart = chartById.get(block.chartId);
        if (chart) children.push(...chartAsTable(theme, chart));
        break;
      }
      case "table": {
        const table = tableById.get(block.tableId);
        if (table) children.push(...reportTable(theme, table));
        break;
      }
      case "insights":
        report.insights.forEach((ins) => {
          children.push(para(ins.title, { bold: true, size: 10, colorHex: theme.colors.secondary }));
          children.push(para(ins.description, { size: 10 }));
        });
        break;
      case "recommendations":
        report.recommendations.forEach((rec, i) => {
          children.push(para(`${i + 1}. ${rec.title}`, { bold: true, size: 10, colorHex: theme.colors.secondary }));
          children.push(para(rec.description, { size: 10 }));
          const meta = [rec.priority === "high" ? "Priorité élevée" : rec.priority === "medium" ? "Priorité moyenne" : "Priorité faible", rec.timeframe, rec.responsibleEntity].filter(Boolean).join(" · ");
          children.push(para(meta, { size: 8, colorHex: theme.colors.muted, italics: true }));
        });
        break;
      case "callout":
        children.push(para(block.text, { size: 9.5, italics: true, colorHex: theme.colors.muted }));
        break;
    }
  };

  for (const section of report.sections) {
    children.push(heading(section.narrativeTitle ?? section.title, HeadingLevel.HEADING_1));
    if (section.narrativeTitle) children.push(para(section.title.toUpperCase(), { size: 8, colorHex: theme.colors.muted }));
    section.blocks.forEach(renderBlock);
  }

  children.push(para(`${report.branding.productName} · ${report.metadata.version} · Généré le ${new Date(report.generatedAt).toLocaleString("fr-FR")} par ${report.generatedBy}`, { size: 8, colorHex: theme.colors.muted, italics: true }));

  const doc = new Document({
    styles: {
      default: {
        heading1: { run: { size: 30, bold: true, color: color(theme.colors.secondary), font: "Calibri" } },
        heading2: { run: { size: 24, bold: true, color: color(theme.colors.primary), font: "Calibri" } },
        document: { run: { size: 22, font: "Calibri", color: color(theme.colors.text) } },
      },
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
