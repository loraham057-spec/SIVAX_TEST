"use client";

import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Activity,
  Database,
  Network,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssistant } from "@/store/assistant-store";
import { useTranslations } from "next-intl";
import { ANALYTICS_PAGES, type AnalyticsPageId } from "@/components/dashboard/analytics-pages";

interface WelcomePageProps {
  /** Opens the default vaccination-coverage analysis. */
  onStartVisualization?: () => void;
  /** Opens the AI assistant. */
  onLaunchAi?: () => void;
  /** Opens a selected thematic analytics page directly. */
  onOpenPage?: (pageId: AnalyticsPageId) => void;
}

const DECISION_STEPS = [
  { icon: Database, title: "Centraliser", description: "DHIS2 et rapports Power BI" },
  { icon: Activity, title: "Comprendre", description: "Tendances, écarts et équité" },
  { icon: Target, title: "Prioriser", description: "Zones et actions à investiguer" },
];

export function WelcomePage({ onStartVisualization, onLaunchAi, onOpenPage }: WelcomePageProps) {
  const { open: openAssistant } = useAssistant();
  const t = useTranslations("welcome");
  const tPages = useTranslations("analyticsPages");

  const handleLaunchAi = () => {
    onLaunchAi?.();
    if (!onLaunchAi) openAssistant();
  };

  const handleOpenPage = (pageId: AnalyticsPageId) => {
    if (onOpenPage) {
      onOpenPage(pageId);
      return;
    }
    onStartVisualization?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-7 overflow-y-auto bg-[#F4F7FB] p-4 sm:p-6 lg:p-7 dark:bg-background">
      {/* Decision-intelligence hero */}
      <section className="relative isolate overflow-hidden rounded-[26px] bg-gradient-to-br from-[#102D55] via-[#174A8B] to-[#117E85] px-6 py-8 text-white shadow-[0_22px_55px_rgba(23,74,139,0.22)] sm:px-9 sm:py-10 lg:px-11 lg:py-11">
        <div className="pointer-events-none absolute -right-20 -top-32 -z-10 h-80 w-80 rounded-full border-[34px] border-white/5" />
        <div className="pointer-events-none absolute -bottom-36 right-[20%] -z-10 h-72 w-72 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="pointer-events-none absolute right-[34%] top-0 -z-10 h-full w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />

        <div className="grid items-center gap-9 lg:grid-cols-[minmax(0,1.12fr)_minmax(330px,0.88fr)] lg:gap-12">
          <div className="max-w-2xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-bold tracking-wide text-cyan-50 shadow-sm backdrop-blur-sm sm:text-sm">
              <Sparkles className="h-4 w-4 text-cyan-200" />
              {t("badge")}
            </div>

            <h1 className="max-w-2xl text-[30px] font-extrabold leading-[1.12] tracking-tight text-white sm:text-[38px] lg:text-[43px]">
              {t("title")}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-7 text-blue-50/90 sm:text-[17px]">
              {t("description")}
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button
                size="lg"
                onClick={onStartVisualization}
                className="group h-12 gap-2 rounded-xl border border-white/10 bg-white px-5 text-[15px] font-extrabold text-[#174A8B] shadow-lg shadow-slate-950/15 transition-all hover:-translate-y-0.5 hover:bg-blue-50 hover:shadow-xl"
              >
                <BarChart3 className="h-[18px] w-[18px]" />
                {t("startVisualization")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={handleLaunchAi}
                className="group h-12 gap-2 rounded-xl border border-white/35 bg-white/5 px-5 text-[15px] font-bold text-white shadow-sm backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-white/60 hover:bg-white/15 hover:text-white"
              >
                <Sparkles className="h-[18px] w-[18px] text-cyan-200" />
                {t("launchAi")}
                <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-white/15 pt-5 text-sm text-blue-50/90">
              <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-teal-200" /> Pilotage du PEV</span>
              <span className="hidden h-4 w-px bg-white/25 sm:block" />
              <span className="inline-flex items-center gap-2"><Network className="h-4 w-4 text-cyan-200" /> Données territoriales</span>
            </div>
          </div>

          {/* Explanatory product preview — no fabricated health figures. */}
          <div className="relative mx-auto w-full max-w-[480px] lg:mx-0 lg:justify-self-end">
            <div className="absolute -inset-3 rounded-[28px] bg-cyan-300/10 blur-xl" />
            <div className="relative overflow-hidden rounded-2xl border border-white/20 bg-[#F8FBFF] p-4 text-[#172B4D] shadow-2xl shadow-slate-950/20 sm:p-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#174A8B] text-white">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-extrabold">SIVAX Decision Desk</p>
                    <p className="text-xs font-medium text-slate-500">Pilotage de la vaccination</p>
                  </div>
                </div>
                <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-bold text-teal-700">RDC</span>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {DECISION_STEPS.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <div key={step.title} className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${index === 0 ? "bg-blue-50 text-blue-700" : index === 1 ? "bg-teal-50 text-teal-700" : "bg-violet-50 text-violet-700"}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="text-xs font-extrabold sm:text-sm">{step.title}</p>
                      <p className="mt-1 text-[10px] leading-4 text-slate-500 sm:text-[11px]">{step.description}</p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 rounded-xl bg-gradient-to-r from-[#EAF2FC] to-[#E9F8F6] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#174A8B]">Du constat à la décision</p>
                    <p className="mt-1 text-sm font-bold text-slate-800">Une lecture commune des données</p>
                  </div>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#117E85] shadow-sm">
                    <Sparkles className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5">
                  <span className="h-1.5 flex-1 rounded-full bg-[#174A8B]" />
                  <span className="h-1.5 flex-1 rounded-full bg-[#13A89E]" />
                  <span className="h-1.5 flex-1 rounded-full bg-[#7C3AED]" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                <Database className="h-3.5 w-3.5" />
                DHIS2 Analytics · Power BI · Agent IA
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Thematic spaces */}
      <section>
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#13A89E]">Explorer les analyses</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">Choisissez votre espace de pilotage</h2>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-[15px]">Accédez directement au domaine que vous souhaitez analyser.</p>
          </div>
          <button
            type="button"
            onClick={onStartVisualization}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-bold text-primary transition-colors hover:text-accent"
          >
            Ouvrir la couverture vaccinale <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ANALYTICS_PAGES.map((page) => {
            const Icon = page.icon;
            const indicators = tPages(`pages.${page.id}.indicators`).split("|").slice(0, 3);
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => handleOpenPage(page.id)}
                className="group flex min-h-[142px] flex-col rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-[0_3px_12px_rgba(23,43,77,0.035)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_12px_28px_rgba(23,74,139,0.10)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:border-border dark:bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${page.accent}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-slate-400 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
                <div className="mt-3">
                  <h3 className="text-[15px] font-extrabold tracking-tight text-slate-800 dark:text-foreground">{tPages(`pages.${page.id}.title`)}</h3>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-slate-500 dark:text-muted-foreground">{tPages(`pages.${page.id}.description`)}</p>
                </div>
                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                  {indicators.map((indicator) => (
                    <span key={indicator} className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-muted dark:text-muted-foreground">
                      {indicator}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Institutional partners */}
      <section className="rounded-2xl border border-slate-200/80 bg-white/80 px-5 py-5 dark:border-border dark:bg-card">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="text-center sm:text-left">
            <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-400">{t("partners")}</p>
            <p className="mt-1 text-sm font-semibold text-slate-600 dark:text-muted-foreground">Une plateforme au service du programme de vaccination.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8">
            <img src="/logo_min_sante.png" alt="Ministère de la Santé Publique RDC" className="h-10 w-auto max-w-[150px] object-contain sm:h-12" />
            <img src="/logo_pev.jpg" alt="Programme Élargi de Vaccination" className="h-10 w-auto max-w-[90px] object-contain sm:h-12" />
            <img src="/logo_villagereach.png" alt="VillageReach" className="h-10 w-auto max-w-[125px] object-contain sm:h-12" />
          </div>
        </div>
      </section>
    </div>
  );
}
