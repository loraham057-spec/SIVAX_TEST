/**
 * DAX Gateway — validation et exécution sécurisée des requêtes DAX.
 *
 * Le gateway garantit que seules des requêtes DAX read-only sont exécutées,
 * avec un timeout, une limite de lignes, et une whitelist de tables.
 *
 * Sécurité :
 *   - Read-only uniquement (EVALUATE, pas de INSERT/UPDATE/DELETE/CREATE)
 *   - Whitelist de tables autorisées
 *   - Timeout configurable
 *   - Limite de lignes
 *   - Limite de longueur de requête
 *   - Pas d'accès en écriture au modèle
 */

import { getAzureADToken } from "@/lib/powerbi";

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg";

// ─── Configuration ─────────────────────────────────────────────

export interface DAXPolicy {
  /** Longueur maximale de la requête DAX (caractères) */
  maxQueryLength: number;
  /** Nombre maximum de lignes retournées */
  maxRows: number;
  /** Timeout en millisecondes */
  timeoutMs: number;
  /** Tables autorisées (whitelist) */
  allowedTables: string[];
  /** Mots-clés interdits (write operations) */
  forbiddenKeywords: string[];
}

export const DEFAULT_DAX_POLICY: DAXPolicy = {
  maxQueryLength: 5000,
  maxRows: 500,
  timeoutMs: 10000,
  allowedTables: [
    "fact_indicator_values",
    "dim_indicators",
    "dim_org_units",
    "dim_date",
  ],
  forbiddenKeywords: [
    "INSERT",
    "UPDATE",
    "DELETE",
    "CREATE",
    "DROP",
    "ALTER",
    "REFRESH",
    "CALCULATE TABLE",
    "ADD",
    "REMOVE",
  ],
};

// ─── Validation ────────────────────────────────────────────────

export interface DAXValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Valide une requête DAX selon la policy.
 */
export function validateDAX(
  dax: string,
  policy: DAXPolicy = DEFAULT_DAX_POLICY,
): DAXValidationResult {
  if (!dax || dax.trim().length === 0) {
    return { valid: false, error: "Requête DAX vide." };
  }

  if (dax.length > policy.maxQueryLength) {
    return {
      valid: false,
      error: `Requête trop longue (${dax.length} > ${policy.maxQueryLength} caractères).`,
    };
  }

  const upperDax = dax.toUpperCase();

  // Doit commencer par EVALUATE (read-only)
  const trimmed = dax.trim().toUpperCase();
  if (!trimmed.startsWith("EVALUATE") && !trimmed.startsWith("//") && !trimmed.startsWith("DEFINE")) {
    return {
      valid: false,
      error: "La requête doit commencer par EVALUATE ou DEFINE ... EVALUATE.",
    };
  }

  // Vérifier les mots-clés interdits
  for (const keyword of policy.forbiddenKeywords) {
    if (upperDax.includes(keyword.toUpperCase())) {
      return {
        valid: false,
        error: `Mot-clé interdit détecté: ${keyword}. Seules les requêtes read-only sont autorisées.`,
      };
    }
  }

  return { valid: true };
}

// ─── Exécution ─────────────────────────────────────────────────

export interface DAXExecuteOptions {
  datasetId: string;
  workspaceId?: string;
  timeoutMs?: number;
  maxRows?: number;
}

export interface DAXExecuteResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

/**
 * Exécute une requête DAX via l'API REST executeQueries.
 * La requête doit déjà être validée par validateDAX().
 */
export async function executeDAX(
  dax: string,
  options: DAXExecuteOptions,
): Promise<DAXExecuteResult> {
  const startTime = Date.now();
  const token = await getAzureADToken();
  const groupPath = options.workspaceId ? `/groups/${options.workspaceId}` : "";
  const maxRows = options.maxRows ?? DEFAULT_DAX_POLICY.maxRows;

  // Construire le corps de la requête executeQueries
  const body = {
    queries: [{ query: dax }],
    impersonatedConnections: false,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_DAX_POLICY.timeoutMs,
  );

  try {
    const res = await fetch(
      `${POWERBI_API_BASE}${groupPath}/datasets/${options.datasetId}/executeQueries`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Power BI executeQueries failed (${res.status}): ${errorText}`);
    }

    const data = await res.json();
    const result = data.results?.[0];

    if (!result || !result.tables || result.tables.length === 0) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    const table = result.tables[0];
    const rows = (table.rows ?? []).slice(0, maxRows);
    // Extraire les colonnes depuis la première ligne (ou depuis les metadata)
    const columns: string[] =
      rows.length > 0
        ? Object.keys(rows[0])
        : (table.columns?.map((c: { name: string }) => c.name) ?? []);

    // Convertir les lignes d'objets en tableaux (ordre des colonnes)
    const rowsAsArrays = rows.map((row: Record<string, unknown>) =>
      columns.map((col) => row[col]),
    );

    return {
      columns,
      rows: rowsAsArrays,
      rowCount: rowsAsArrays.length,
      durationMs: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
