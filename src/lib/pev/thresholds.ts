/**
 * PEV Semantic Layer — Thresholds.
 *
 * Source unique des seuils OMS/PEV : `thresholds.json`, lu aussi par les
 * tests du backend (agent IA, `backend/app/tools/semantic_layer.py`) pour
 * garantir que le tableau de bord, les rapports et l'agent classent une même
 * valeur de la même façon.
 *
 * Deux bornes, trois bandes :
 *   - plus c'est haut, mieux c'est (couverture) :
 *       value >= target → cible, value >= warning → alerte, sinon critique
 *   - plus c'est bas, mieux c'est (abandon, perte, rupture) :
 *       value <= target → cible, value <= warning → alerte, sinon critique
 *
 * Couverture : cible 90 %, alerte sous 90 %, critique sous 80 % (OMS IA2030 :
 * ≥ 90 % au niveau national, ≥ 80 % dans chaque district).
 */

import type { PEVIndicatorDefinition, PEVDomain, PEVThresholds } from "./indicators";
import THRESHOLDS from "./thresholds.json";

export type ThresholdLevel = "critical" | "warning" | "target" | "unknown";
export type ThresholdStatus = "good" | "warning" | "critical";

export interface ThresholdPair {
  warning: number;
  target: number;
}

const { wastage_by_antigen: WASTAGE_BY_ANTIGEN_JSON, ...PAIRS } = THRESHOLDS;

export const PEV_THRESHOLDS: Record<keyof typeof PAIRS, ThresholdPair> = PAIRS;

/**
 * Wastage rate bounds per SIGL vaccine data element, from the WHO indicative
 * routine wastage rates by presentation (2002): `warning` = indicative
 * maximum (1 dose 5 %, 2–5 doses 10 %, 10–20 doses reusable after opening
 * 25 %, 10 doses discarded after the session 40 %, 20 doses discarded 50 %);
 * `target` = about half of it (programme goal, to be validated by the PEV).
 */
export const WASTAGE_BY_ANTIGEN: Record<string, ThresholdPair> = WASTAGE_BY_ANTIGEN_JSON;

/** Three-band status of a value (shared by every page, report and map). */
export function thresholdStatus(value: number, t: ThresholdPair, higherIsBetter = true): ThresholdStatus {
  if (higherIsBetter) {
    if (value >= t.target) return "good";
    if (value >= t.warning) return "warning";
    return "critical";
  }
  if (value <= t.target) return "good";
  if (value <= t.warning) return "warning";
  return "critical";
}

/**
 * Values that cannot be true and must not be read as a performance: a
 * coverage above 100 % (target population underestimated, out-of-area
 * children) or a negative dropout (more 3rd than 1st doses reported).
 */
export function isSuspectValue(value: number, kind: "coverage" | "dropout"): boolean {
  return kind === "coverage" ? value > 100 : value < 0;
}

export interface ThresholdEvaluation {
  level: ThresholdLevel;
  label: string;
  color: string;
  message: string;
}

const LEVEL_OF: Record<ThresholdStatus, ThresholdLevel> = { good: "target", warning: "warning", critical: "critical" };

/** Évalue une valeur par rapport aux seuils d'un indicateur. */
export function evaluateThreshold(
  indicator: PEVIndicatorDefinition,
  value: number,
): ThresholdEvaluation {
  const t: PEVThresholds | undefined = indicator.thresholds;
  if (t?.warning === undefined || t.target === undefined) {
    return {
      level: "unknown",
      label: "Non évalué",
      color: "gray",
      message: "Aucun seuil défini pour cet indicateur.",
    };
  }

  const inverted = indicator.domain === "dropout" || indicator.domain === "wastage";
  const level = LEVEL_OF[thresholdStatus(value, { warning: t.warning, target: t.target }, !inverted)];

  if (level === "critical") {
    return {
      level,
      label: "Critique",
      color: "red",
      message: inverted
        ? `${value}% dépasse le seuil critique de ${t.warning}%. Action urgente requise.`
        : `${value}% est sous le seuil critique de ${t.warning}%. Couverture insuffisante.`,
    };
  }
  if (level === "warning") {
    return {
      level,
      label: "Alerte",
      color: "orange",
      message: inverted
        ? `${value}% dépasse la cible de ${t.target}%. Surveillance renforcée recommandée.`
        : `${value}% est sous la cible de ${t.target}%. Amélioration nécessaire.`,
    };
  }
  return {
    level,
    label: "Cible atteinte",
    color: "green",
    message: inverted
      ? `${value}% est sous le seuil cible de ${t.target}%. Performance satisfaisante.`
      : `${value}% atteint ou dépasse la cible de ${t.target}%. Performance satisfaisante.`,
  };
}

/**
 * Seuils par domaine PEV (valeurs par défaut si non définis sur l'indicateur).
 */
export const DOMAIN_DEFAULT_THRESHOLDS: Record<PEVDomain, ThresholdPair | undefined> = {
  coverage: PEV_THRESHOLDS.coverage,
  dropout: PEV_THRESHOLDS.dropout,
  wastage: PEV_THRESHOLDS.wastage,
  stock: undefined,
  cold_chain: PEV_THRESHOLDS.cold_chain,
  data_quality: PEV_THRESHOLDS.data_quality,
  supervision: PEV_THRESHOLDS.supervision,
  surveillance: PEV_THRESHOLDS.surveillance,
};
