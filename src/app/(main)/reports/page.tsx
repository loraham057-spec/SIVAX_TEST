"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  Sparkles,
  Star,
  Trash2,
  Eye,
  CalendarClock,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FilterSelect } from "@/components/ui/filter-select";
import type { ReportGenerationStatus, ReportJob, ReportPlan, ReportRecord } from "@/lib/report-engine/types";

interface PlanOptions {
  reportTypes: { id: string; name: string }[];
  templates: { id: string; name: string }[];
}

interface ResolvedScope {
  name: string;
  level: number;
  resolved: boolean;
  query: string | null;
}

const ACTIVE_STATUSES = new Set(["PLANNING", "DATA_COLLECTION", "ANALYSIS", "COMPOSITION", "RENDERING"]);

const AUDIENCE_KEYS = ["EXECUTIVE", "TECHNICAL", "PARTNER", "DONOR", "PUBLIC"] as const;

export default function ReportsPage() {
  const t = useTranslations("reports");
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<ReportPlan | null>(null);
  const [options, setOptions] = useState<PlanOptions | null>(null);
  const [resolvedScope, setResolvedScope] = useState<ResolvedScope | null>(null);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Pagination state ───────────────────────────────────
  const REPORTS_PER_PAGE = 10;
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const loadReports = useCallback(async (page: number) => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(REPORTS_PER_PAGE),
      });
      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      setReports(data.reports ?? []);
      setTotalCount(data.pagination?.total ?? 0);
      setTotalPages(data.pagination?.totalPages ?? 1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports(currentPage);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadReports, currentPage]);

  const analyze = async (text?: string) => {
    const p = (text ?? prompt).trim();
    if (!p || planning) return;
    setPlanning(true);
    try {
      const res = await fetch("/api/reports/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setPlan(data.plan);
      setOptions(data.options);
      setResolvedScope(data.resolvedScope ?? null);
    } catch {
      toast.error(t("generationFailed"));
    } finally {
      setPlanning(false);
    }
  };

  const generate = async () => {
    if (!plan) return;
    setPlan(null);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setJob(data.job);
      pollRef.current = setInterval(async () => {
        const jr = await fetch(`/api/reports/jobs/${data.job.id}`);
        if (!jr.ok) return;
        const { job: current } = (await jr.json()) as { job: ReportJob };
        setJob(current);
        if (current.status === "COMPLETED") {
          if (pollRef.current) clearInterval(pollRef.current);
          toast.success(t("reportReady"));
          setJob(null);
          setPrompt("");
          await loadReports(currentPage);
          if (current.reportId) router.push(`/reports/${current.reportId}`);
        } else if (current.status === "FAILED") {
          if (pollRef.current) clearInterval(pollRef.current);
          toast.error(current.error ?? t("generationFailed"));
          setJob(null);
        }
      }, 1500);
    } catch {
      toast.error(t("generationFailed"));
    }
  };

  const toggleFavorite = async (report: ReportRecord) => {
    setReports((rs) => rs.map((r) => (r.id === report.id ? { ...r, favorite: !r.favorite } : r)));
    await fetch(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favorite: !report.favorite }),
    });
  };

  const removeReport = async (report: ReportRecord) => {
    if (!window.confirm(t("confirmDelete"))) return;
    setReports((rs) => rs.filter((r) => r.id !== report.id));
    await fetch(`/api/reports/${report.id}`, { method: "DELETE" });
  };

  const suggestions = [
    { label: t("suggestionStock"), prompt: "Génère-moi un rapport sur l'état des stocks au niveau national sur les 6 derniers mois." },
    { label: t("suggestionPerformance"), prompt: "Génère-moi un rapport de performance vaccinale sur les 12 derniers mois destiné à la direction." },
    { label: t("suggestionStockout"), prompt: "Fais-moi un rapport sur les ruptures de stock sur les 6 derniers mois." },
    { label: t("suggestionCapacity"), prompt: "Génère un rapport sur l'état de capacité de stockage au niveau national." },
    { label: t("suggestionColdChain"), prompt: "Génère un rapport d'inventaire des équipements de la chaîne du froid." },
    { label: t("suggestionEquipment"), prompt: "Fais un rapport sur l'adéquation de l'approvisionnement sur les 6 derniers mois." },
  ];

  const now = new Date();
  const thisMonth = reports.filter((r) => {
    const d = new Date(r.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  const inProgress = reports.filter((r) => ACTIVE_STATUSES.has(r.status)).length;
  const kpis = [
    { label: t("kpiTotal"), value: totalCount || reports.length, icon: FileText },
    { label: t("kpiThisMonth"), value: thisMonth, icon: CalendarClock },
    { label: t("kpiInProgress"), value: Math.max(inProgress, job ? 1 : 0), icon: Clock },
    { label: t("kpiFavorites"), value: reports.filter((r) => r.favorite).length, icon: Star },
  ];

  const statusLabel = (status: ReportGenerationStatus) => t(`status${status}`);

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => promptRef.current?.focus()}>
          <Sparkles className="mr-2 h-4 w-4" />
          {t("generateReport")}
        </Button>
      </div>

      {/* AI prompt box */}
      <Card>
        <CardContent className="pt-6">
          <label className="text-sm font-medium">{t("promptLabel")}</label>
          <Textarea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("promptPlaceholder")}
            className="mt-2 min-h-[90px]"
            disabled={Boolean(job)}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("suggestions")} :</span>
            {suggestions.map((s) => (
              <Badge
                key={s.label}
                variant="outline"
                className="cursor-pointer hover:bg-accent"
                onClick={() => { setPrompt(s.prompt); analyze(s.prompt); }}
              >
                {s.label}
              </Badge>
            ))}
            <div className="ml-auto">
              <Button onClick={() => analyze()} disabled={!prompt.trim() || planning || Boolean(job)}>
                {planning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {planning ? t("analyzing") : t("analyze")}
              </Button>
            </div>
          </div>
          {job && (
            <div className="mt-4 flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{statusLabel(job.status)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="flex items-center gap-3 pt-6">
              <kpi.icon className="h-8 w-8 text-primary" />
              <div>
                <div className="text-2xl font-bold">{kpi.value}</div>
                <div className="text-xs text-muted-foreground">{kpi.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Reports table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="h-8 w-8 shrink-0 rounded bg-muted animate-pulse" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
                    <div className="h-2 w-1/3 rounded bg-muted animate-pulse" />
                  </div>
                  <div className="h-6 w-16 rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : reports.length === 0 ? (
            <div className="py-10 text-center">
              <FileText className="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p className="mt-3 font-medium">{t("noReports")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("noReportsDesc")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">{t("tableReport")}</th>
                    <th className="px-3 py-2">{t("tableType")}</th>
                    <th className="px-3 py-2">{t("tablePeriod")}</th>
                    <th className="px-3 py-2">{t("tableScope")}</th>
                    <th className="px-3 py-2">{t("tableTemplate")}</th>
                    <th className="px-3 py-2">{t("tableDate")}</th>
                    <th className="px-3 py-2">{t("tableStatus")}</th>
                    <th className="px-3 py-2 text-right">{t("tableActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((report) => (
                    <tr
                      key={report.id}
                      className={`border-b transition-colors ${report.status === "COMPLETED" ? "cursor-pointer hover:bg-muted/50" : "opacity-70"}`}
                      onClick={() => report.status === "COMPLETED" && router.push(`/reports/${report.id}`)}
                    >
                      <td className="max-w-[280px] truncate px-3 py-2.5 font-medium">{report.title}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{report.reportType}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {report.periodStart} → {report.periodEnd}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{report.scope ?? "—"}</td>
                      <td className="px-3 py-2.5"><Badge variant="secondary">{report.template}</Badge></td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                        {new Date(report.createdAt).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant={report.status === "COMPLETED" ? "default" : report.status === "FAILED" ? "destructive" : "secondary"}>
                          {statusLabel(report.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" title={t("favorite")} onClick={() => toggleFavorite(report)}>
                            <Star className={`h-4 w-4 ${report.favorite ? "fill-yellow-400 text-yellow-400" : ""}`} />
                          </Button>
                          <Button variant="ghost" size="icon" title={t("view")} onClick={() => router.push(`/reports/${report.id}`)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title={t("delete")} onClick={() => removeReport(report)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {totalCount > REPORTS_PER_PAGE && !loading && (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <p className="text-sm text-muted-foreground">
                {(currentPage - 1) * REPORTS_PER_PAGE + 1}–{Math.min(currentPage * REPORTS_PER_PAGE, totalCount)} / {totalCount}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  {currentPage} / {totalPages}
                </span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan review dialog */}
      <Dialog open={Boolean(plan)} onOpenChange={(open) => !open && setPlan(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("planTitle")}</DialogTitle>
            <DialogDescription>{t("planDesc")}</DialogDescription>
          </DialogHeader>
          {plan && options && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("planReportType")}</label>
                <FilterSelect
                  className="mt-1"
                  options={options.reportTypes.map((rt) => ({ value: rt.id, label: rt.name }))}
                  value={plan.reportType}
                  onChange={(v) => setPlan({ ...plan, reportType: v })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t("planPeriodStart")}</label>
                  <Input
                    type="month"
                    className="mt-1"
                    value={plan.period.start}
                    onChange={(e) => setPlan({ ...plan, period: { ...plan.period, start: e.target.value } })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t("planPeriodEnd")}</label>
                  <Input
                    type="month"
                    className="mt-1"
                    value={plan.period.end}
                    onChange={(e) => setPlan({ ...plan, period: { ...plan.period, end: e.target.value } })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("planScope")}</label>
                <Input
                  className="mt-1"
                  value={plan.geographicScope ?? ""}
                  placeholder={t("planScopeNational")}
                  onChange={(e) => {
                    setPlan({ ...plan, geographicScope: e.target.value || undefined });
                    setResolvedScope(null);
                  }}
                />
                {resolvedScope && (
                  resolvedScope.resolved ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("scopeResolved", { name: resolvedScope.name })}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                      {t("scopeNotFound", { query: resolvedScope.query ?? "" })}
                    </p>
                  )
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t("planAudience")}</label>
                  <FilterSelect
                    className="mt-1"
                    options={AUDIENCE_KEYS.map((a) => ({
                      value: a,
                      label: t(`audience${a.charAt(0)}${a.slice(1).toLowerCase()}`),
                    }))}
                    value={plan.audience}
                    onChange={(v) => setPlan({ ...plan, audience: v as ReportPlan["audience"] })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">{t("planTemplate")}</label>
                  <FilterSelect
                    className="mt-1"
                    options={options.templates.map((tpl) => ({ value: tpl.id, label: tpl.name }))}
                    value={plan.template}
                    onChange={(v) => setPlan({ ...plan, template: v as ReportPlan["template"] })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">{t("planTitleField")}</label>
                <Input
                  className="mt-1"
                  value={plan.title ?? ""}
                  onChange={(e) => setPlan({ ...plan, title: e.target.value || undefined })}
                />
              </div>
              <Button className="w-full" onClick={generate}>
                <Sparkles className="mr-2 h-4 w-4" />
                {t("generate")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
