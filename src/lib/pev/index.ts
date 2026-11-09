/**
 * PEV Semantic Layer — barrel export.
 *
 * Couche métier pour le Programme Élargi de Vaccination (PEV) RDC.
 * Fournit les définitions d'indicateurs, seuils, et recherche en langage naturel.
 *
 * Utilisé par :
 *   - L'agent IA (compréhension des questions, interprétation des résultats)
 *   - Le DAX Gateway (validation des requêtes)
 *   - Le system prompt (contexte métier)
 */

export {
  PEV_INDICATORS,
  PEV_INDICATOR_BY_CODE,
  PEV_INDICATOR_BY_DHIS2_ID,
  type PEVIndicatorDefinition,
  type PEVDomain,
  type PEVUnit,
  type PEVThresholds,
} from "./indicators";

export {
  evaluateThreshold,
  isSuspectValue,
  thresholdStatus,
  DOMAIN_DEFAULT_THRESHOLDS,
  PEV_THRESHOLDS,
  type ThresholdLevel,
  type ThresholdEvaluation,
  type ThresholdPair,
  type ThresholdStatus,
} from "./thresholds";

export {
  findIndicator,
  findIndicators,
  getIndicatorsByDomain,
  getIndicatorsByAntigen,
  getAvailableAntigens,
  type SearchResult,
} from "./aliases";
