"use client";

/**
 * Hook: usePowerBICommands
 *
 * Enregistre toutes les commandes Power BI auprès de l'AgentProvider
 * via useRegisterCommand. Les handlers utilisent l'instance report
 * stockée dans le powerbi-store.
 *
 * Ce hook doit être appelé dans un composant monté sur la page /dashboard
 * (dans le PowerBIContainer mode "powerbi").
 */

import { useRegisterCommand } from "@/lib/agent/agent-provider";
import { usePowerBIStore } from "@/store/powerbi-store";
import { validateFilters } from "@/lib/powerbi/filters";
import { powerbiService } from "@/services";
import type { PowerBIFilterCommand } from "@/lib/powerbi/types";

export function usePowerBICommands() {
  const { report, refreshState } = usePowerBIStore();

  // ─── powerbi_get_state ──────────────────────────────────────
  useRegisterCommand("powerbi_get_state", async () => {
    if (!report) return "Rapport Power BI non chargé.";
    await refreshState();
    const state = usePowerBIStore.getState().state;
    const page = state.activePageDisplayName ?? state.activePage ?? "inconnue";
    const filterCount = state.filters.length;
    return `État courant — Page: ${page}, Filtres actifs: ${filterCount}, Pages disponibles: ${state.pages.length}, Bookmarks: ${state.bookmarks.length}.`;
  });

  // ─── powerbi_get_pages ──────────────────────────────────────
  useRegisterCommand("powerbi_get_pages", async () => {
    if (!report) return "Rapport Power BI non chargé.";
    const pages = await report.getPages();
    const list = pages
      .map((p) => `  • ${p.displayName} (${p.name})${p.isActive ? " [active]" : ""}`)
      .join("\n");
    return `Pages disponibles:\n${list}`;
  });

  // ─── powerbi_get_bookmarks ──────────────────────────────────
  useRegisterCommand("powerbi_get_bookmarks", async () => {
    if (!report) return "Rapport Power BI non chargé.";
    if (!report.bookmarks) return "Aucun bookmark disponible sur ce rapport.";
    const bookmarks = await report.bookmarks.getBookmarks();
    if (bookmarks.length === 0) return "Aucun bookmark défini.";
    const list = bookmarks
      .map((b) => `  • ${b.displayName} (${b.name})`)
      .join("\n");
    return `Bookmarks disponibles:\n${list}`;
  });

  // ─── powerbi_change_page ────────────────────────────────────
  useRegisterCommand("powerbi_change_page", async (args) => {
    if (!report) return "Rapport Power BI non chargé.";
    const pageName = String(args.pageName ?? "");
    if (!pageName) return "Nom de page manquant.";

    const pages = await report.getPages();
    const page = pages.find(
      (p) => p.name === pageName || p.displayName === pageName,
    );
    if (!page) {
      const available = pages.map((p) => p.name).join(", ");
      return `Page « ${pageName} » introuvable. Pages disponibles: ${available}`;
    }

    // setActive is on the Page object, not the report
    const pageWithSetActive = page as typeof page & { setActive(): Promise<void> };
    await pageWithSetActive.setActive();
    await refreshState();
    return `Page changée vers « ${page.displayName} ».`;
  });

  // ─── powerbi_apply_bookmark ─────────────────────────────────
  useRegisterCommand("powerbi_apply_bookmark", async (args) => {
    if (!report) return "Rapport Power BI non chargé.";
    if (!report.bookmarks) return "Aucun bookmark disponible sur ce rapport.";
    const bookmarkName = String(args.bookmarkName ?? "");
    if (!bookmarkName) return "Nom de bookmark manquant.";

    const bookmarks = await report.bookmarks.getBookmarks();
    const bookmark = bookmarks.find(
      (b) => b.name === bookmarkName || b.displayName === bookmarkName,
    );
    if (!bookmark) {
      const available = bookmarks.map((b) => b.name).join(", ");
      return `Bookmark « ${bookmarkName} » introuvable. Bookmarks disponibles: ${available}`;
    }

    await report.bookmarks.apply(bookmark.name);
    await refreshState();
    return `Bookmark « ${bookmark.displayName} » appliqué.`;
  });

  // ─── powerbi_apply_filters ──────────────────────────────────
  useRegisterCommand("powerbi_apply_filters", async (args) => {
    if (!report) return "Rapport Power BI non chargé.";
    const rawFilters = args.filters as PowerBIFilterCommand[] | undefined;
    if (!rawFilters || !Array.isArray(rawFilters) || rawFilters.length === 0) {
      return "Aucun filtre à appliquer.";
    }

    // Valider les filtres via la whitelist
    const { valid, errors } = validateFilters(
      rawFilters.map((f) => ({
        table: f.table,
        column: f.column,
        operator: f.operator,
        values: f.values,
      })),
    );

    if (errors.length > 0) {
      return `Erreurs de validation: ${errors.join("; ")}`;
    }

    // Construire les filtres Power BI au format SDK
    const powerbiFilters = valid.map((f) => {
      const values = f.operator === "Contains" ? f.values : f.values;
      return {
        target: { table: f.table, column: f.column },
        operator: f.operator,
        values,
        filterType: 0, // Basic filter
      };
    });

    await report.setFilters(powerbiFilters as unknown[]);
    await refreshState();
    const applied = valid
      .map((f) => `${f.table}.${f.column}=${f.values.join(",")}`)
      .join("; ");
    return `Filtres appliqués: ${applied}.`;
  });

  // ─── powerbi_clear_filters ──────────────────────────────────
  useRegisterCommand("powerbi_clear_filters", async (args) => {
    if (!report) return "Rapport Power BI non chargé.";
    const table = args.table ? String(args.table) : undefined;
    await report.removeFilters(table);
    await refreshState();
    return table
      ? `Filtres effacés sur la table « ${table} ».`
      : "Tous les filtres ont été effacés.";
  });

  // ─── powerbi_query ──────────────────────────────────────────
  useRegisterCommand("powerbi_query", async (args) => {
    const dax = String(args.dax ?? "");
    if (!dax) return "Requête DAX manquante.";

    try {
      const result = await powerbiService.queryDataset(dax);
      const rows = result.rows.slice(0, 10); // preview first 10 rows
      const cols = result.columns.join(" | ");
      const preview = rows
        .map((r) => r.join(" | "))
        .join("\n");
      return `Requête exécutée (${result.rowCount} lignes, ${result.durationMs}ms):\nColonnes: ${cols}\n${preview}${result.rowCount > 10 ? `\n... (${result.rowCount - 10} lignes de plus)` : ""}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur de requête DAX";
      return `Erreur DAX: ${msg}`;
    }
  });

  // ─── powerbi_get_model ──────────────────────────────────────
  useRegisterCommand("powerbi_get_model", async () => {
    try {
      const model = await powerbiService.getModel();
      const tables = model.tables
        .map((t) => `  • ${t.name} (${t.columns.length} colonnes)`)
        .join("\n");
      return `Modèle: ${model.name}\nTables:\n${tables}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur de récupération du modèle";
      return `Erreur: ${msg}`;
    }
  });
}
