/**
 * DHIS2 formatting utilities (shared across components).
 *
 * DHIS2 stores periods as YYYYMM (e.g. 202507 = juillet 2025) and uses
 * opaque UIDs for indicators/org units. These helpers convert raw DHIS2
 * values into human-readable French strings.
 */

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

const MONTHS_FR_SHORT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];

const MONTHS_FR_AXIS = [
  "jan", "fév", "mar", "avr", "mai", "jun",
  "jul", "aoû", "sep", "oct", "nov", "déc",
];

/**
 * Convert a DHIS2 monthly period (YYYYMM) into a full French label.
 * Example: "202507" → "juillet 2025"
 */
export function formatDhis2Period(period: string | null | undefined): string {
  if (!period || period.length !== 6) return "";
  const year = period.slice(0, 4);
  const month = Number(period.slice(4, 6)) - 1;
  if (month < 0 || month > 11) return period;
  return `${MONTHS_FR[month]} ${year}`;
}

/**
 * Short French label for card subtitles.
 * Example: "202507" → "juil. 2025"
 */
export function formatDhis2PeriodShort(period: string | null | undefined): string {
  if (!period || period.length !== 6) return period ?? "";
  const year = period.slice(0, 4);
  const month = Number(period.slice(4, 6)) - 1;
  if (month < 0 || month > 11) return period;
  return `${MONTHS_FR_SHORT[month]} ${year}`;
}

/**
 * Short French label for a range of monthly periods.
 * Examples: ("202604", "202608") → "avr.–août 2026",
 *           ("202510", "202603") → "oct. 2025–mars 2026", ("202608", "202608") → "août 2026"
 */
export function formatDhis2PeriodRange(first: string, last: string): string {
  if (first === last) return formatDhis2PeriodShort(first);
  if (first.length !== 6 || last.length !== 6) return `${first}–${last}`;
  if (first.slice(0, 4) !== last.slice(0, 4)) return `${formatDhis2PeriodShort(first)}–${formatDhis2PeriodShort(last)}`;
  return `${MONTHS_FR_SHORT[Number(first.slice(4, 6)) - 1] ?? first}–${formatDhis2PeriodShort(last)}`;
}

/**
 * Compact label for chart axes (2-digit year).
 * Example: "202507" → "jul 25"
 */
export function formatDhis2PeriodAxis(period: string): string {
  if (period.length !== 6) return period;
  const month = Number(period.slice(4, 6)) - 1;
  if (month < 0 || month > 11) return period;
  return `${MONTHS_FR_AXIS[month]} ${period.slice(2, 4)}`;
}

/**
 * Format a numeric value with French locale and compact notation.
 * Example: 3067233 → "3,07 M", 8026 → "8,0 K", 87 → "87"
 */
export function formatDhis2Value(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} K`;
  return value.toLocaleString("fr-FR");
}

/**
 * Format a coverage rate value as a percentage with one decimal.
 * Example: 8.3 → "8,3 %", 90 → "90 %"
 * Used for vaccination coverage indicators (Penta3, BCG, etc.) where
 * DHIS2 already stores the value as a 0-100 percentage.
 */
export function formatCoveragePercent(value: number): string {
  if (!Number.isFinite(value)) return "—";
  // One decimal for values < 100, no decimal for whole numbers
  const formatted = value % 1 === 0
    ? value.toLocaleString("fr-FR")
    : value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${formatted} %`;
}

/**
 * Replace all DHIS2 period codes (YYYYMM) embedded in arbitrary text with
 * their human-readable French equivalent.
 *
 * Handles two cases:
 * 1. "Mars 2025 (202503)" → "Mars 2025"  (redundant parenthetical removed)
 * 2. "202503"              → "Mars 2025"  (standalone code converted)
 *
 * Only matches valid period codes (20XX + month 01-12) that are not part
 * of a larger number, so years like "2025" or random 6-digit figures are
 * left untouched.
 */
export function formatPeriodsInText(text: string): string {
  if (!text) return text;

  // Step 1: Remove redundant "(YYYYMM)" when preceded by a month name + year.
  // Matches patterns like "Mars 2025 (202503)" or "juillet 2025 — 202507"
  const monthPattern = MONTHS_FR.join("|");
  const redundantRe = new RegExp(
    `(${monthPattern})\\s+(20\\d{2})\\s*[\\(\\[—-]\\s*(20\\d{2}(?:0[1-9]|1[0-2]))\\s*[\\)\\]]`,
    "gi",
  );
  let result = text.replace(redundantRe, "$1 $2");

  // Step 2: Replace remaining standalone YYYYMM codes (not part of a larger
  // number) with "Mois Année".
  result = result.replace(
    /(?<!\d)(20\d{2}(?:0[1-9]|1[0-2]))(?!\d)/g,
    (match) => formatDhis2Period(match) || match,
  );

  return result;
}

/**
 * Resolve a human-readable name from DHIS2 metaData items, falling back
 * to the raw ID if no name is found.
 */
export function resolveDhis2Name(
  items: Record<string, { name: string }> | undefined,
  id: string | undefined,
): string {
  if (!id) return "—";
  return items?.[id]?.name ?? id;
}
