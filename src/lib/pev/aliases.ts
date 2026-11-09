/**
 * PEV Semantic Layer — Aliases & search.
 *
 * Recherche d'indicateurs PEV en langage naturel.
 * L'agent IA utilise findIndicator() pour mapper une question utilisateur
 * vers un indicateur du catalogue.
 */

import { PEV_INDICATORS, type PEVIndicatorDefinition } from "./indicators";

/**
 * Normalise une chaîne pour la comparaison :
 * - minuscules
 * - sans accents
 * - sans ponctuation
 * - espaces normalisés
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // supprime les accents
    .replace(/[^\w\s]/g, " ") // supprime la ponctuation
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Index de recherche : chaque alias normalisé → indicateur.
 * Construit une fois au chargement du module.
 */
interface SearchEntry {
  normalized: string;
  indicator: PEVIndicatorDefinition;
  /** Score de pertinence (plus long = plus pertinent) */
  score: number;
}

const SEARCH_INDEX: SearchEntry[] = PEV_INDICATORS.flatMap((indicator) => {
  const terms = [
    indicator.label,
    indicator.code,
    ...indicator.aliases,
  ];
  return terms.map((term) => ({
    normalized: normalize(term),
    indicator,
    score: term.length,
  }));
});

export interface SearchResult {
  indicator: PEVIndicatorDefinition;
  /** Score de correspondance (0-100) */
  score: number;
  /** Terme qui a matché */
  matchedTerm: string;
}

/**
 * Recherche un indicateur PEV à partir d'une question en langage naturel.
 *
 * Stratégie :
 * 1. Match exact (normalisé) → score 100
 * 2. Match partiel (inclusion) → score proportionnel
 * 3. Match par mots-clés → score par nombre de mots matchés
 *
 * @param query Question ou terme de recherche (ex: "Penta3", "couverture BCG")
 * @returns Résultats triés par score décroissant (meilleur en premier)
 */
export function findIndicators(query: string): SearchResult[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const queryWords = normalizedQuery.split(" ").filter((w) => w.length > 1);
  const results: SearchResult[] = [];

  for (const entry of SEARCH_INDEX) {
    let score = 0;

    // Match exact
    if (entry.normalized === normalizedQuery) {
      score = 100;
    }
    // Inclusion (le terme contient la query ou vice versa)
    else if (entry.normalized.includes(normalizedQuery)) {
      score = 80 - (entry.normalized.length - normalizedQuery.length);
    } else if (normalizedQuery.includes(entry.normalized)) {
      score = 70 - (normalizedQuery.length - entry.normalized.length);
    }
    // Match par mots-clés
    else {
      const entryWords = entry.normalized.split(" ");
      const matchedWords = queryWords.filter((qw) =>
        entryWords.some((ew) => ew.includes(qw) || qw.includes(ew)),
      );
      if (matchedWords.length > 0) {
        score = (matchedWords.length / queryWords.length) * 50;
      }
    }

    if (score > 0) {
      results.push({
        indicator: entry.indicator,
        score: Math.max(0, Math.min(100, score)),
        matchedTerm: entry.normalized,
      });
    }
  }

  // Dédoublonner par indicateur (garder le meilleur score)
  const byIndicator = new Map<string, SearchResult>();
  for (const r of results) {
    const existing = byIndicator.get(r.indicator.code);
    if (!existing || r.score > existing.score) {
      byIndicator.set(r.indicator.code, r);
    }
  }

  return Array.from(byIndicator.values()).sort((a, b) => b.score - a.score);
}

/**
 * Recherche le meilleur indicateur correspondant à la query.
 * Retourne null si aucun match avec un score suffisant.
 *
 * @param query Question en langage naturel
 * @param minScore Score minimum (défaut: 30)
 */
export function findIndicator(
  query: string,
  minScore = 30,
): PEVIndicatorDefinition | null {
  const results = findIndicators(query);
  const best = results[0];
  if (!best || best.score < minScore) return null;
  return best.indicator;
}

/**
 * Retourne tous les indicateurs d'un domaine PEV donné.
 */
export function getIndicatorsByDomain(
  domain: PEVIndicatorDefinition["domain"],
): PEVIndicatorDefinition[] {
  return PEV_INDICATORS.filter((i) => i.domain === domain);
}

/**
 * Retourne tous les indicateurs pour un antigène donné.
 */
export function getIndicatorsByAntigen(
  antigen: string,
): PEVIndicatorDefinition[] {
  const normalized = normalize(antigen);
  return PEV_INDICATORS.filter(
    (i) => i.antigen && normalize(i.antigen) === normalized,
  );
}

/**
 * Liste tous les antigènes disponibles dans le catalogue.
 */
export function getAvailableAntigens(): string[] {
  const antigens = PEV_INDICATORS
    .map((i) => i.antigen)
    .filter((a): a is string => a !== null);
  return [...new Set(antigens)].sort();
}
