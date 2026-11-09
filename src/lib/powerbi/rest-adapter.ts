/**
 * Power BI REST adapter — implémentation de PowerBIIntelligence via REST API.
 *
 * Utilise l'API REST Power BI (executeQueries) pour exécuter des requêtes DAX
 * et récupérer les métadonnées du dataset. Pas de MCP, pas de XMLA.
 *
 * Toutes les méthodes sont read-only et s'exécutent côté serveur.
 */

import { getAzureADToken, getPowerBIEnv } from "@/lib/powerbi";
import type {
  PowerBIQueryRequest,
  PowerBIQueryResult,
  PowerBIModelInfo,
  PowerBITableInfo,
} from "./types";
import { PEV_INDICATORS } from "@/lib/pev";
import { validateDAX, executeDAX } from "./dax-gateway";

const POWERBI_API_BASE = "https://api.powerbi.com/v1.0/myorg";

/**
 * Récupère les métadonnées du dataset (tables et colonnes).
 */
export async function getModel(): Promise<PowerBIModelInfo> {
  const env = await getPowerBIEnv();
  if (!env.datasetId) {
    throw new Error("POWERBI_DATASET_ID is not configured");
  }

  const token = await getAzureADToken();
  const groupPath = env.workspaceId ? `/groups/${env.workspaceId}` : "";

  // Récupérer les infos du dataset
  const datasetRes = await fetch(
    `${POWERBI_API_BASE}${groupPath}/datasets/${env.datasetId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  if (!datasetRes.ok) {
    const error = await datasetRes.text();
    throw new Error(`Failed to fetch dataset info: ${error}`);
  }

  const dataset = await datasetRes.json();

  // Récupérer les tables du dataset
  const tablesRes = await fetch(
    `${POWERBI_API_BASE}${groupPath}/datasets/${env.datasetId}/tables`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  let tables: PowerBITableInfo[] = [];
  if (tablesRes.ok) {
    const tablesData = await tablesRes.json();
    tables = (tablesData.value ?? []).map((t: { name: string; columns?: Array<{ name: string }> }) => ({
      name: t.name,
      columns: (t.columns ?? []).map((c: { name: string }) => c.name),
    }));
  }

  // Enrichir avec les indicateurs PEV du Semantic Layer
  const indicators = PEV_INDICATORS.map((i) => ({
    code: i.code,
    label: i.label,
    domain: i.domain,
    daxMeasure: `[${i.label}]`,
  }));

  return {
    datasetId: env.datasetId,
    name: dataset.name ?? "Unknown",
    tables,
    indicators,
  };
}

/**
 * Exécute une requête DAX via l'API REST executeQueries.
 * La requête passe d'abord par le DAX Gateway pour validation.
 */
export async function query(request: PowerBIQueryRequest): Promise<PowerBIQueryResult> {
  const env = await getPowerBIEnv();
  if (!env.datasetId) {
    throw new Error("POWERBI_DATASET_ID is not configured");
  }

  // Valider via le DAX Gateway
  const validation = validateDAX(request.dax);
  if (!validation.valid) {
    throw new Error(`DAX validation failed: ${validation.error}`);
  }

  return executeDAX(request.dax, {
    datasetId: env.datasetId,
    workspaceId: env.workspaceId,
    timeoutMs: request.timeoutMs ?? 10000,
    maxRows: request.maxRows ?? 500,
  });
}
