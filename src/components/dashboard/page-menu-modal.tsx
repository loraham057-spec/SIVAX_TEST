"use client";

/**
 * PageMenuModal — page navigator for the "DHIS2 Analytics In-App" tab.
 *
 * Opened from the layout-dashboard icon button in the container toolbar.
 * Lets the user browse the 9 analytics pages (each grouping a family of
 * indicators), understand what each page contains, and jump to it.
 *
 * UX:
 *  - Search field on top, filtering pages by title / description.
 *  - Desktop (sm+): two columns — page list on the left, live detail panel
 *    on the right updated on hover/focus; clicking a row opens the page.
 *  - Mobile: single-column accordion — tapping a row expands its
 *    description, key indicators and an "Open page" button.
 *  - Badges: "Current" for the active page, "Soon" for pages whose charts
 *    are not implemented yet (they open onto a placeholder).
 */

import { useEffect, useMemo, useState } from "react";
import { Search, ArrowRight, ChevronDown, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ANALYTICS_PAGES,
  type AnalyticsPageDef,
  type AnalyticsPageId,
} from "@/components/dashboard/analytics-pages";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface PageMenuModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activePage: AnalyticsPageId;
  onSelectPage: (id: AnalyticsPageId) => void;
}

export function PageMenuModal({ open, onOpenChange, activePage, onSelectPage }: PageMenuModalProps) {
  const t = useTranslations("analyticsPages");
  const [query, setQuery] = useState("");
  /** Page previewed in the desktop detail panel (hover/focus). */
  const [previewId, setPreviewId] = useState<AnalyticsPageId>(activePage);
  /** Page expanded in the mobile accordion. */
  const [expandedId, setExpandedId] = useState<AnalyticsPageId | null>(null);

  // Reset transient state each time the modal opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setPreviewId(activePage);
      setExpandedId(activePage);
    }
  }, [open, activePage]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ANALYTICS_PAGES;
    return ANALYTICS_PAGES.filter((p) => {
      const title = t(`pages.${p.id}.title`).toLowerCase();
      const desc = t(`pages.${p.id}.description`).toLowerCase();
      const indicators = t(`pages.${p.id}.indicators`).toLowerCase();
      return title.includes(q) || desc.includes(q) || indicators.includes(q);
    });
  }, [query, t]);

  // Keep the desktop preview pointing at a visible page.
  useEffect(() => {
    if (filtered.length > 0 && !filtered.some((p) => p.id === previewId)) {
      setPreviewId(filtered[0].id);
    }
  }, [filtered, previewId]);

  const preview = ANALYTICS_PAGES.find((p) => p.id === previewId) ?? ANALYTICS_PAGES[0];

  const handleOpenPage = (id: AnalyticsPageId) => {
    onSelectPage(id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        {/* Header + search */}
        <DialogHeader className="space-y-2 border-b px-4 pb-4 pt-5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Layers className="h-[18px] w-[18px] text-primary" />
            </div>
            <div className="text-left">
              <DialogTitle className="text-base">{t("modalTitle")}</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                {t("modalSubtitle")}
              </DialogDescription>
            </div>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 pl-9"
              autoFocus
            />
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
              <Search className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{t("noResults")}</p>
            </div>
          ) : (
            <>
              {/* Desktop: list (left) + detail panel (right) */}
              <div className="hidden min-h-0 flex-1 sm:flex">
                <div className="min-h-0 w-[46%] overflow-y-auto border-r p-2" role="listbox" aria-label={t("modalTitle")}>
                  {filtered.map((page) => (
                    <PageListItem
                      key={page.id}
                      page={page}
                      active={page.id === activePage}
                      previewed={page.id === previewId}
                      onPreview={() => setPreviewId(page.id)}
                      onOpen={() => handleOpenPage(page.id)}
                    />
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <PageDetail
                    page={preview}
                    active={preview.id === activePage}
                    onOpen={() => handleOpenPage(preview.id)}
                  />
                </div>
              </div>

              {/* Mobile: accordion list */}
              <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:hidden">
                {filtered.map((page) => (
                  <PageAccordionItem
                    key={page.id}
                    page={page}
                    active={page.id === activePage}
                    expanded={page.id === expandedId}
                    onToggle={() => setExpandedId((prev) => (prev === page.id ? null : page.id))}
                    onOpen={() => handleOpenPage(page.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function PageBadges({ page, active }: { page: AnalyticsPageDef; active: boolean }) {
  const t = useTranslations("analyticsPages");
  if (active) {
    return (
      <Badge className="h-5 shrink-0 bg-primary/10 px-1.5 text-[10px] font-medium text-primary hover:bg-primary/10">
        {t("current")}
      </Badge>
    );
  }
  if (!page.available) {
    return (
      <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] font-medium text-muted-foreground">
        {t("comingSoon")}
      </Badge>
    );
  }
  return null;
}

function IndicatorChips({ pageId }: { pageId: AnalyticsPageId }) {
  const t = useTranslations("analyticsPages");
  const indicators = t(`pages.${pageId}.indicators`).split("|").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {indicators.map((ind) => (
        <span
          key={ind}
          className="rounded-md border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground"
        >
          {ind}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop                                                             */
/* ------------------------------------------------------------------ */

interface PageListItemProps {
  page: AnalyticsPageDef;
  active: boolean;
  previewed: boolean;
  onPreview: () => void;
  onOpen: () => void;
}

function PageListItem({ page, active, previewed, onPreview, onOpen }: PageListItemProps) {
  const t = useTranslations("analyticsPages");
  const Icon = page.icon;
  return (
    <button
      type="button"
      role="option"
      aria-selected={previewed}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        previewed ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {t(`pages.${page.id}.title`)}
      </span>
      <PageBadges page={page} active={active} />
    </button>
  );
}

function PageDetail({ page, active, onOpen }: { page: AnalyticsPageDef; active: boolean; onOpen: () => void }) {
  const t = useTranslations("analyticsPages");
  const Icon = page.icon;
  return (
    <div className="flex h-full flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{t(`pages.${page.id}.title`)}</h3>
            <PageBadges page={page} active={active} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t(`pages.${page.id}.description`)}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("keyIndicators")}
        </p>
        <IndicatorChips pageId={page.id} />
      </div>

      <div className="mt-auto pt-2">
        <Button onClick={onOpen} className="w-full gap-1.5" size="sm" disabled={active}>
          {active ? t("alreadyViewing") : t("openPage")}
          {!active && <ArrowRight className="h-3.5 w-3.5" />}
        </Button>
        {!page.available && (
          <p className="mt-2 text-center text-[11px] text-muted-foreground">
            {t("comingSoonHint")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile                                                              */
/* ------------------------------------------------------------------ */

interface PageAccordionItemProps {
  page: AnalyticsPageDef;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

function PageAccordionItem({ page, active, expanded, onToggle, onOpen }: PageAccordionItemProps) {
  const t = useTranslations("analyticsPages");
  const Icon = page.icon;
  return (
    <div className={cn("mb-1 overflow-hidden rounded-lg transition-colors", expanded ? "bg-primary/10" : "hover:bg-primary/10")}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className={cn("h-4 w-4 shrink-0", expanded ? "text-primary" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {t(`pages.${page.id}.title`)}
        </span>
        <PageBadges page={page} active={active} />
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded && (
        <div className="space-y-3 px-3 pb-3 pl-10">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(`pages.${page.id}.description`)}
          </p>
          <IndicatorChips pageId={page.id} />
          <Button onClick={onOpen} size="sm" className="w-full gap-1.5" disabled={active}>
            {active ? t("alreadyViewing") : t("openPage")}
            {!active && <ArrowRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}
    </div>
  );
}
