"use client";

/**
 * Power BI Store — état du rapport Power BI embarqué.
 *
 * Stocke l'instance report (powerbi-client) et l'état courant
 * (page active, filtres, bookmarks) pour que l'agent IA puisse
 * les lire et les modifier via les commandes enregistrées.
 */

import { create } from "zustand";
import type { PowerBIReportInstance } from "@/components/powerbi/powerbi-embed";
import type { PowerBIReportState, PowerBIFilterInfo } from "@/lib/powerbi/types";

interface PowerBIStore {
  /** Instance report powerbi-client (null tant que le rapport n'est pas chargé) */
  report: PowerBIReportInstance | null;
  /** État courant du rapport */
  state: PowerBIReportState;
  /** Définit l'instance report quand elle est prête */
  setReport: (report: PowerBIReportInstance | null) => void;
  /** Met à jour l'état courant */
  updateState: (partial: Partial<PowerBIReportState>) => void;
  /** Rafraîchit l'état depuis l'instance report (getPages, getFilters, etc.) */
  refreshState: () => Promise<void>;
  /** Réinitialise le store */
  reset: () => void;
}

const INITIAL_STATE: PowerBIReportState = {
  activePage: null,
  activePageDisplayName: null,
  filters: [],
  activeBookmark: null,
  pages: [],
  bookmarks: [],
  loaded: false,
};

export const usePowerBIStore = create<PowerBIStore>((set, get) => ({
  report: null,
  state: INITIAL_STATE,

  setReport: (report) => {
    set({ report });
    if (report) {
      // Rafraîchir l'état dès que le report est disponible
      get().refreshState();
    } else {
      set({ state: INITIAL_STATE });
    }
  },

  updateState: (partial) => {
    set((s) => ({ state: { ...s.state, ...partial } }));
  },

  refreshState: async () => {
    const { report } = get();
    if (!report) return;

    try {
      // Récupérer les pages
      const pages = await report.getPages();
      const activePage = pages.find((p) => p.isActive);

      // Récupérer les filtres
      const rawFilters = await report.getFilters();
      const filters: PowerBIFilterInfo[] = (rawFilters as unknown[]).map(
        (f) => {
          const filter = f as {
            target?: { table?: string; column?: string };
            operator?: string;
            filterType?: string;
            values?: unknown[];
          };
          return {
            table: filter.target?.table ?? "",
            column: filter.target?.column ?? "",
            operator: (filter.operator as PowerBIFilterInfo["operator"]) ?? "In",
            values: (filter.values ?? []).map(String),
            filterType: filter.filterType ?? "Basic",
          };
        },
      );

      // Récupérer les bookmarks (si disponibles)
      let bookmarks: PowerBIReportState["bookmarks"] = [];
      if (report.bookmarks) {
        try {
          bookmarks = await report.bookmarks.getBookmarks();
        } catch {
          // bookmarks non disponibles sur ce rapport
        }
      }

      set({
        state: {
          activePage: activePage?.name ?? null,
          activePageDisplayName: activePage?.displayName ?? null,
          filters,
          activeBookmark: null,
          pages: pages.map((p) => ({
            name: p.name,
            displayName: p.displayName,
            isActive: p.isActive,
          })),
          bookmarks: bookmarks.map((b) => ({
            name: b.name,
            displayName: b.displayName,
          })),
          loaded: true,
        },
      });
    } catch (err) {
      console.error("[powerbi-store] Failed to refresh state:", err);
    }
  },

  reset: () => {
    set({ report: null, state: INITIAL_STATE });
  },
}));
