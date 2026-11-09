import { dhis2Get, fetchAnalyticsAdvanced, fetchOrgUnits, presetToPeriod } from "@/lib/dhis2";
import { expandPeriods } from "@/lib/dhis2-analytics";
import type {
  Dhis2AnalysisRequest,
  Dhis2AnalysisResult,
  Dhis2AnalyticsResult,
  Dhis2AnalysisVisualization,
  Dhis2MetricCandidate,
  Dhis2PeriodPreset,
} from "@/types";

interface Dhis2MetricMetadata {
  id: string;
  name: string;
  shortName?: string;
  code?: string;
  description?: string;
}

/** Upper bound on metadata rows fetched per search term. */
const SEARCH_PAGE_SIZE = 50;

const STOP_WORDS = new Set([
  "affiche",
  "analyse",
  "avec",
  "dans",
  "dernier",
  "derniers",
  "durant",
  "entre",
  "faire",
  "moins",
  "montre",
  "pour",
  "repartition",
  "sante",
  "selon",
  "trois",
  "zone",
  "zones",
]);

/**
 * Common French health synonyms to expand search terms.
 * Maps colloquial/abbreviated terms to their full DHIS2 indicator names.
 */
const SYNONYM_MAP: Record<string, string[]> = {
  "paludisme": ["malaria", "paludisme"],
  "malaria": ["malaria", "paludisme"],
  "vaccination": ["vaccination", "vaccine", "vaccin"],
  "vaccin": ["vaccination", "vaccine", "vaccin"],
  "bcg": ["bcg"],
  "dtc": ["dtc", "diphtherie", "tetanos", "coqueluche"],
  "rougeole": ["rougeole", "measles", "measle"],
  "polio": ["polio", "poliomyelite", "poliomyelitis"],
  "fièvre": ["fievre", "fever", "fièvre"],
  "fievre": ["fievre", "fever", "fièvre"],
  "jaune": ["jaune", "yellow", "fièvre jaune"],
  "accouchement": ["accouchement", "delivery", "naissance", "delivery assisted"],
  "cpn": ["cpn", "consultation prenatale", "anc", "prenatal"],
  "prénatale": ["prenatale", "prenatal", "cpn", "consultation prenatale"],
  "prenatale": ["prenatale", "prenatal", "cpn", "consultation prenatale"],
  "nutrition": ["nutrition", "malnutrition", "nutritional"],
  "malnutrition": ["malnutrition", "nutrition", "nutritional"],
  "cas": ["cas", "case", "cases"],
  "confirmés": ["confirmes", "confirmed", "confirmé", "confirmes"],
  "confirmes": ["confirmes", "confirmed", "confirmé", "confirmés"],
  "décès": ["deces", "death", "deaths", "décès"],
  "deces": ["deces", "death", "deaths", "décès"],
  "hospitalisation": ["hospitalisation", "hospital", "admission"],
  "consultation": ["consultation", "consult", "visit"],
  "tuberculose": ["tuberculose", "tuberculosis", "tb"],
  "tb": ["tuberculose", "tuberculosis", "tb"],
  "vihsida": ["vih", "sida", "hiv", "aids"],
  "vih": ["vih", "sida", "hiv", "aids"],
  "sida": ["vih", "sida", "hiv", "aids"],
};

const VALID_PERIODS = new Set<Dhis2PeriodPreset>([
  "THIS_MONTH",
  "LAST_MONTH",
  "LAST_COMPLETE_MONTH",
  "THIS_YEAR",
  "LAST_YEAR",
  "LAST_12_MONTHS",
  "LAST_6_MONTHS",
  "LAST_3_MONTHS",
  "YEAR_OVER_YEAR",
]);

const VALID_VISUALIZATIONS = new Set<Dhis2AnalysisVisualization>([
  "auto",
  "kpi",
  "line",
  "bar",
  "pie",
  "table",
]);

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function searchTerms(value: string): string[] {
  const baseTerms = [...new Set(normalize(value).split(" "))]
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
    .slice(0, 6);

  // Expand with synonyms
  const expanded = new Set<string>();
  for (const term of baseTerms) {
    expanded.add(term);
    const synonyms = SYNONYM_MAP[term];
    if (synonyms) {
      synonyms.forEach((s) => expanded.add(s));
    }
  }

  return [...expanded].slice(0, 8);
}

async function searchCollection(
  collection: "indicators" | "dataElements",
  type: Dhis2MetricCandidate["type"],
  terms: string[],
): Promise<Dhis2MetricCandidate[]> {
  const responses = await Promise.all(
    terms.map(async (term) => {
      // Bounded instead of `paging=false`: a generic term can otherwise pull
      // thousands of metadata rows to pick the top 8 from.
      const path =
        `/api/${collection}.json?fields=id,name,shortName,code,description` +
        `&filter=name:ilike:${encodeURIComponent(term)}&pageSize=${SEARCH_PAGE_SIZE}`;
      try {
        const response = await dhis2Get<Record<string, Dhis2MetricMetadata[]>>(path, 0);
        return response[collection] ?? [];
      } catch {
        return [];
      }
    }),
  );

  const unique = new Map<string, Dhis2MetricMetadata>();
  responses.flat().forEach((item) => unique.set(item.id, item));

  return [...unique.values()].map((item) => {
    const haystack = normalize(`${item.name} ${item.shortName ?? ""} ${item.code ?? ""} ${item.description ?? ""}`);
    const matched = terms.filter((term) => haystack.includes(term)).length;
    return {
      id: item.id,
      name: item.name,
      type,
      code: item.code,
      description: item.description,
      score: matched / Math.max(terms.length, 1),
    };
  });
}

export async function searchDhis2Metrics(query: string): Promise<Dhis2MetricCandidate[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const [indicators, dataElements] = await Promise.all([
    searchCollection("indicators", "indicator", terms),
    searchCollection("dataElements", "dataElement", terms),
  ]);

  return [...indicators, ...dataElements]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "fr"))
    .slice(0, 8);
}

function inferVisualization(
  requested: Dhis2AnalysisVisualization,
  targetOrgUnitLevel: number | undefined,
  periodPreset: Dhis2PeriodPreset,
): Exclude<Dhis2AnalysisVisualization, "auto"> {
  if (requested !== "auto") return requested;
  if (targetOrgUnitLevel) return "bar";
  if (["LAST_3_MONTHS", "LAST_6_MONTHS", "LAST_12_MONTHS", "YEAR_OVER_YEAR"].includes(periodPreset)) {
    return "line";
  }
  return "kpi";
}

function periodsForPreset(preset: Dhis2PeriodPreset): string[] {
  if (preset === "LAST_COMPLETE_MONTH") return expandPeriods([preset]);
  if (preset !== "YEAR_OVER_YEAR") return [presetToPeriod(preset)];
  const year = new Date().getFullYear();
  return Array.from({ length: 12 }, (_, index) => `${year}${String(index + 1).padStart(2, "0")}`).concat(
    Array.from({ length: 12 }, (_, index) => `${year - 1}${String(index + 1).padStart(2, "0")}`),
  );
}

export function sanitizeDhis2AnalysisRequest(input: Partial<Dhis2AnalysisRequest>): Dhis2AnalysisRequest {
  const periodPreset = VALID_PERIODS.has(input.periodPreset as Dhis2PeriodPreset)
    ? (input.periodPreset as Dhis2PeriodPreset)
    : "LAST_3_MONTHS";
  const visualization = VALID_VISUALIZATIONS.has(input.visualization as Dhis2AnalysisVisualization)
    ? (input.visualization as Dhis2AnalysisVisualization)
    : "auto";
  const orgUnitLevel = Math.min(5, Math.max(1, Number(input.orgUnitLevel) || 1));
  const target = Number(input.targetOrgUnitLevel);

  const periods = Array.isArray(input.periods)
    ? input.periods
        .map((p) => String(p).trim())
        .filter((p) => /^\d{4}(\d{2})?$/.test(p))
        .slice(0, 24)
    : undefined;

  return {
    question: String(input.question ?? "").trim().slice(0, 500),
    metricQuery: String(input.metricQuery ?? input.question ?? "").trim().slice(0, 200),
    metricId: input.metricId ? String(input.metricId).trim() : undefined,
    periodPreset,
    periods: periods && periods.length > 0 ? periods : undefined,
    orgUnitId: String(input.orgUnitId ?? "ymGeqzoPhN3").trim() || "ymGeqzoPhN3",
    orgUnitLevel,
    targetOrgUnitLevel: Number.isFinite(target)
      ? Math.min(5, Math.max(orgUnitLevel, target))
      : undefined,
    visualization,
  };
}

/** Analytics payload shape shared by the live fetch and the agent handoff. */
export interface Dhis2AnalyticsPayload {
  headers: unknown[];
  metaData: { items: Record<string, { name: string }> };
  rows: string[][];
}

/**
 * Builds the final analysis result from an already-fetched analytics payload.
 *
 * Everything below this point is pure computation — scoring, explanation,
 * visualization choice. Splitting it out is what lets the agent's server-side
 * analysis be reused instead of replayed against DHIS2 (PERF-01).
 */

/**
 * Nettoie la réponse LLM en supprimant les graphiques ASCII, art texte,
 * et formules de politesse de fin. Garde uniquement le tableau markdown
 * et l'interprétation analytique.
 */
function cleanLlmInterpretation(text: string): string {
  if (!text) return text;

  const lines = text.split("\n");
  const cleanedLines: string[] = [];
  let inAsciiBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Lignes vides : les garder mais ne pas compter comme sortie de bloc ASCII
    if (!trimmed) {
      if (!inAsciiBlock) cleanedLines.push(line);
      continue;
    }

    // Caractères typiques des graphiques ASCII
    const asciiCharCount = (trimmed.match(/[|*+=#~]/g) ?? []).length;
    // Lignes faites uniquement de caractères de dessin (+, -, |, *, =, espaces)
    const isDrawLine = /^[|*+\-=#\s~]+$/.test(trimmed);
    // Lignes avec une majorité de caractères ASCII art
    const nonSpaceChars = trimmed.replace(/\s/g, "").length;
    const isAsciiHeavy = nonSpaceChars > 0 && asciiCharCount / nonSpaceChars >= 0.3;

    // Labels d'axes : "Mars   Juillet", "+-----------------"
    const isAxisLine = /^\+[-\s]+$/.test(trimmed);
    const isAxisLabel = inAsciiBlock && /^[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]{2,}\s*$/.test(trimmed);

    // Lignes comme "|  *" ou "|*" ou "| *" — graphique ASCII court
    const isPipeStar = /^\|[\s*]*$/.test(trimmed) || /^\*+\s*$/.test(trimmed);

    // Ne pas traiter les lignes de tableau markdown comme ASCII art
    const isMarkdownTableRow = trimmed.startsWith("|") && trimmed.endsWith("|");

    if ((isDrawLine || isAxisLine || isPipeStar || (isAsciiHeavy && trimmed.length <= 80) || isAxisLabel) && !isMarkdownTableRow) {
      inAsciiBlock = true;
      continue;
    }

    // Sortie du bloc ASCII
    if (inAsciiBlock) {
      inAsciiBlock = false;
      // Ajouter une ligne vide pour séparer proprement
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim() !== "") {
        cleanedLines.push("");
      }
    }

    // Supprimer "Graphique" / "Chart" / "Graph" seul sur une ligne
    if (/^(Graphique|Chart|Graph|Graphique en barre|Courbe)\s*:?\s*$/i.test(trimmed)) {
      continue;
    }

    // Supprimer les formules de politesse de fin
    if (/^(Si vous avez besoin|N['']hésitez pas|Let me know|Feel free|If you need|Don['']t hesitate|Voici comment|Cela vous permettra)/i.test(trimmed)) {
      // Skip this line and any following lines until the next empty line
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") {
        i = j;
        j++;
      }
      continue;
    }

    // Supprimer les instructions de création de graphique
    if (/^(Créez un tableau|Insérez un graphique|Utilisez les valeurs|Voici comment vous)/i.test(trimmed)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() !== "") {
        i = j;
        j++;
      }
      continue;
    }

    cleanedLines.push(line);
  }

  let cleaned = cleanedLines.join("\n");

  // Nettoyer les paragraphes vides consécutifs
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  // Trimmer
  return cleaned.trim();
}

export function assembleDhis2Analysis(
  request: Dhis2AnalysisRequest,
  metric: Dhis2MetricCandidate,
  candidates: Dhis2MetricCandidate[],
  analytics: Dhis2AnalyticsPayload,
  provenanceSource = "DHIS2 — SNIS RDC (temps réel)",
  // Interprétation rédigée par le modèle, apportée par main. Optionnelle : sans
  // elle, l'explication déterministe construite plus bas fait foi.
  options?: { llmInterpretation?: string },
): Dhis2AnalysisResult {
  const visualization = inferVisualization(
    request.visualization,
    request.targetOrgUnitLevel,
    request.periodPreset,
  );
  const generatedAt = new Date().toISOString();

  const values = analytics.rows.map((row) => Number(row[3])).filter(Number.isFinite);
  const orgUnitCount = new Set(analytics.rows.map((row) => row[2]).filter(Boolean)).size;
  const periodCount = new Set(analytics.rows.map((row) => row[1]).filter(Boolean)).size;
  const warnings: string[] = [];
  if (candidates[1] && candidates[1].score === metric.score) {
    warnings.push(`La métrique « ${metric.name} » a été sélectionnée automatiquement parmi plusieurs correspondances.`);
  }
  if (visualization === "pie" && orgUnitCount > 8) {
    warnings.push("Le nombre de catégories est élevé; un graphique en barres sera plus lisible qu'un camembert.");
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const fallbackExplanation = buildExplanation(metric.name, analytics, request, total, orgUnitCount, periodCount);

  return {
    id: crypto.randomUUID(),
    status: "ready",
    title: metric.name,
    interpretation: options?.llmInterpretation
      ? cleanLlmInterpretation(options.llmInterpretation)
      : `Analyse de « ${metric.name} » sur ${request.periodPreset.toLowerCase().replaceAll("_", " ")}.`,
    explanation: options?.llmInterpretation
      ? cleanLlmInterpretation(options.llmInterpretation)
      : fallbackExplanation,
    request,
    metric,
    candidates,
    visualization: visualization === "pie" && orgUnitCount > 8 ? "bar" : visualization,
    analytics,
    summary: {
      total,
      rowCount: analytics.rows.length,
      orgUnitCount,
      periodCount,
    },
    warnings,
    provenance: { source: provenanceSource, generatedAt, metricIds: [metric.id] },
  } as Dhis2AnalysisResult;
}

export async function runDhis2Analysis(
  input: Partial<Dhis2AnalysisRequest>,
  // Interprétation du modèle transmise par la route ; traversée telle quelle
  // jusqu'à assembleDhis2Analysis.
  options?: { llmInterpretation?: string },
): Promise<Dhis2AnalysisResult> {
  const request = sanitizeDhis2AnalysisRequest(input);
  const candidates = await searchDhis2Metrics(request.metricQuery || request.question);
  const visualization = inferVisualization(
    request.visualization,
    request.targetOrgUnitLevel,
    request.periodPreset,
  );
  const generatedAt = new Date().toISOString();
  const metric = candidates[0];

  if (!metric) {
    return {
      id: crypto.randomUUID(),
      status: "needs_clarification",
      title: "Précision nécessaire",
      interpretation: `Aucune métrique DHIS2 fiable n'a été trouvée pour « ${request.metricQuery} ».`,
      explanation: "Le système n'a pas trouvé d'indicateur correspondant à votre question. Essayez de préciser le nom de l'indicateur, l'antigène ou le programme sanitaire (ex: « cas de paludisme confirmés », « vaccination BCG », « accouchements assistés »).",
      request,
      candidates,
      visualization,
      warnings: ["Précisez l'indicateur, l'antigène ou le programme sanitaire à analyser."],
      provenance: { source: "DHIS2 — SNIS RDC", generatedAt, metricIds: [] },
    };
  }

  const pe = request.periods && request.periods.length > 0
    ? request.periods
    : periodsForPreset(request.periodPreset);

  // Analytics query and org-unit labels are independent — overlap them.
  const [analytics, orgUnits] = await Promise.all([
    fetchAnalyticsAdvanced({
      dx: [metric.id],
      pe,
      ou: request.orgUnitId,
      targetOrgUnitLevel: request.targetOrgUnitLevel,
    }),
    request.targetOrgUnitLevel
      ? fetchOrgUnits({ level: request.targetOrgUnitLevel, parent: request.orgUnitId })
      : Promise.resolve({ organisationUnits: [] }),
  ]);

  const items = { ...analytics.metaData.items };
  items[metric.id] = { name: metric.name };
  orgUnits.organisationUnits.forEach((unit) => {
    items[unit.id] = { name: unit.name };
  });
  analytics.metaData.items = items;

  return assembleDhis2Analysis(
    request,
    metric,
    candidates,
    analytics,
    undefined,
    options,
  );
}

/**
 * Generate a human-readable explanation of the analysis results.
 * Covers trends, top/bottom values, geographic distribution, and key insights.
 */
function buildExplanation(
  metricName: string,
  analytics: { rows: string[][]; metaData: { items: Record<string, { name: string }> } },
  request: Dhis2AnalysisRequest,
  total: number,
  orgUnitCount: number,
  periodCount: number,
): string {
  const parts: string[] = [];

  // Intro
  const periodLabel = request.periods && request.periods.length > 0
    ? request.periods.map((p) => {
        const y = p.slice(0, 4);
        if (p.length === 4) return y;
        const m = parseInt(p.slice(4, 6), 10);
        const monthNames = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
        return `${monthNames[m - 1] ?? p} ${y}`;
      }).join(", ")
    : request.periodPreset.toLowerCase().replaceAll("_", " ");
  parts.push(`Cette analyse porte sur « ${metricName} » pour la période ${periodLabel}.`);

  // Total and scope
  if (total > 0) {
    parts.push(`Le total cumulé s'élève à ${total.toLocaleString("fr-FR")}, réparti sur ${orgUnitCount} unité${orgUnitCount > 1 ? "s" : ""} géographique${orgUnitCount > 1 ? "s" : ""} et ${periodCount} période${periodCount > 1 ? "s" : ""}.`);
  }

  // Trend analysis (if multiple periods)
  if (periodCount > 1) {
    const dxItems = analytics.metaData.items;
    const dxId = Object.keys(dxItems).find((k) => dxItems[k]?.name === metricName);
    const rowsForDx = analytics.rows.filter((r) => !dxId || r[0] === dxId);
    const byPeriod = new Map<string, number>();
    for (const row of rowsForDx) {
      const period = row[1];
      const value = Number(row[3]);
      if (Number.isFinite(value)) {
        byPeriod.set(period, (byPeriod.get(period) ?? 0) + value);
      }
    }
    const sortedPeriods = [...byPeriod.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (sortedPeriods.length >= 2) {
      const firstVal = sortedPeriods[0][1];
      const lastVal = sortedPeriods[sortedPeriods.length - 1][1];
      const delta = lastVal - firstVal;
      const pct = firstVal !== 0 ? ((delta / firstVal) * 100).toFixed(1) : null;
      if (delta > 0) {
        parts.push(`On observe une tendance haussière : les valeurs sont passées de ${firstVal.toLocaleString("fr-FR")} à ${lastVal.toLocaleString("fr-FR")}${pct ? ` (+${pct}%)` : ""}.`);
      } else if (delta < 0) {
        parts.push(`On observe une tendance baissière : les valeurs sont passées de ${firstVal.toLocaleString("fr-FR")} à ${lastVal.toLocaleString("fr-FR")}${pct ? ` (${pct}%)` : ""}.`);
      } else {
        parts.push(`Les valeurs sont stables entre la première et la dernière période (${firstVal.toLocaleString("fr-FR")}).`);
      }
    }
  }

  // Top/bottom geographic units (if multiple org units)
  if (orgUnitCount > 1) {
    const byOrgUnit = new Map<string, { name: string; value: number }>();
    for (const row of analytics.rows) {
      const ouId = row[2];
      const value = Number(row[3]);
      if (!Number.isFinite(value)) continue;
      const name = analytics.metaData.items[ouId]?.name ?? ouId;
      const existing = byOrgUnit.get(ouId);
      if (existing) {
        existing.value += value;
      } else {
        byOrgUnit.set(ouId, { name, value });
      }
    }
    const sorted = [...byOrgUnit.values()].sort((a, b) => b.value - a.value);
    if (sorted.length >= 2) {
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      // Clean names: strip short code prefix
      const cleanName = (n: string) => n.replace(/^[a-z]{1,3}\s+/, "").replace(/\s+Province$/i, "");
      parts.push(`L'unité la plus élevée est « ${cleanName(top.name)} » avec ${top.value.toLocaleString("fr-FR")}, tandis que « ${cleanName(bottom.name)} » enregistre la valeur la plus basse (${bottom.value.toLocaleString("fr-FR")}).`);
    }
  }

  // Visualization hint
  const vizLabels: Record<string, string> = {
    kpi: "cartes KPI",
    line: "courbe d'évolution",
    bar: "graphique en barres",
    pie: "camembert",
    table: "tableau de données",
  };
  const vizLabel = vizLabels[request.visualization] ?? "graphique";
  parts.push(`Les résultats sont présentés sous forme de ${vizLabel} pour faciliter la lecture.`);

  return parts.join(" ");
}
