/**
 * Pure helpers for the analytics filter state shared by the DHIS2 pages.
 */

import type { Dhis2FilterState } from "@/types";

export const ROOT_ORG_UNIT = "ymGeqzoPhN3"; // RDC (national)

/**
 * Restrict the geographic selection to `maxLevel` (1 = national … 5 = FOSA).
 * A page whose data only exists down to the health zone shows the zone that
 * contains the selected aire/FOSA instead; the shared store keeps the deeper
 * selection for the pages that support it.
 */
export function clampFilter(filter: Dhis2FilterState, maxLevel: number): Dhis2FilterState {
  if (filter.orgUnitLevel <= maxLevel) return filter;
  const path = (filter.orgUnitPath ?? []).slice(0, Math.max(maxLevel - 1, 0));
  return {
    ...filter,
    orgUnitPath: path,
    orgUnitId: path[path.length - 1] ?? ROOT_ORG_UNIT,
    orgUnitLevel: path.length + 1,
  };
}

/**
 * New filter after picking `id` at `level` (2 = province … 5 = FOSA) in the
 * geographic cascade; an empty `id` clears that level and everything below.
 */
export function selectOrgUnit(filter: Dhis2FilterState, level: number, id: string): Dhis2FilterState {
  const parents = (filter.orgUnitPath ?? []).slice(0, level - 2);
  const path = id ? [...parents, id] : parents;
  return {
    ...filter,
    orgUnitPath: path,
    orgUnitId: path[path.length - 1] ?? ROOT_ORG_UNIT,
    orgUnitLevel: path.length + 1,
  };
}
