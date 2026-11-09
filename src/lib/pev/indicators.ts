/**
 * PEV Semantic Layer — Indicator definitions.
 *
 * Catalogue structuré des indicateurs PEV (Programme Élargi de Vaccination)
 * pour la RDC. Chaque indicateur a une définition métier, des seuils, des
 * alias, et un mapping vers le DHIS2 UID correspondant.
 *
 * Cette couche est utilisée par l'agent IA pour :
 *   - comprendre les questions en langage naturel
 *   - valider les requêtes DAX
 *   - fournir du contexte métier (définitions, seuils, interprétation)
 *
 * Source : livrables/Version 3 analyse plateforme PEV OMS amb.xlsx
 */

import PEV_THRESHOLDS from "./thresholds.json";

export type PEVDomain =
  | "coverage"
  | "dropout"
  | "wastage"
  | "stock"
  | "cold_chain"
  | "data_quality"
  | "supervision"
  | "surveillance";

export type PEVUnit = "percent" | "count";

/**
 * Deux bornes, trois bandes : cible atteinte (vert), entre `warning` et
 * `target` (orange), au-delà de `warning` (rouge, critique).
 */
export interface PEVThresholds {
  /** Seuil d'alerte : au-delà, la valeur est critique (rouge) */
  warning?: number;
  /** Seuil cible (vert) */
  target?: number;
}

const COVERAGE = PEV_THRESHOLDS.coverage;
const DROPOUT = PEV_THRESHOLDS.dropout;

export interface PEVIndicatorDefinition {
  /** Code interne stable (ex: "PENTA3_COVERAGE") */
  code: string;
  /** Label affichable (ex: "Couverture Penta3") */
  label: string;
  /** Définition opérationnelle (pour l'IA) */
  definition: string;
  /** Domaine PEV */
  domain: PEVDomain;
  /** Unité de mesure */
  unit: PEVUnit;
  /** Antigène (BCG, Penta, VAR, VAP, MR, POLIO, etc.) ou null */
  antigen: string | null;
  /** Dose (1, 2, 3, BCG, VAP4, 1-3, etc.) ou null */
  dose: string | null;
  /** Dimensions recommandées pour l'analyse */
  dimensions: string[];
  /** Seuils OMS/PEV */
  thresholds?: PEVThresholds;
  /** Alias/synonymes pour la recherche en langage naturel */
  aliases: string[];
  /** UID DHIS2 correspondant (si disponible) */
  dhis2Id?: string;
  /** Visualisation recommandée */
  recommendedVisual?: "kpi" | "line" | "bar" | "map" | "table";
  /** Règle d'interprétation (pour l'IA) */
  interpretationRule?: string;
}

/**
 * Catalogue des indicateurs PEV RDC.
 * Les UIDs DHIS2 correspondent à ceux seedés dans dim_indicators (migration 015).
 */
export const PEV_INDICATORS: PEVIndicatorDefinition[] = [
  // ─── Couverture vaccinale ──────────────────────────────────
  {
    code: "PENTA1_COVERAGE",
    label: "Couverture Penta1",
    definition:
      "Pourcentage d'enfants ayant reçu la 1ère dose de vaccin pentavalent (DTC-HepB-Hib) sur la période donnée.",
    domain: "coverage",
    unit: "percent",
    antigen: "Penta",
    dose: "1",
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: COVERAGE,
    aliases: ["Penta1", "Penta 1", "pentavalent 1", "DTC-HepB-Hib1", "P1"],
    dhis2Id: "k26tJ22Ncpd",
    recommendedVisual: "kpi",
    interpretationRule:
      "Une couverture Penta1 ≥ 90% indique un bon démarrage de la vaccination. < 80% est critique (seuil OMS IA2030 par district).",
  },
  {
    code: "PENTA3_COVERAGE",
    label: "Couverture Penta3",
    definition:
      "Pourcentage d'enfants ayant reçu la 3ème dose de vaccin pentavalent (DTC-HepB-Hib). Indicateur clé de couverture vaccinale complète.",
    domain: "coverage",
    unit: "percent",
    antigen: "Penta",
    dose: "3",
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: COVERAGE,
    aliases: ["Penta3", "Penta 3", "pentavalent 3", "DTC-HepB-Hib3", "P3", "couverture pentavalent"],
    dhis2Id: "v9b9aYsA5PM",
    recommendedVisual: "kpi",
    interpretationRule:
      "Indicateur de référence OMS. ≥ 90% = cible nationale. 80-90% = alerte. < 80% = critique (seuil OMS IA2030 par district). > 100% = donnée suspecte (dénominateur).",
  },
  {
    code: "BCG_COVERAGE",
    label: "Couverture BCG",
    definition:
      "Pourcentage de nouveau-nés ayant reçu le vaccin BCG (tuberculose) à la naissance ou peu après.",
    domain: "coverage",
    unit: "percent",
    antigen: "BCG",
    dose: "BCG",
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: COVERAGE,
    aliases: ["BCG", "tuberculose", "vaccin BCG"],
    dhis2Id: "cWJXYKCXrLx",
    recommendedVisual: "kpi",
    interpretationRule:
      "Le BCG est administré à la naissance. Une couverture < 80% indique un problème d'accès aux services de maternité.",
  },
  {
    code: "VAP4_COVERAGE",
    label: "Couverture VAP4",
    definition:
      "Pourcentage d'enfants de 12-23 mois ayant reçu la 4ème dose de vaccin antipaludique (VAP).",
    domain: "coverage",
    unit: "percent",
    antigen: "VAP",
    dose: "4",
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: COVERAGE,
    aliases: ["VAP4", "VAP 4", "antipaludique 4", "paludisme 4", "vaccin antipaludique"],
    dhis2Id: "tNZxs1kE6fy",
    recommendedVisual: "kpi",
    interpretationRule:
      "Le VAP (vaccin antipaludique) est introduit progressivement : une couverture nulle ou très faible signale d'abord une province non encore couverte par l'introduction, pas une contre-performance.",
  },
  {
    code: "FULLY_VACCINATED",
    label: "Enfants complètement vaccinés",
    definition:
      "Pourcentage d'enfants de 12-23 mois ayant reçu toutes les vaccinations recommandées (BCG, Penta1-3, VPO1-3, VPI, VAR, VAA).",
    domain: "coverage",
    unit: "percent",
    antigen: null,
    dose: null,
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: COVERAGE,
    aliases: ["complètement vaccinés", "enfants complètement vaccinés", "vaccination complète", "CV"],
    dhis2Id: "nvPe9ZZiEaH",
    recommendedVisual: "kpi",
    interpretationRule:
      "Indicateur composite de couverture complète. < 80% = critique. L'écart avec Penta3 indique les antigènes sous-performants.",
  },
  {
    code: "UNDER_VACCINATED",
    label: "Enfants sous-vaccinés",
    definition:
      "Nombre d'enfants qui n'ont pas reçu toutes les doses de vaccin recommandées pour leur âge.",
    domain: "coverage",
    unit: "count",
    antigen: null,
    dose: null,
    dimensions: ["province", "zone_sante", "period", "year"],
    aliases: ["sous-vaccinés", "enfants sous vaccinés", "SV", "under-vaccinated"],
    dhis2Id: "RMHgIqfBG7N",
    recommendedVisual: "bar",
    interpretationRule:
      "Comptage absolu. À croiser avec la population cible pour évaluer l'ampleur du problème.",
  },

  // ─── Dropout / Abandons ─────────────────────────────────────
  {
    code: "PENTA1_PENTA3_DROPOUT",
    label: "Abandon Penta1-Penta3",
    definition:
      "Pourcentage d'enfants qui ont reçu Penta1 mais n'ont pas reçu Penta3. Mesure la perte de suivi entre la 1ère et la 3ème dose.",
    domain: "dropout",
    unit: "percent",
    antigen: "Penta",
    dose: "1-3",
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: DROPOUT,
    aliases: ["abandon Penta", "dropout Penta", "Penta1-Penta3", "abandon pentavalent", "taux d'abandon"],
    dhis2Id: "MULXtL8iom8",
    recommendedVisual: "bar",
    interpretationRule:
      "Un dropout > 10% indique un problème de rétention. Les causes possibles : accès géographique, opportunités manquées, sensibilisation insuffisante.",
  },
  {
    code: "MR1_MR2_DROPOUT",
    label: "Abandon MR1-MR2",
    definition:
      "Pourcentage d'enfants qui ont reçu MR1 mais n'ont pas reçu MR2 (2ème dose rougeole-oreillons).",
    domain: "dropout",
    unit: "percent",
    antigen: "MR",
    dose: "1-2",
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: DROPOUT,
    aliases: ["abandon MR", "dropout MR", "MR1-MR2", "abandon rougeole"],
    dhis2Id: "FhQ8Hd5rCHj",
    recommendedVisual: "bar",
    interpretationRule:
      "Le dropout MR est critique car la 2ème dose est essentielle pour l'immunité collective contre la rougeole.",
  },

  // ─── Pertes / Wastage ───────────────────────────────────────
  {
    code: "VACCINE_WASTAGE_RATE",
    label: "Taux de perte des vaccins",
    definition:
      "Pourcentage de doses de vaccin perdues (flacons ouverts non utilisés, péremption, chaîne du froid).",
    domain: "wastage",
    unit: "percent",
    antigen: null,
    dose: null,
    dimensions: ["province", "zone_sante", "period", "year"],
    thresholds: PEV_THRESHOLDS.wastage,
    aliases: ["perte vaccins", "taux de perte", "wastage", "pertes vaccinales", "gaspi vaccin"],
    dhis2Id: "YM7Tmn01ieL",
    recommendedVisual: "line",
    interpretationRule:
      "Un taux de perte > 15% indique un problème de gestion des stocks ou de chaîne du froid. À croiser avec les excursions de température.",
  },

  // ─── Doses administrées ─────────────────────────────────────
  {
    code: "BCG_DOSES",
    label: "BCG - doses administrées",
    definition: "Nombre de doses de vaccin BCG administrées sur la période.",
    domain: "coverage",
    unit: "count",
    antigen: "BCG",
    dose: null,
    dimensions: ["province", "zone_sante", "period", "year"],
    aliases: ["doses BCG", "BCG administrées", "nombre BCG"],
    dhis2Id: "W25tOXS0rxS",
    recommendedVisual: "bar",
  },
  {
    code: "PENTA1_DOSES",
    label: "Penta1 - doses administrées",
    definition: "Nombre de doses de Penta1 administrées sur la période.",
    domain: "coverage",
    unit: "count",
    antigen: "Penta",
    dose: "1",
    dimensions: ["province", "zone_sante", "period", "year"],
    aliases: ["doses Penta1", "Penta1 administrées"],
    dhis2Id: "uNdFg1eymsa",
    recommendedVisual: "bar",
  },
  {
    code: "PENTA3_DOSES",
    label: "Penta3 - doses administrées",
    definition: "Nombre de doses de Penta3 administrées sur la période.",
    domain: "coverage",
    unit: "count",
    antigen: "Penta",
    dose: "3",
    dimensions: ["province", "zone_sante", "period", "year"],
    aliases: ["doses Penta3", "Penta3 administrées"],
    dhis2Id: "WWxqaHSeiwd",
    recommendedVisual: "bar",
  },
  {
    code: "CAC_BCG_RECOVERED",
    label: "Enfants récupérés par les CAC-BCG",
    definition:
      "Nombre d'enfants récupérés par les centres d'approche communautaire pour le BCG.",
    domain: "coverage",
    unit: "count",
    antigen: "BCG",
    dose: null,
    dimensions: ["province", "zone_sante", "period", "year"],
    aliases: ["CAC BCG", "récupérés BCG", "approche communautaire"],
    dhis2Id: "hF8wVIOJrT8",
    recommendedVisual: "bar",
  },
];

/**
 * Index par code pour accès direct.
 */
export const PEV_INDICATOR_BY_CODE: Record<string, PEVIndicatorDefinition> =
  Object.fromEntries(PEV_INDICATORS.map((i) => [i.code, i]));

/**
 * Index par UID DHIS2 pour jointure avec dim_indicators.
 */
export const PEV_INDICATOR_BY_DHIS2_ID: Record<string, PEVIndicatorDefinition> =
  Object.fromEntries(
    PEV_INDICATORS.filter((i) => i.dhis2Id).map((i) => [i.dhis2Id!, i]),
  );
