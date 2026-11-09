/**
 * Power BI filter validation — whitelist of allowed tables and columns.
 *
 * L'agent IA ne peut appliquer que des filtres sur des tables/columns
 * explicitement autorisées. Cela évite les filtres arbitraires qui
 * pourraient casser le rapport ou exposer des données non prévues.
 */

export interface FilterWhitelistEntry {
  table: string;
  columns: string[];
}

/**
 * Tables et columns autorisées pour les filtres Power BI.
 * Doit correspondre aux tables du modèle Power BI publié.
 */
export const FILTER_WHITELIST: FilterWhitelistEntry[] = [
  {
    table: "dim_org_units",
    columns: ["province_name", "zone_name", "name", "level"],
  },
  {
    table: "dim_indicators",
    columns: ["antigen", "pev_domain", "label", "domain"],
  },
  {
    table: "dim_date",
    columns: ["year", "month", "year_month", "quarter", "year_quarter"],
  },
];

/**
 * Vérifie si un filtre est autorisé par la whitelist.
 */
export function isFilterAllowed(
  table: string,
  column: string,
): boolean {
  const entry = FILTER_WHITELIST.find((e) => e.table === table);
  if (!entry) return false;
  return entry.columns.includes(column);
}

/**
 * Valide un tableau de filtres.
 * Retourne les filtres valides et la liste des erreurs.
 */
export function validateFilters(
  filters: Array<{ table: string; column: string; operator: string; values: string[] }>,
): {
  valid: Array<{ table: string; column: string; operator: string; values: string[] }>;
  errors: string[];
} {
  const valid: typeof filters = [];
  const errors: string[] = [];

  for (const f of filters) {
    if (!f.table || !f.column) {
      errors.push(`Filtre incomplet: table et column requis.`);
      continue;
    }
    if (!isFilterAllowed(f.table, f.column)) {
      errors.push(`Filtre non autorisé: ${f.table}.${f.column}`);
      continue;
    }
    if (!f.values || f.values.length === 0) {
      errors.push(`Filtre sans valeurs: ${f.table}.${f.column}`);
      continue;
    }
    const allowedOps = ["In", "Equals", "Contains"];
    if (!allowedOps.includes(f.operator)) {
      errors.push(`Opérateur non autorisé: ${f.operator} (autorisés: ${allowedOps.join(", ")})`);
      continue;
    }
    valid.push(f);
  }

  return { valid, errors };
}
