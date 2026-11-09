/**
 * PDF Renderer — institutional PDF built with jsPDF (pure JS, no
 * headless browser). Charts are redrawn as vector primitives from the
 * shared ChartModel — never screenshots.
 */

import { jsPDF } from "jspdf";
import { buildChartModel, type ChartModel } from "../chart-model";
import { getReportTheme, type ReportTheme } from "../templates";
import type { KPI, ReportBlock, ReportDocument, ReportTable, ReportTemplateId } from "../types";

const PAGE = { width: 595.28, height: 841.89, margin: 52 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

function hex(color: string): [number, number, number] {
  const v = color.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

class PdfBuilder {
  doc = new jsPDF({ unit: "pt", format: "a4" });
  y = PAGE.margin;
  pageNum = 1;

  constructor(private theme: ReportTheme, private title: string) {}

  ensure(height: number): void {
    if (this.y + height > PAGE.height - PAGE.margin - 20) this.newPage();
  }

  newPage(): void {
    this.footer();
    this.doc.addPage();
    this.pageNum += 1;
    this.y = PAGE.margin;
  }

  footer(): void {
    const { doc } = this;
    doc.setFontSize(8).setTextColor(...hex(this.theme.colors.muted)).setFont("helvetica", "normal");
    doc.text(this.title, PAGE.margin, PAGE.height - 24);
    doc.text(String(this.pageNum), PAGE.width - PAGE.margin, PAGE.height - 24, { align: "right" });
  }

  heading(text: string, level: 1 | 2 | 3, kicker?: string): void {
    const sizes = { 1: 16, 2: 13, 3: 11 } as const;
    this.ensure(50);
    this.y += level === 1 ? 22 : 14;
    if (kicker) {
      this.doc.setFontSize(7.5).setTextColor(...hex(this.theme.colors.muted)).setFont("helvetica", "normal");
      this.doc.text(kicker.toUpperCase(), PAGE.margin, this.y);
      this.y += 20;
    }
    this.doc.setFontSize(sizes[level]).setTextColor(...hex(this.theme.colors.secondary)).setFont("helvetica", "bold");
    const lines = this.doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
    this.doc.text(lines, PAGE.margin, this.y);
    this.y += lines.length * (sizes[level] + 3);
    if (level === 1) {
      this.doc.setDrawColor(...hex(this.theme.colors.primary)).setLineWidth(1.4);
      this.doc.line(PAGE.margin, this.y, PAGE.margin + CONTENT_WIDTH, this.y);
      this.y += 12;
    }
  }

  paragraph(text: string, opts: { color?: string; size?: number; indent?: number; bold?: boolean } = {}): void {
    const size = opts.size ?? 9.5;
    const indent = opts.indent ?? 0;
    this.doc.setFontSize(size).setTextColor(...hex(opts.color ?? this.theme.colors.text)).setFont("helvetica", opts.bold ? "bold" : "normal");
    const lines = this.doc.splitTextToSize(text, CONTENT_WIDTH - indent) as string[];
    for (const line of lines) {
      this.ensure(size + 4);
      this.doc.setFontSize(size).setTextColor(...hex(opts.color ?? this.theme.colors.text));
      this.doc.text(line, PAGE.margin + indent, this.y);
      this.y += size + 4;
    }
    this.y += 4;
  }

  kpiGrid(kpis: KPI[]): void {
    const perRow = Math.min(4, Math.max(kpis.length, 1));
    const gap = 10;
    const boxW = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
    const boxH = 62;
    for (let i = 0; i < kpis.length; i += perRow) {
      this.ensure(boxH + 10);
      const row = kpis.slice(i, i + perRow);
      row.forEach((kpi, j) => {
        const x = PAGE.margin + j * (boxW + gap);
        this.doc.setFillColor(...hex(this.theme.colors.surface)).setDrawColor(...hex(this.theme.colors.border));
        this.doc.rect(x, this.y, boxW, boxH, "FD");
        this.doc.setFillColor(...hex(this.theme.colors.primary));
        this.doc.rect(x, this.y, boxW, 2.5, "F");
        this.doc.setFontSize(14).setTextColor(...hex(this.theme.colors.secondary)).setFont("helvetica", "bold");
        this.doc.text(kpi.value, x + 8, this.y + 22);
        this.doc.setFontSize(7.5).setTextColor(...hex(this.theme.colors.muted)).setFont("helvetica", "normal");
        this.doc.text(this.doc.splitTextToSize(kpi.label, boxW - 16) as string[], x + 8, this.y + 34);
        const change = [kpi.change, kpi.comparisonLabel].filter(Boolean).join(" ");
        if (change) {
          const color = kpi.trend === "up" ? this.theme.colors.success : kpi.trend === "down" ? this.theme.colors.danger : this.theme.colors.muted;
          this.doc.setTextColor(...hex(color));
          this.doc.text(this.doc.splitTextToSize(change, boxW - 16) as string[], x + 8, this.y + 52);
        }
      });
      this.y += boxH + 10;
    }
  }

  table(table: ReportTable): void {
    const colW = CONTENT_WIDTH / table.columns.length;
    const rowH = 17;
    this.ensure(60);
    this.paragraph(table.title, { bold: true, size: 10, color: this.theme.colors.secondary });

    const header = () => {
      this.doc.setFillColor(...hex(this.theme.colors.surface));
      this.doc.rect(PAGE.margin, this.y - 11, CONTENT_WIDTH, rowH, "F");
      this.doc.setDrawColor(...hex(this.theme.colors.primary)).setLineWidth(1);
      this.doc.line(PAGE.margin, this.y + 5, PAGE.margin + CONTENT_WIDTH, this.y + 5);
      this.doc.setFontSize(8).setTextColor(...hex(this.theme.colors.secondary)).setFont("helvetica", "bold");
      table.columns.forEach((col, i) => {
        const x = col.align === "right" ? PAGE.margin + (i + 1) * colW - 4 : PAGE.margin + i * colW + 4;
        this.doc.text(col.label, x, this.y, { align: col.align === "right" ? "right" : "left" });
      });
      this.y += rowH;
    };

    header();
    this.doc.setFont("helvetica", "normal");
    for (const row of table.rows) {
      if (this.y + rowH > PAGE.height - PAGE.margin - 20) {
        this.newPage();
        header();
        this.doc.setFont("helvetica", "normal");
      }
      this.doc.setFontSize(8.5).setTextColor(...hex(this.theme.colors.text));
      table.columns.forEach((col, i) => {
        const value = String(row[col.key] ?? "");
        const x = col.align === "right" ? PAGE.margin + (i + 1) * colW - 4 : PAGE.margin + i * colW + 4;
        this.doc.text(this.doc.splitTextToSize(value, colW - 8)[0] ?? "", x, this.y, { align: col.align === "right" ? "right" : "left" });
      });
      this.doc.setDrawColor(...hex(this.theme.colors.border)).setLineWidth(0.4);
      this.doc.line(PAGE.margin, this.y + 4.5, PAGE.margin + CONTENT_WIDTH, this.y + 4.5);
      this.y += rowH;
    }
    if (table.source) this.paragraph(`Source : ${table.source}`, { color: this.theme.colors.muted, size: 7.5 });
    this.y += 6;
  }

  chart(model: ChartModel, title: string, subtitle?: string, source?: string): void {
    const chartH = model.type === "donut" ? 150 : 180;
    this.ensure(chartH + 60);
    this.paragraph(title, { bold: true, size: 10, color: this.theme.colors.secondary });
    if (subtitle) this.paragraph(subtitle, { color: this.theme.colors.muted, size: 8 });

    const x0 = PAGE.margin + 40;
    const w = CONTENT_WIDTH - 50;
    const y0 = this.y;
    const h = chartH - 30;

    if (model.type === "donut") {
      const cx = PAGE.margin + 70;
      const cy = y0 + h / 2;
      const r = h / 2;
      let angle = -Math.PI / 2;
      for (const seg of model.segments) {
        if (seg.frac <= 0) continue;
        const a1 = angle + seg.frac * Math.PI * 2;
        this.doc.setFillColor(...hex(seg.color));
        // approximate the arc with small triangles
        const steps = Math.max(2, Math.ceil(seg.frac * 60));
        for (let s = 0; s < steps; s++) {
          const b0 = angle + ((a1 - angle) * s) / steps;
          const b1 = angle + ((a1 - angle) * (s + 1)) / steps;
          this.doc.triangle(cx, cy, cx + Math.cos(b0) * r, cy + Math.sin(b0) * r, cx + Math.cos(b1) * r, cy + Math.sin(b1) * r, "F");
        }
        angle = a1;
      }
      this.doc.setFillColor(255, 255, 255);
      this.doc.circle(cx, cy, r * 0.6, "F");
      // legend
      let ly = y0 + 8;
      this.doc.setFontSize(8).setFont("helvetica", "normal");
      for (const seg of model.segments.slice(0, 8)) {
        this.doc.setFillColor(...hex(seg.color));
        this.doc.rect(cx + r + 24, ly - 6, 7, 7, "F");
        this.doc.setTextColor(...hex(this.theme.colors.text));
        this.doc.text(`${seg.label} — ${(seg.frac * 100).toFixed(1)}%`, cx + r + 36, ly);
        ly += 14;
      }
    } else {
      // grid + y labels
      this.doc.setFontSize(7).setFont("helvetica", "normal");
      for (const tick of model.yTicks) {
        const ty = y0 + h - tick.t * h;
        this.doc.setDrawColor(...hex(this.theme.colors.border)).setLineWidth(0.4);
        this.doc.line(x0, ty, x0 + w, ty);
        this.doc.setTextColor(...hex(this.theme.colors.muted));
        this.doc.text(tick.label, x0 - 5, ty + 2, { align: "right" });
      }
      // x labels
      const nCat = model.categories.length;
      const step = Math.max(1, Math.ceil(nCat / 8));
      model.categories.forEach((label, i) => {
        if (i % step !== 0 && i !== nCat - 1) return;
        const lx = model.type === "bar" ? x0 + ((i + 0.5) / Math.max(nCat, 1)) * w : x0 + (nCat === 1 ? 0.5 : i / (nCat - 1)) * w;
        this.doc.setTextColor(...hex(this.theme.colors.muted));
        this.doc.text(this.doc.splitTextToSize(label, 60)[0] ?? "", lx, y0 + h + 12, { align: "center" });
      });

      if (model.type === "bar") {
        const groupW = w / Math.max(nCat, 1);
        const seriesCount = Math.max(model.series.length, 1);
        const barW = Math.min(26, (groupW * 0.7) / seriesCount);
        model.series.forEach((s, si) => {
          this.doc.setFillColor(...hex(s.color));
          s.points.forEach((p, i) => {
            if (p.value === null) return;
            const cx = x0 + (i + 0.5) * groupW;
            const bx = cx - (seriesCount * barW) / 2 + si * barW;
            this.doc.rect(bx, y0 + h - p.y * h, barW, p.y * h, "F");
          });
        });
      } else {
        model.series.forEach((s) => {
          this.doc.setDrawColor(...hex(s.color)).setLineWidth(1.4);
          const pts = s.points.filter((p) => p.value !== null).map((p) => [x0 + p.x * w, y0 + h - p.y * h] as const);
          for (let i = 1; i < pts.length; i++) {
            this.doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
          }
          this.doc.setFillColor(...hex(s.color));
          pts.forEach(([px, py]) => this.doc.circle(px, py, 1.6, "F"));
        });
      }
    }

    this.y = y0 + chartH - 10;
    if (source) this.paragraph(`Source : ${source}`, { color: this.theme.colors.muted, size: 7.5 });
    this.y += 4;
  }

  callout(text: string, color: string): void {
    this.doc.setFontSize(8.5);
    const lines = this.doc.splitTextToSize(text, CONTENT_WIDTH - 24) as string[];
    const boxH = lines.length * 12 + 16;
    this.ensure(boxH + 8);
    this.doc.setFillColor(...hex(this.theme.colors.surface)).setDrawColor(...hex(this.theme.colors.border));
    this.doc.rect(PAGE.margin, this.y, CONTENT_WIDTH, boxH, "FD");
    this.doc.setFillColor(...hex(color));
    this.doc.rect(PAGE.margin, this.y, 3, boxH, "F");
    this.doc.setTextColor(...hex(this.theme.colors.text)).setFont("helvetica", "normal");
    this.doc.text(lines, PAGE.margin + 12, this.y + 14);
    this.y += boxH + 10;
  }
}

export function renderReportPdf(report: ReportDocument, templateOverride?: ReportTemplateId): ArrayBuffer {
  const theme = getReportTheme(templateOverride ?? report.template);
  const b = new PdfBuilder(theme, report.metadata.title);
  const { doc } = b;
  const kpiById = new Map(report.kpis.map((k) => [k.id, k]));
  const chartById = new Map(report.charts.map((c) => [c.id, c]));
  const tableById = new Map(report.tables.map((t) => [t.id, t]));

  // ─── Cover ─────────────────────────────────────────────────
  doc.setFillColor(...hex(theme.colors.coverBackground));
  doc.rect(0, 0, PAGE.width, PAGE.height, "F");
  doc.setTextColor(...hex(theme.colors.coverText));
  doc.setFontSize(11).setFont("helvetica", "normal");
  doc.text(report.cover.organization.toUpperCase(), PAGE.margin, 140);
  doc.setFontSize(28).setFont("helvetica", "bold");
  doc.text(doc.splitTextToSize(report.cover.title, CONTENT_WIDTH) as string[], PAGE.margin, 220);
  doc.setFontSize(14).setFont("helvetica", "normal");
  if (report.cover.subtitle) doc.text(report.cover.subtitle, PAGE.margin, 300);
  doc.setFontSize(10.5);
  const coverMeta = [
    report.cover.periodLabel ? `Période : ${report.cover.periodLabel}` : null,
    report.metadata.geographicScope ?? null,
    report.cover.author ? `Préparé par ${report.cover.author}` : null,
    report.cover.date,
    report.cover.classification ?? null,
  ].filter(Boolean) as string[];
  doc.text(coverMeta, PAGE.margin, 380);
  doc.setFillColor(...hex(theme.colors.accent));
  doc.rect(PAGE.margin, 330, 60, 3, "F");

  doc.addPage();
  b.pageNum += 1;
  b.y = PAGE.margin;

  // ─── AI disclosure ─────────────────────────────────────────
  b.callout(report.branding.aiDisclosure, theme.colors.accent);

  // ─── Executive summary ─────────────────────────────────────
  if (report.executiveSummary) {
    b.heading("Résumé exécutif", 1);
    b.paragraph(report.executiveSummary.summary);
    if (report.executiveSummary.keyMessages.length) {
      b.heading("Messages clés", 3);
      report.executiveSummary.keyMessages.forEach((m) => b.paragraph(`•  ${m}`, { indent: 6 }));
    }
  }

  // ─── Sections ──────────────────────────────────────────────
  const renderBlock = (block: ReportBlock) => {
    switch (block.type) {
      case "paragraph":
        b.paragraph(block.text);
        break;
      case "kpis":
        b.kpiGrid(block.kpiIds.map((id) => kpiById.get(id)).filter(Boolean) as KPI[]);
        break;
      case "chart": {
        const chart = chartById.get(block.chartId);
        if (chart) b.chart(buildChartModel(chart, theme), chart.title, chart.subtitle, chart.source);
        break;
      }
      case "table": {
        const table = tableById.get(block.tableId);
        if (table) b.table(table);
        break;
      }
      case "insights":
        report.insights.forEach((ins) => {
          const color = ins.severity === "high" || ins.severity === "critical" ? theme.colors.danger : theme.colors.warning;
          b.callout(`${ins.title}\n${ins.description}`, color);
        });
        break;
      case "recommendations":
        report.recommendations.forEach((rec, i) => {
          b.ensure(60);
          b.paragraph(`${i + 1}. ${rec.title}`, { bold: true, size: 10, color: theme.colors.secondary });
          b.paragraph(rec.description, { indent: 12 });
          const meta = [
            rec.priority === "high" ? "Priorité élevée" : rec.priority === "medium" ? "Priorité moyenne" : "Priorité faible",
            rec.timeframe,
            rec.responsibleEntity,
          ].filter(Boolean).join(" · ");
          b.paragraph(meta, { indent: 12, color: theme.colors.muted, size: 8 });
        });
        break;
      case "callout": {
        const color = block.variant === "critical" ? theme.colors.danger : block.variant === "warning" ? theme.colors.warning : block.variant === "success" ? theme.colors.success : theme.colors.accent;
        b.callout(block.text, color);
        break;
      }
    }
  };

  for (const section of report.sections) {
    b.heading(section.narrativeTitle ?? section.title, 1, section.narrativeTitle ? section.title : undefined);
    section.blocks.forEach(renderBlock);
  }

  b.footer();
  return doc.output("arraybuffer");
}
