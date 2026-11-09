/**
 * Power BI types — contrats TypeScript pour l'embed et l'agent IA.
 *
 * Ces types sont partagés entre :
 *   - le frontend (powerbi-client, store, agent)
 *   - le backend (API routes, DAX gateway, REST adapter)
 */

// ─── Report State ──────────────────────────────────────────────

export interface PowerBIPageInfo {
  name: string;
  displayName: string;
  /** Page active ou non */
  isActive: boolean;
}

export interface PowerBIBookmarkInfo {
  name: string;
  displayName: string;
}

export interface PowerBIFilterInfo {
  /** Table Power BI (ex: "dim_org_units") */
  table: string;
  /** Colonne Power BI (ex: "province_name") */
  column: string;
  /** Opérateur de filtre */
  operator: "In" | "Equals" | "Contains" | "Advanced";
  /** Valeurs du filtre */
  values: string[];
  /** Type de filtre */
  filterType: string;
}

export interface PowerBIReportState {
  /** Page active (name technique) */
  activePage: string | null;
  /** Page active (nom affichable) */
  activePageDisplayName: string | null;
  /** Filtres actifs sur le rapport */
  filters: PowerBIFilterInfo[];
  /** Bookmark actif (si applicable) */
  activeBookmark: string | null;
  /** Liste des pages disponibles */
  pages: PowerBIPageInfo[];
  /** Liste des bookmarks disponibles */
  bookmarks: PowerBIBookmarkInfo[];
  /** Rapport chargé */
  loaded: boolean;
}

// ─── Filter Command ────────────────────────────────────────────

export interface PowerBIFilterCommand {
  /** Table Power BI ciblée par le filtre */
  table: string;
  /** Colonne Power BI ciblée par le filtre */
  column: string;
  /** Opérateur de filtre */
  operator: "In" | "Equals" | "Contains";
  /** Valeurs à filtrer */
  values: string[];
}

// ─── Actions (agent → report) ──────────────────────────────────

export type PowerBIActionType =
  | "change_page"
  | "apply_filters"
  | "clear_filters"
  | "apply_bookmark"
  | "set_active";

export interface PowerBIAction {
  type: PowerBIActionType;
  /** Nom technique de la page (pour change_page) */
  pageName?: string;
  /** Nom technique du bookmark (pour apply_bookmark) */
  bookmarkName?: string;
  /** Filtres à appliquer (pour apply_filters) */
  filters?: PowerBIFilterCommand[];
  /** Table à clear (pour clear_filters, null = toutes) */
  table?: string;
}

// ─── Query (DAX via REST) ──────────────────────────────────────

export interface PowerBIQueryRequest {
  /** Requête DAX (EVALUATE ...) */
  dax: string;
  /** Timeout en ms (défaut: 10000) */
  timeoutMs?: number;
  /** Limite de lignes (défaut: 500) */
  maxRows?: number;
}

export interface PowerBIQueryResult {
  /** Colonnes du résultat */
  columns: string[];
  /** Lignes du résultat (tableau de tableaux) */
  rows: unknown[][];
  /** Nombre de lignes retournées */
  rowCount: number;
  /** Temps d'exécution en ms */
  durationMs: number;
}

// ─── Model metadata ────────────────────────────────────────────

export interface PowerBITableInfo {
  name: string;
  columns: string[];
}

export interface PowerBIModelInfo {
  /** ID du dataset */
  datasetId: string;
  /** Nom du dataset */
  name: string;
  /** Tables du dataset */
  tables: PowerBITableInfo[];
  /** Indicateurs PEV associés (depuis le Semantic Layer) */
  indicators?: Array<{
    code: string;
    label: string;
    daxMeasure?: string;
    domain: string;
  }>;
}

// ─── Embed config ──────────────────────────────────────────────

export interface PowerBIEmbedConfig {
  embedUrl: string;
  embedToken: string;
  reportId: string;
  expiresAt: string;
}

// ─── Errors ────────────────────────────────────────────────────

export interface PowerBIError {
  code: string;
  message: string;
  retryable: boolean;
}
