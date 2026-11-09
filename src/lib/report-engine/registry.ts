/**
 * ReportTypeRegistry — catalogue of SIVAX / SMT report types.
 *
 * Every data requirement maps to a curated indicator of the SIVAX
 * warehouse (ETL snapshot synced from DHIS2 / SIGL ESS 2025), mirroring
 * the indicator sets of the analytics pages. No free-text metadata
 * search against live SNIS: the generation path must stay deterministic
 * and never mislabel a metric. Requirements without a warehouse source
 * are declared with `unavailableReason` and reported as such.
 *
 * Thresholds follow the PEV semantic layer (src/lib/pev/thresholds.json).
 */

import { PEV_THRESHOLDS, thresholdStatus, type ThresholdPair } from "@/lib/pev/thresholds";

export interface RatioDefinition {
  /** Numerator indicator ID. */
  num: string;
  /** Denominator indicator ID. */
  den: string;
  /** Multiplier applied to num/den (100 for percentages). */
  factor?: number;
}

export interface ReportDataRequirement {
  key: string;
  label: string;
  /** Warehouse indicator ID (dim_indicators / fact_indicator_values). */
  indicatorId?: string;
  /** Derived metric computed from two warehouse indicators. */
  ratio?: RatioDefinition;
  unit?: "count" | "percent";
  /** True when a lower value is better (ruptures, abandon, pertes). */
  betterLower?: boolean;
  /** PEV-style thresholds for status classification. */
  threshold?: ThresholdPair;
  /** Why the data cannot be provided (requirement kept for transparency). */
  unavailableReason?: string;
}

export interface ReportTypeDefinition {
  id: string;
  name: string;
  description: string;
  requiredData: ReportDataRequirement[];
  defaultSections: string[];
  availableCharts: string[];
  availableFilters: string[];
  supportedScopes: string[];
  supportedExports: string[];
}

// ─── Warehouse building blocks (same IDs as the dashboard pages) ──────
const PENTA = "uAWIVDnGPGH";
const BCG_DE = "l1bhrYUPsde";
const VAR_DE = "Hjlw6DpooIo";
const SDU = "kOWsLrtvrhn";
const CMM = "t5L9ODSuYOG";
const MAX = "Lpu56KTyGvy";
const ADMIN = "dxDQKDcTn6Z";
const LOSS = "J8mw9rFkY4v";
const SIGL_RR = "DxDuYrrZSa7.REPORTING_RATE";
const STOCKOUT_ANY = "STOCKOUT_FOSA.ANY";
/** Facilities managing at least one vaccine (CMM or stock-out reported): denominator of the stock-out rate. */
const STOCKOUT_BASE_ANY = "STOCKOUT_BASE.ANY";

const COVERAGE_THRESHOLD = PEV_THRESHOLDS.coverage;
const DROPOUT_THRESHOLD = PEV_THRESHOLDS.dropout;
const WASTAGE_THRESHOLD = PEV_THRESHOLDS.wastage;
const STOCKOUT_THRESHOLD = PEV_THRESHOLDS.stockout;
const DQ_THRESHOLD = PEV_THRESHOLDS.data_quality;
const COLDCHAIN_THRESHOLD = PEV_THRESHOLDS.cold_chain;

const R = (r: ReportDataRequirement) => r;

// Shared requirement presets
const PCT_FOSA_RUPTURE = R({
  key: "pct_fosa_rupture",
  label: "% FOSA en rupture d'au moins un vaccin",
  ratio: { num: STOCKOUT_ANY, den: STOCKOUT_BASE_ANY, factor: 100 },
  unit: "percent",
  betterLower: true,
  threshold: STOCKOUT_THRESHOLD,
});
const FOSA_RUPTURE_ANY = R({
  key: "fosa_rupture_any",
  label: "FOSA en rupture d'au moins un vaccin",
  indicatorId: STOCKOUT_ANY,
  unit: "count",
  betterLower: true,
});
const MOS_PENTA = R({
  key: "mos_penta",
  label: "Mois de stock disponibles — Penta (SDU/CMM)",
  ratio: { num: `${PENTA}.${SDU}`, den: `${PENTA}.${CMM}` },
  unit: "count",
});
const SDU_PENTA = R({ key: "sdu_penta", label: "Stock disponible utilisable — Penta (doses)", indicatorId: `${PENTA}.${SDU}`, unit: "count" });
const CMM_PENTA = R({ key: "cmm_penta", label: "Consommation moyenne mensuelle — Penta (doses)", indicatorId: `${PENTA}.${CMM}`, unit: "count" });
const COMPLETUDE_SIGL = R({ key: "completude_sigl", label: "Complétude des rapports SIGL ESS", indicatorId: SIGL_RR, unit: "percent", threshold: DQ_THRESHOLD });
const FRIGOS = R({ key: "frigos", label: "Réfrigérateurs déclarés (BCZ)", indicatorId: "gMJT9WyszD4", unit: "count" });
const CONGELATEURS = R({ key: "congelateurs", label: "Congélateurs déclarés (BCZ)", indicatorId: "aVGXisHECwk", unit: "count" });
const ACCUMULATEURS = R({ key: "accumulateurs", label: "% CS avec accumulateurs de froid (≥ 4)", indicatorId: "KeVd89m64zV", unit: "percent", threshold: COLDCHAIN_THRESHOLD });

const DEFAULT_SECTIONS = [
  "executive_summary",
  "context",
  "kpis",
  "trend_analysis",
  "geographic_performance",
  "risks",
  "recommendations",
  "methodology",
  "sources",
];

const DEFAULT_FILTERS = ["period", "geographicScope", "orgUnitLevel"];
const DEFAULT_SCOPES = ["national", "province", "zone"];
const DEFAULT_EXPORTS = ["pdf", "html", "docx", "csv"];

function reportType(
  id: string,
  name: string,
  description: string,
  requiredData: ReportDataRequirement[],
  overrides: Partial<ReportTypeDefinition> = {},
): ReportTypeDefinition {
  return {
    id,
    name,
    description,
    requiredData,
    defaultSections: DEFAULT_SECTIONS,
    availableCharts: ["trend", "geographic_comparison", "distribution"],
    availableFilters: DEFAULT_FILTERS,
    supportedScopes: DEFAULT_SCOPES,
    supportedExports: DEFAULT_EXPORTS,
    ...overrides,
  };
}

export const REPORT_TYPE_REGISTRY: Record<string, ReportTypeDefinition> = {
  STOCK_STATUS: reportType(
    "STOCK_STATUS",
    "Rapport sur l'état des stocks",
    "État des stocks de vaccins (SIGL ESS 2025) : ruptures en FOSA, mois de stock disponibles, niveaux de stock. Peut être généré en fin de mois pour transmission à Thrive360 / Gavi.",
    [
      PCT_FOSA_RUPTURE,
      FOSA_RUPTURE_ANY,
      R({ key: "rupture_penta", label: "FOSA en rupture de Penta", indicatorId: `STOCKOUT_FOSA.${PENTA}`, unit: "count", betterLower: true }),
      MOS_PENTA,
      SDU_PENTA,
      COMPLETUDE_SIGL,
    ],
  ),
  STOCK_MANAGEMENT_SUMMARY: reportType(
    "STOCK_MANAGEMENT_SUMMARY",
    "Rapport synthèse de la gestion des stocks",
    "Synthèse mensuelle de la gestion des stocks (SIGL ESS 2025) : disponibilité, consommation, utilisations et pertes. Peut être généré en fin de mois pour transmission à Thrive360 / Gavi.",
    [
      SDU_PENTA,
      CMM_PENTA,
      R({ key: "admin_penta", label: "Quantité administrée — Penta (doses)", indicatorId: `${PENTA}.${ADMIN}`, unit: "count" }),
      R({ key: "pertes_penta", label: "Pertes — Penta (doses)", indicatorId: `${PENTA}.${LOSS}`, unit: "count", betterLower: true }),
      R({ key: "taux_perte", label: "Taux de perte des vaccins", indicatorId: "YM7Tmn01ieL", unit: "percent", betterLower: true, threshold: WASTAGE_THRESHOLD }),
      COMPLETUDE_SIGL,
    ],
  ),
  ARRIVALS: reportType(
    "ARRIVALS",
    "Rapport d'arrivées",
    "Arrivées de vaccins et intrants sur la période. Les réceptions ne sont pas encore synchronisées dans l'entrepôt SIVAX ; les niveaux de stock SIGL servent de contexte.",
    [
      R({ key: "arrivals", label: "Réceptions / arrivées de vaccins", unavailableReason: "Les réceptions ne sont pas rapportées dans les jeux de données synchronisés (SIGL ESS 2025)." }),
      SDU_PENTA,
      R({ key: "max_penta", label: "Stock maximum — Penta (doses)", indicatorId: `${PENTA}.${MAX}`, unit: "count" }),
      COMPLETUDE_SIGL,
    ],
  ),
  ISSUES: reportType(
    "ISSUES",
    "Rapport des sorties",
    "Sorties de stock (SIGL ESS 2025) : quantités administrées et pertes par antigène.",
    [
      R({ key: "admin_penta", label: "Quantité administrée — Penta (doses)", indicatorId: `${PENTA}.${ADMIN}`, unit: "count" }),
      R({ key: "admin_var", label: "Quantité administrée — VAR (doses)", indicatorId: `${VAR_DE}.${ADMIN}`, unit: "count" }),
      R({ key: "pertes_penta", label: "Pertes — Penta (doses)", indicatorId: `${PENTA}.${LOSS}`, unit: "count", betterLower: true }),
      SDU_PENTA,
      COMPLETUDE_SIGL,
    ],
  ),
  PHYSICAL_COUNT: reportType(
    "PHYSICAL_COUNT",
    "Rapport de comptage physique et d'ajustements",
    "Comptages physiques et ajustements de stock. Les ajustements ne sont pas synchronisés ; les niveaux et pertes SIGL servent de contexte.",
    [
      R({ key: "adjustments", label: "Ajustements de stock", unavailableReason: "Les ajustements d'inventaire ne sont pas rapportés dans les jeux de données synchronisés." }),
      SDU_PENTA,
      R({ key: "pertes_penta", label: "Pertes — Penta (doses)", indicatorId: `${PENTA}.${LOSS}`, unit: "count", betterLower: true }),
      COMPLETUDE_SIGL,
    ],
  ),
  STORAGE_CAPACITY: reportType(
    "STORAGE_CAPACITY",
    "Rapport sur l'état de capacité de stockage",
    "Capacité de stockage et chaîne du froid : équipements déclarés et taux de remplissage par rapport au stock maximum.",
    [
      FRIGOS,
      CONGELATEURS,
      ACCUMULATEURS,
      R({ key: "remplissage_penta", label: "Taux de remplissage — Penta (SDU/stock max)", ratio: { num: `${PENTA}.${SDU}`, den: `${PENTA}.${MAX}`, factor: 100 }, unit: "percent" }),
    ],
  ),
  PERFORMANCE: reportType(
    "PERFORMANCE",
    "Rapport de performance",
    "Performance vaccinale : couverture par antigène, abandon, enfants complètement et sous-vaccinés, comparaison géographique.",
    [
      R({ key: "penta3", label: "Couverture Penta3", indicatorId: "v9b9aYsA5PM", unit: "percent", threshold: COVERAGE_THRESHOLD }),
      R({ key: "penta1", label: "Couverture Penta1", indicatorId: "k26tJ22Ncpd", unit: "percent", threshold: COVERAGE_THRESHOLD }),
      R({ key: "bcg", label: "Couverture BCG", indicatorId: "cWJXYKCXrLx", unit: "percent", threshold: COVERAGE_THRESHOLD }),
      R({ key: "abandon", label: "Abandon Penta1-Penta3", indicatorId: "MULXtL8iom8", unit: "percent", betterLower: true, threshold: DROPOUT_THRESHOLD }),
      R({ key: "completement_vaccines", label: "Enfants complètement vaccinés", indicatorId: "nvPe9ZZiEaH", unit: "percent", threshold: COVERAGE_THRESHOLD }),
      R({ key: "sous_vaccines", label: "Enfants sous-vaccinés", indicatorId: "RMHgIqfBG7N", unit: "count", betterLower: true }),
    ],
  ),
  SUPPLY_ADEQUACY: reportType(
    "SUPPLY_ADEQUACY",
    "Rapport sur l'adéquation de l'approvisionnement",
    "Adéquation entre approvisionnement et besoins : mois de stock disponibles, consommation moyenne et couverture atteinte.",
    [
      MOS_PENTA,
      SDU_PENTA,
      CMM_PENTA,
      R({ key: "penta3", label: "Couverture Penta3", indicatorId: "v9b9aYsA5PM", unit: "percent", threshold: COVERAGE_THRESHOLD }),
      PCT_FOSA_RUPTURE,
    ],
  ),
  COLD_CHAIN_INVENTORY: reportType(
    "COLD_CHAIN_INVENTORY",
    "Rapport d'inventaire des équipements de la chaîne du froid",
    "Inventaire des équipements de la chaîne du froid déclarés par les BCZ : réfrigérateurs, congélateurs, accumulateurs de froid.",
    [
      FRIGOS,
      CONGELATEURS,
      ACCUMULATEURS,
      R({ key: "fonctionnement", label: "État de fonctionnement des équipements", unavailableReason: "L'état de fonctionnement détaillé (PQS, pannes) n'est pas rapporté dans les jeux de données synchronisés." }),
    ],
  ),
};

export const DEFAULT_REPORT_TYPE = "PERFORMANCE";

export function getReportType(id: string | undefined): ReportTypeDefinition {
  return REPORT_TYPE_REGISTRY[id ?? ""] ?? REPORT_TYPE_REGISTRY[DEFAULT_REPORT_TYPE];
}

export const REPORT_TYPE_OPTIONS = Object.values(REPORT_TYPE_REGISTRY).map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
}));

/** Every warehouse indicator ID a requirement list depends on (direct + ratio parts). */
export function requirementIndicatorIds(requirements: ReportDataRequirement[]): string[] {
  const ids = new Set<string>();
  for (const req of requirements) {
    if (req.indicatorId) ids.add(req.indicatorId);
    if (req.ratio) {
      ids.add(req.ratio.num);
      ids.add(req.ratio.den);
    }
  }
  return [...ids];
}

/** PEV-style threshold evaluation (shared with analysis). */
export function evaluateRequirementThreshold(
  req: ReportDataRequirement,
  value: number,
): "success" | "warning" | "danger" | "neutral" {
  const t = req.threshold;
  if (!t) return "neutral";
  const status = thresholdStatus(value, t, !req.betterLower);
  return status === "good" ? "success" : status === "warning" ? "warning" : "danger";
}
