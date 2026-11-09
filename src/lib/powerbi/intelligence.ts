/**
 * Power BI Intelligence — abstraction de l'accès au modèle sémantique Power BI.
 *
 * L'application dépend de cette interface, pas de l'implémentation REST.
 * Cela permet de changer le transport (REST → XMLA → MCP) sans modifier
 * le code appelant (agent IA, API routes, etc.).
 *
 * Implémentation actuelle : rest-adapter.ts (REST executeQueries).
 */

import type {
  PowerBIModelInfo,
  PowerBIQueryRequest,
  PowerBIQueryResult,
} from "./types";

export interface PowerBIIntelligence {
  /** Récupère les métadonnées du modèle (tables, colonnes, indicateurs PEV) */
  getModel(): Promise<PowerBIModelInfo>;
  /** Exécute une requête DAX (validée par le DAX Gateway) */
  query(request: PowerBIQueryRequest): Promise<PowerBIQueryResult>;
}

/**
 * Instance singleton de PowerBIIntelligence.
 * Utilise l'adaptateur REST par défaut.
 */
import { getModel as restGetModel, query as restQuery } from "./rest-adapter";

export const powerbiIntelligence: PowerBIIntelligence = {
  getModel: restGetModel,
  query: restQuery,
};
