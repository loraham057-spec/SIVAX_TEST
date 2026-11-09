/**
 * Tests for the DAX Gateway.
 *
 * Run with: npx tsx --test src/lib/__tests__/dax-gateway.test.ts
 *
 * Tests the validation logic (validateDAX) — the execution (executeDAX)
 * requires a live Power BI connection and is not tested here.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  validateDAX,
  DEFAULT_DAX_POLICY,
} from "../powerbi/dax-gateway";

describe("validateDAX", () => {
  it("should accept a simple EVALUATE query", () => {
    const dax = "EVALUATE VALUES(dim_indicators)";
    const result = validateDAX(dax);
    assert.ok(result.valid);
  });

  it("should accept a DEFINE ... EVALUATE query", () => {
    const dax = "DEFINE MEASURE x = 1 EVALUATE ROW(\"x\", [x])";
    const result = validateDAX(dax);
    assert.ok(result.valid);
  });

  it("should reject an empty query", () => {
    const result = validateDAX("");
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  it("should reject a whitespace-only query", () => {
    const result = validateDAX("   ");
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  it("should reject a query that doesn't start with EVALUATE or DEFINE", () => {
    const result = validateDAX("SELECT * FROM table");
    assert.equal(result.valid, false);
    assert.ok(result.error);
  });

  it("should reject INSERT statements", () => {
    const result = validateDAX("EVALUATE INSERT INTO table VALUES (1)");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("INSERT"));
  });

  it("should reject UPDATE statements", () => {
    const result = validateDAX("EVALUATE UPDATE table SET x = 1");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("UPDATE"));
  });

  it("should reject DELETE statements", () => {
    const result = validateDAX("EVALUATE DELETE FROM table");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("DELETE"));
  });

  it("should reject CREATE statements", () => {
    const result = validateDAX("EVALUATE CREATE TABLE x (a int)");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("CREATE"));
  });

  it("should reject DROP statements", () => {
    const result = validateDAX("EVALUATE DROP TABLE x");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("DROP"));
  });

  it("should reject ALTER statements", () => {
    const result = validateDAX("EVALUATE ALTER TABLE x ADD COLUMN y int");
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("ALTER"));
  });

  it("should reject queries that are too long", () => {
    const longDax = "EVALUATE " + "x".repeat(DEFAULT_DAX_POLICY.maxQueryLength + 1);
    const result = validateDAX(longDax);
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("trop longue"));
  });

  it("should accept a complex EVALUATE with FILTER and SUMMARIZE", () => {
    const dax = `
      EVALUATE
        SUMMARIZECOLUMNS(
          dim_org_units[province_name],
          "Penta3", [Couverture Penta3 %]
        )
    `;
    const result = validateDAX(dax);
    assert.ok(result.valid);
  });

  it("should accept comments before EVALUATE", () => {
    const dax = "// This is a comment\nEVALUATE VALUES(dim_date)";
    const result = validateDAX(dax);
    assert.ok(result.valid);
  });
});

describe("DEFAULT_DAX_POLICY", () => {
  it("should have allowedTables including fact and dim tables", () => {
    assert.ok(DEFAULT_DAX_POLICY.allowedTables.includes("fact_indicator_values"));
    assert.ok(DEFAULT_DAX_POLICY.allowedTables.includes("dim_indicators"));
    assert.ok(DEFAULT_DAX_POLICY.allowedTables.includes("dim_org_units"));
    assert.ok(DEFAULT_DAX_POLICY.allowedTables.includes("dim_date"));
  });

  it("should have forbiddenKeywords including write operations", () => {
    assert.ok(DEFAULT_DAX_POLICY.forbiddenKeywords.includes("INSERT"));
    assert.ok(DEFAULT_DAX_POLICY.forbiddenKeywords.includes("UPDATE"));
    assert.ok(DEFAULT_DAX_POLICY.forbiddenKeywords.includes("DELETE"));
    assert.ok(DEFAULT_DAX_POLICY.forbiddenKeywords.includes("CREATE"));
  });

  it("should have reasonable limits", () => {
    assert.ok(DEFAULT_DAX_POLICY.maxQueryLength > 1000);
    assert.ok(DEFAULT_DAX_POLICY.maxRows > 10);
    assert.ok(DEFAULT_DAX_POLICY.timeoutMs > 1000);
  });
});
