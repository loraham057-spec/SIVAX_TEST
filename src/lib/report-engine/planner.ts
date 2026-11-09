/**
 * ReportPlanner — transforms a natural-language user prompt into a
 * structured ReportPlan (report type, period, scope, audience, template).
 *
 * The planner NEVER generates the report itself; it only builds the plan,
 * which the user can review and edit before generation. The LLM output is
 * sanitized against deterministic rules (period durations, known report
 * types, geographic vs organizational scope).
 */

import { DEFAULT_OPENAI_MODEL, getSetting } from "@/lib/settings";
import { REPORT_TYPE_REGISTRY, DEFAULT_REPORT_TYPE, getReportType } from "./registry";
import type { ReportAudience, ReportPlan, ReportTemplateId } from "./types";

const AUDIENCES: ReportAudience[] = ["EXECUTIVE", "TECHNICAL", "PARTNER", "DONOR", "PUBLIC"];
const TEMPLATES: ReportTemplateId[] = ["sivax", "institutional", "development", "consulting", "government"];

const MONTHS_FR: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};
const MONTH_ALTERNATION = Object.keys(MONTHS_FR).join("|");

const NUMBER_WORDS: Record<string, number> = {
  un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
  sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
};

/** Capitalized words that are organizations/common words, never places. */
const NON_GEO_WORDS = new Set([
  "gavi", "thrive360", "thrive", "unicef", "oms", "who", "pev", "sivax",
  "villagereach", "banque", "direction", "ministere", "snis", "dhis2",
  "sigl", "fosa", "bcg", "penta", "var", "vpo", "vpi", "rota", "hpv",
]);

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function monthString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  return monthString(new Date());
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthString(d);
}

function lastMonths(count: number): { start: string; end: string } {
  const end = currentMonth();
  return { start: shiftMonth(end, -(count - 1)), end };
}

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

/**
 * Parse the reporting period from the prompt. Understands:
 * N derniers mois (digits or words), mois dernier, ce/dernier trimestre,
 * premier/second semestre, année YYYY, mois YYYY, intervalles
 * ("de mars à juin 2026", "mars et avril 2026").
 */
export function parsePeriod(text: string): { start: string; end: string } | null {
  const now = new Date();
  const year = now.getFullYear();

  // "les N derniers mois" / "sur N mois" (digits or words)
  const nMonths = text.match(/(\d{1,2}|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)\s+derniers?\s+mois/);
  if (nMonths) {
    const n = NUMBER_WORDS[nMonths[1]] ?? parseInt(nMonths[1], 10);
    if (Number.isFinite(n) && n >= 1) return lastMonths(Math.min(24, n));
  }

  // "le mois dernier" / "du mois dernier" / "le dernier mois"
  if (/\b(le |du )?(mois dernier|dernier mois)\b/.test(text)) {
    const prev = shiftMonth(currentMonth(), -1);
    return { start: prev, end: prev };
  }

  // Quarters
  if (/\b(dernier trimestre|trimestre dernier)\b/.test(text)) {
    const q = Math.floor(now.getMonth() / 3); // current quarter index 0-3
    const start = new Date(year, (q - 1) * 3, 1);
    return { start: monthString(start), end: monthString(new Date(start.getFullYear(), start.getMonth() + 2, 1)) };
  }
  if (/\bce trimestre\b/.test(text)) {
    const q = Math.floor(now.getMonth() / 3);
    return { start: monthString(new Date(year, q * 3, 1)), end: currentMonth() };
  }

  // Semesters
  const semester = text.match(/\b(premier|1er|deuxieme|second|2e|2eme)\s+semestre(?:\s+(?:de\s+)?(20\d{2}))?/);
  if (semester) {
    const y = semester[2] ? parseInt(semester[2], 10) : year;
    const firstHalf = /premier|1er/.test(semester[1]);
    return firstHalf ? { start: `${y}-01`, end: `${y}-06` } : { start: `${y}-07`, end: `${y}-12` };
  }
  if (/\bce semestre\b/.test(text)) {
    const start = now.getMonth() < 6 ? `${year}-01` : `${year}-07`;
    return { start, end: currentMonth() };
  }

  // Month ranges: "de mars à juin 2026", "entre mars et juin 2026", "mars et avril 2026"
  const range = text.match(new RegExp(
    `(?:de\\s+|entre\\s+)?(${MONTH_ALTERNATION})(?:\\s+(20\\d{2}))?\\s+(?:a|à|au|et)\\s+(${MONTH_ALTERNATION})\\s+(20\\d{2})`,
  ));
  if (range) {
    const endYear = parseInt(range[4], 10);
    const startYear = range[2] ? parseInt(range[2], 10) : endYear;
    return {
      start: `${startYear}-${String(MONTHS_FR[range[1]]).padStart(2, "0")}`,
      end: `${endYear}-${String(MONTHS_FR[range[3]]).padStart(2, "0")}`,
    };
  }

  // Single "month YYYY"
  const monthYear = text.match(new RegExp(`(${MONTH_ALTERNATION})\\s+(20\\d{2})`));
  if (monthYear) {
    const m = `${monthYear[2]}-${String(MONTHS_FR[monthYear[1]]).padStart(2, "0")}`;
    return { start: m, end: m };
  }

  // "cette année" / "l'année dernière" / bare year ("pour 2025", "en 2025")
  if (/\bcette annee\b/.test(text)) return { start: `${year}-01`, end: currentMonth() };
  if (/\b(l ?annee derniere|annee passee)\b/.test(text)) return { start: `${year - 1}-01`, end: `${year - 1}-12` };
  const bareYear = text.match(/\b(?:pour|en|de|sur)\s+(20\d{2})\b/);
  if (bareYear) {
    const y = parseInt(bareYear[1], 10);
    return { start: `${y}-01`, end: `${y}-12` };
  }

  return null;
}

/** Extract a candidate geographic scope from the prompt (validated later by resolveScope). */
export function parseScope(prompt: string): string | undefined {
  // After a locative preposition, capture capitalized word(s) (accents and hyphens included).
  // No \b before accented letters: JS word boundaries are ASCII-only.
  const regex = /(?:^|\s)(?:à|a|au|aux|en|dans|pour|de)\s+(?:la\s+|le\s+|les\s+|l')?(?:province\s+(?:de\s+|du\s+|des\s+)?)?([A-ZÀ-Ý][\wÀ-ÿ-]*(?:[\s-][A-ZÀ-Ý][\wÀ-ÿ-]*)*)/gu;
  for (const match of prompt.matchAll(regex)) {
    const candidate = match[1].trim();
    const norm = normalize(candidate).replace(/[^a-z0-9 ]/g, "");
    if (!norm || NON_GEO_WORDS.has(norm.split(" ")[0])) continue;
    // Skip French month names and years wrongly capitalized
    if (new RegExp(`^(${MONTH_ALTERNATION})\\b`).test(norm) || /^\d/.test(norm)) continue;
    return candidate;
  }
  return undefined;
}

/** Heuristic fallback planner used when no LLM key is configured. */
export function heuristicPlan(prompt: string): ReportPlan {
  const text = normalize(prompt);

  // Report type by keywords (most specific last so it wins)
  let reportType = DEFAULT_REPORT_TYPE;
  if (/\bstock/.test(text)) reportType = "STOCK_STATUS";
  if (/rupture/.test(text)) reportType = "STOCK_STATUS";
  if (/synthese|gestion des stocks/.test(text)) reportType = "STOCK_MANAGEMENT_SUMMARY";
  if (/arrivee|reception|livraison/.test(text)) reportType = "ARRIVALS";
  if (/sortie|distribution/.test(text)) reportType = "ISSUES";
  if (/comptage|ajustement|inventaire physique/.test(text)) reportType = "PHYSICAL_COUNT";
  if (/capacite/.test(text)) reportType = "STORAGE_CAPACITY";
  if (/performance|couverture|abandon|vaccinale/.test(text) && !/stock|rupture/.test(text)) reportType = "PERFORMANCE";
  if (/approvisionnement|adequation/.test(text)) reportType = "SUPPLY_ADEQUACY";
  if (/chaine du froid|refrigerateur|congelateur|equipement/.test(text)) reportType = "COLD_CHAIN_INVENTORY";

  const period = parsePeriod(text) ?? lastMonths(6);
  const geographicScope = parseScope(prompt);

  // Audience
  let audience: ReportAudience = "TECHNICAL";
  if (/direction|comite|executif|decideur/.test(text)) audience = "EXECUTIVE";
  if (/partenaire/.test(text)) audience = "PARTNER";
  if (/donateur|bailleur|gavi|thrive/.test(text)) audience = "DONOR";
  if (/\bpublic\b|citoyen/.test(text)) audience = "PUBLIC";

  const template: ReportTemplateId =
    audience === "EXECUTIVE" ? "consulting" : audience === "DONOR" ? "development" : audience === "PUBLIC" ? "government" : "sivax";

  return {
    reportType,
    audience,
    period: clampPeriod(period),
    geographicScope,
    template,
    requestedSections: getReportType(reportType).defaultSections,
    prompt,
  };
}

/** Never plan beyond the current month (no future/projection periods). */
function clampPeriod(period: { start: string; end: string }): { start: string; end: string } {
  const cap = currentMonth();
  let { start, end } = period;
  if (end > cap) end = cap;
  if (start > end) start = end;
  return { start, end };
}

export function sanitizePlan(raw: Partial<ReportPlan>, prompt: string): ReportPlan {
  const fallback = heuristicPlan(prompt);
  const reportType = REPORT_TYPE_REGISTRY[raw.reportType ?? ""] ? (raw.reportType as string) : fallback.reportType;
  const audience = AUDIENCES.includes(raw.audience as ReportAudience) ? (raw.audience as ReportAudience) : fallback.audience;
  const template = TEMPLATES.includes(raw.template as ReportTemplateId) ? (raw.template as ReportTemplateId) : fallback.template;
  const validMonth = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null);
  let start = validMonth(raw.period?.start) ?? fallback.period.start;
  let end = validMonth(raw.period?.end) ?? fallback.period.end;
  if (start > end) [start, end] = [end, start];

  // Enforce the exact duration when the prompt says "les N derniers mois"
  // (LLMs frequently produce off-by-one windows), anchored on the current month.
  const text = normalize(prompt);
  const nMonths = text.match(/(\d{1,2}|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze)\s+derniers?\s+mois/);
  if (nMonths) {
    const n = Math.min(24, NUMBER_WORDS[nMonths[1]] ?? parseInt(nMonths[1], 10));
    if (Number.isFinite(n) && n >= 1 && monthsBetween(start, end) !== n) {
      ({ start, end } = lastMonths(n));
    }
  }

  // Geographic scope: ignore organizations misclassified as places.
  let geographicScope =
    typeof raw.geographicScope === "string" && raw.geographicScope.trim()
      ? raw.geographicScope.trim().slice(0, 100)
      : fallback.geographicScope;
  if (geographicScope && NON_GEO_WORDS.has(normalize(geographicScope).split(" ")[0])) {
    geographicScope = undefined;
  }

  return {
    reportType,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim().slice(0, 200) : undefined,
    audience,
    period: clampPeriod({ start, end }),
    geographicScope,
    template,
    requestedSections: getReportType(reportType).defaultSections,
    prompt,
  };
}

/**
 * Build a report plan from a user prompt.
 * Uses the configured OpenAI key when available, otherwise falls back
 * to deterministic heuristics. The LLM output is always sanitized.
 */
export async function planReport(prompt: string): Promise<{ plan: ReportPlan; source: "llm" | "heuristic" }> {
  const [apiKey, model] = await Promise.all([getSetting("openai_api_key"), getSetting("openai_model")]);
  if (!apiKey) return { plan: heuristicPlan(prompt), source: "heuristic" };

  const today = new Date().toISOString().slice(0, 10);
  const types = Object.values(REPORT_TYPE_REGISTRY)
    .map((t) => `- ${t.id}: ${t.name}`)
    .join("\n");

  const system = `You are the SIVAX Report Planner. Convert the user's request into a JSON plan for an institutional health report about DRC (vaccination / vaccine supply chain).
Today is ${today}. Respond ONLY with a JSON object, no markdown, with keys:
reportType (one of:\n${types}),
title (short report title in French),
audience (EXECUTIVE|TECHNICAL|PARTNER|DONOR|PUBLIC),
period ({"start":"YYYY-MM","end":"YYYY-MM"}). "les N derniers mois" means EXACTLY N months ending with the current month (e.g. with today in 2026-10, "6 derniers mois" = 2026-05 → 2026-10). Never use months after the current one.
geographicScope: the GEOGRAPHIC place mentioned (province, ville or zone de santé of DRC), exactly as written. Organizations (Gavi, UNICEF, OMS, Thrive360…) are NEVER a geographicScope. null when no place is mentioned or for national scope.
template (sivax|institutional|development|consulting|government — consulting for executives, development for donors, government for the public, sivax otherwise).
Never invent data; only classify the request.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model || DEFAULT_OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const raw = JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
    return { plan: sanitizePlan(raw, prompt), source: "llm" };
  } catch {
    return { plan: heuristicPlan(prompt), source: "heuristic" };
  }
}
