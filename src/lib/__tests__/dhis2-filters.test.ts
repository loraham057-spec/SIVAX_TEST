/**
 * Run with: npx tsx --test src/lib/__tests__/dhis2-filters.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { clampFilter, ROOT_ORG_UNIT, selectOrgUnit } from "../dhis2-filters";
import type { Dhis2FilterState } from "@/types";

const base: Dhis2FilterState = {
  orgUnitId: ROOT_ORG_UNIT,
  orgUnitLevel: 1,
  dataSetId: null,
  periodPreset: "LAST_12_MONTHS",
};
const fosa: Dhis2FilterState = { ...base, orgUnitId: "F", orgUnitLevel: 5, orgUnitPath: ["P", "Z", "A", "F"] };

describe("clampFilter", () => {
  it("keeps a selection within the allowed depth", () => {
    assert.equal(clampFilter(fosa, 5), fosa);
  });
  it("falls back to the ancestor at the maximum level", () => {
    const zone = clampFilter(fosa, 3);
    assert.equal(zone.orgUnitId, "Z");
    assert.equal(zone.orgUnitLevel, 3);
    assert.deepEqual(zone.orgUnitPath, ["P", "Z"]);
    assert.equal(clampFilter(fosa, 1).orgUnitId, ROOT_ORG_UNIT);
  });
  it("falls back to the country when the path is unknown", () => {
    const noPath = clampFilter({ ...fosa, orgUnitPath: undefined }, 3);
    assert.equal(noPath.orgUnitId, ROOT_ORG_UNIT);
    assert.equal(noPath.orgUnitLevel, 1);
  });
});

describe("selectOrgUnit", () => {
  it("replaces the level and drops the levels below", () => {
    const next = selectOrgUnit(fosa, 3, "Z2");
    assert.deepEqual(next.orgUnitPath, ["P", "Z2"]);
    assert.equal(next.orgUnitId, "Z2");
    assert.equal(next.orgUnitLevel, 3);
  });
  it("clears a level back to its parent", () => {
    const next = selectOrgUnit(fosa, 3, "");
    assert.equal(next.orgUnitId, "P");
    assert.equal(next.orgUnitLevel, 2);
    assert.equal(selectOrgUnit(fosa, 2, "").orgUnitId, ROOT_ORG_UNIT);
  });
});
