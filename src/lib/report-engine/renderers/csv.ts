/**
 * CSV Renderer — exports the exploitable data of a report (KPIs, chart
 * data, tables, metadata) as a single CSV workbook-like file, built from
 * the same canonical ReportDocument.
 */

import type { ReportDocument } from "../types";

function cell(value: string | number | null | undefined): string {
  const s = String(value ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function rows(lines: (string | number | null | undefined)[][]): string {
  return lines.map((line) => line.map(cell).join(";")).join("\n");
}

export function renderReportCsv(doc: ReportDocument): string {
  const parts: string[] = [];

  parts.push(rows([
    ["SIVAX REPORT ENGINE — EXPORT DONNÉES"],
    ["Titre", doc.metadata.title],
    ["Type", doc.metadata.reportType],
    ["Période", `${doc.metadata.period?.start ?? ""} → ${doc.metadata.period?.end ?? ""}`],
    ["Périmètre", doc.metadata.geographicScope ?? ""],
    ["Généré le", doc.generatedAt],
    ["Généré par", doc.generatedBy],
    ["Version", doc.metadata.version],
  ]));

  parts.push("\n\n" + rows([["KPIS"], ["Indicateur", "Valeur", "Variation", "Comparaison"]]) + "\n" +
    rows(doc.kpis.map((k) => [k.label, k.value, k.change ?? "", k.comparisonLabel ?? ""])));

  for (const chart of doc.charts) {
    parts.push(
      "\n\n" + rows([[`GRAPHIQUE — ${chart.title}`], ["Catégorie", ...chart.series.map((s) => s.name)]]) + "\n" +
      rows(chart.categories.map((cat, i) => [cat, ...chart.series.map((s) => s.data[i] ?? "")])),
    );
  }

  for (const table of doc.tables) {
    parts.push(
      "\n\n" + rows([[`TABLEAU — ${table.title}`], table.columns.map((c) => c.label)]) + "\n" +
      rows(table.rows.map((row) => table.columns.map((c) => row[c.key] ?? ""))),
    );
  }

  parts.push("\n\n" + rows([["SOURCES"], ...doc.sources.map((s) => [s.name])]));

  // UTF-8 BOM for Excel compatibility
  return "\uFEFF" + parts.join("\n");
}
