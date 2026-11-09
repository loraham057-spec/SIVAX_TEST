/**
 * Tests for the Power BI filter validation.
 *
 * Run with: npx tsx --test src/lib/__tests__/powerbi-filters.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  FILTER_WHITELIST,
  isFilterAllowed,
  validateFilters,
} from "../powerbi/filters";

describe("isFilterAllowed", () => {
  it("should allow dim_org_units.province_name", () => {
    assert.equal(isFilterAllowed("dim_org_units", "province_name"), true);
  });

  it("should allow dim_org_units.zone_name", () => {
    assert.equal(isFilterAllowed("dim_org_units", "zone_name"), true);
  });

  it("should allow dim_indicators.antigen", () => {
    assert.equal(isFilterAllowed("dim_indicators", "antigen"), true);
  });

  it("should allow dim_date.year", () => {
    assert.equal(isFilterAllowed("dim_date", "year"), true);
  });

  it("should allow dim_date.year_month", () => {
    assert.equal(isFilterAllowed("dim_date", "year_month"), true);
  });

  it("should reject unknown table", () => {
    assert.equal(isFilterAllowed("unknown_table", "x"), false);
  });

  it("should reject unknown column on known table", () => {
    assert.equal(isFilterAllowed("dim_org_units", "unknown_column"), false);
  });

  it("should reject fact_indicator_values (not in whitelist)", () => {
    assert.equal(isFilterAllowed("fact_indicator_values", "value"), false);
  });
});

describe("validateFilters", () => {
  it("should validate a correct filter", () => {
    const result = validateFilters([
      { table: "dim_org_units", column: "province_name", operator: "In", values: ["Kinshasa"] },
    ]);
    assert.equal(result.valid.length, 1);
    assert.equal(result.errors.length, 0);
  });

  it("should validate multiple correct filters", () => {
    const result = validateFilters([
      { table: "dim_org_units", column: "province_name", operator: "In", values: ["Kinshasa", "Goma"] },
      { table: "dim_date", column: "year", operator: "Equals", values: ["2025"] },
    ]);
    assert.equal(result.valid.length, 2);
    assert.equal(result.errors.length, 0);
  });

  it("should reject filter with missing table", () => {
    const result = validateFilters([
      { table: "", column: "province_name", operator: "In", values: ["Kinshasa"] },
    ]);
    assert.equal(result.valid.length, 0);
    assert.equal(result.errors.length, 1);
  });

  it("should reject filter with non-whitelisted table", () => {
    const result = validateFilters([
      { table: "fact_indicator_values", column: "value", operator: "In", values: ["100"] },
    ]);
    assert.equal(result.valid.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes("non autorisé"));
  });

  it("should reject filter with empty values", () => {
    const result = validateFilters([
      { table: "dim_org_units", column: "province_name", operator: "In", values: [] },
    ]);
    assert.equal(result.valid.length, 0);
    assert.equal(result.errors.length, 1);
  });

  it("should reject filter with invalid operator", () => {
    const result = validateFilters([
      { table: "dim_org_units", column: "province_name", operator: "GreaterThan", values: ["Kinshasa"] },
    ]);
    assert.equal(result.valid.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].includes("Opérateur non autorisé"));
  });

  it("should handle mixed valid and invalid filters", () => {
    const result = validateFilters([
      { table: "dim_org_units", column: "province_name", operator: "In", values: ["Kinshasa"] },
      { table: "unknown", column: "x", operator: "In", values: ["y"] },
    ]);
    assert.equal(result.valid.length, 1);
    assert.equal(result.errors.length, 1);
  });
});

describe("FILTER_WHITELIST", () => {
  it("should have 3 tables", () => {
    assert.equal(FILTER_WHITELIST.length, 3);
  });

  it("should include dim_org_units, dim_indicators, dim_date", () => {
    const tables = FILTER_WHITELIST.map((e) => e.table);
    assert.ok(tables.includes("dim_org_units"));
    assert.ok(tables.includes("dim_indicators"));
    assert.ok(tables.includes("dim_date"));
  });
});
