/**
 * GET /api/reports/[id]/export?format=pdf|html|docx|csv&template=...
 *
 * ReportExportService — renders the same canonical ReportDocument into
 * the requested format (multi-format principle: never converts one
 * rendered format into another).
 */

import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/report-engine/storage";
import { renderReportHtml } from "@/lib/report-engine/renderers/html";
import { renderReportPdf } from "@/lib/report-engine/renderers/pdf";
import { renderReportDocx } from "@/lib/report-engine/renderers/docx";
import { renderReportCsv } from "@/lib/report-engine/renderers/csv";
import type { ReportTemplateId } from "@/lib/report-engine/types";
import { getReportUser } from "../../_lib/auth";

export const dynamic = "force-dynamic";

const TEMPLATES = ["sivax", "institutional", "development", "consulting", "government"];

function fileName(title: string, ext: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `${slug || "rapport"}.${ext}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getReportUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const document = await getReport(id, user.id);
  if (!document) return NextResponse.json({ error: "Rapport introuvable" }, { status: 404 });

  const format = request.nextUrl.searchParams.get("format") ?? "pdf";
  const templateParam = request.nextUrl.searchParams.get("template") ?? undefined;
  const template = TEMPLATES.includes(templateParam ?? "") ? (templateParam as ReportTemplateId) : undefined;
  const title = document.metadata.title;

  try {
    switch (format) {
      case "html": {
        const html = renderReportHtml(document, template);
        return new NextResponse(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fileName(title, "html")}"`,
          },
        });
      }
      case "pdf": {
        const pdf = renderReportPdf(document, template);
        return new NextResponse(Buffer.from(pdf), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${fileName(title, "pdf")}"`,
          },
        });
      }
      case "docx": {
        const docx = await renderReportDocx(document, template);
        return new NextResponse(new Uint8Array(docx), {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "Content-Disposition": `attachment; filename="${fileName(title, "docx")}"`,
          },
        });
      }
      case "csv": {
        const csv = renderReportCsv(document);
        return new NextResponse(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fileName(title, "csv")}"`,
          },
        });
      }
      default:
        return NextResponse.json({ error: `Format non supporté : ${format}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur d'export";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
