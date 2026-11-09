"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText, Globe, Loader2, Printer, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FilterSelect } from "@/components/ui/filter-select";
import { ReportViewer } from "@/components/reports/report-viewer";
import { TEMPLATE_OPTIONS } from "@/lib/report-engine/templates";
import type { ReportDocument, ReportTemplateId } from "@/lib/report-engine/types";

export default function ReportPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("reports");
  const router = useRouter();
  const [document, setDocument] = useState<ReportDocument | null>(null);
  const [template, setTemplate] = useState<ReportTemplateId>("sivax");
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/reports/${id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setDocument(data.document);
        setTemplate(data.document.template ?? "sivax");
      } catch {
        setError(true);
      }
    })();
  }, [id]);

  const exportAs = (format: string) => {
    window.open(`/api/reports/${id}/export?format=${format}&template=${template}`, "_blank");
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t("linkCopied"));
    } catch {
      toast.error(t("exportError"));
    }
  };

  if (error) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => router.push("/reports")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("back")}
        </Button>
        <p className="mt-6 text-center text-muted-foreground">{t("loadError")}</p>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-muted/40">
      {/* Toolbar */}
      <div className="sticky top-16 z-20 border-b bg-background/95 px-4 py-2 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => router.push("/reports")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("back")}
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <FilterSelect
              options={TEMPLATE_OPTIONS.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
              value={template}
              onChange={(v) => setTemplate(v as ReportTemplateId)}
              minWidth={190}
            />
            <Button variant="outline" size="sm" onClick={() => exportAs("pdf")}>
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportAs("docx")}>
              <FileText className="mr-2 h-4 w-4" />
              DOCX
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportAs("html")}>
              <Globe className="mr-2 h-4 w-4" />
              HTML
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportAs("csv")}>
              <Download className="mr-2 h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={share}>
              <Share2 className="mr-2 h-4 w-4" />
              {t("share")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" />
              {t("print")}
            </Button>
          </div>
        </div>
      </div>

      {/* Document preview */}
      <div className="px-2 py-6 lg:px-6 print:p-0">
        <ReportViewer document={document} template={template} />
      </div>
    </div>
  );
}
