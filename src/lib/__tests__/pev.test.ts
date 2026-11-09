/**
 * Tests for the PEV Semantic Layer.
 *
 * Run with: npx tsx --test src/lib/__tests__/pev.test.ts
 *
 * Tests the pure-logic functions:
 *   - findIndicator / findIndicators (search)
 *   - evaluateThreshold (threshold evaluation)
 *   - getIndicatorsByDomain / getIndicatorsByAntigen
 *   - getAvailableAntigens
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  PEV_INDICATORS,
  PEV_INDICATOR_BY_CODE,
  PEV_INDICATOR_BY_DHIS2_ID,
  findIndicator,
  findIndicators,
  getIndicatorsByDomain,
  getIndicatorsByAntigen,
  getAvailableAntigens,
  evaluateThreshold,
  isSuspectValue,
} from "../pev/index";

describe("PEV Indicator Catalog", () => {
  it("should have 13 indicators", () => {
    assert.equal(PEV_INDICATORS.length, 13);
  });

  it("should have unique codes", () => {
    const codes = PEV_INDICATORS.map((i) => i.code);
    const unique = new Set(codes);
    assert.equal(unique.size, codes.length);
  });

  it("should have DHIS2 UIDs for all indicators", () => {
    for (const ind of PEV_INDICATORS) {
      assert.ok(ind.dhis2Id, `Indicator ${ind.code} should have a dhis2Id`);
      assert.ok(ind.dhis2Id!.length > 5, `Indicator ${ind.code} dhis2Id too short`);
    }
  });

  it("should be indexed by code", () => {
    assert.ok(PEV_INDICATOR_BY_CODE["PENTA3_COVERAGE"]);
    assert.equal(PEV_INDICATOR_BY_CODE["PENTA3_COVERAGE"].label, "Couverture Penta3");
  });

  it("should be indexed by DHIS2 ID", () => {
    assert.ok(PEV_INDICATOR_BY_DHIS2_ID["v9b9aYsA5PM"]);
    assert.equal(PEV_INDICATOR_BY_DHIS2_ID["v9b9aYsA5PM"].code, "PENTA3_COVERAGE");
  });
});

describe("findIndicator", () => {
  it("should find Penta3 by exact label", () => {
    const result = findIndicator("Couverture Penta3");
    assert.ok(result);
    assert.equal(result?.code, "PENTA3_COVERAGE");
  });

  it("should find Penta3 by alias", () => {
    const result = findIndicator("Penta3");
    assert.ok(result);
    assert.equal(result?.code, "PENTA3_COVERAGE");
  });

  it("should find BCG by alias", () => {
    const result = findIndicator("BCG");
    assert.ok(result);
    assert.equal(result?.antigen, "BCG");
  });

  it("should find by partial query", () => {
    const result = findIndicator("penta 3");
    assert.ok(result);
    assert.equal(result?.code, "PENTA3_COVERAGE");
  });

  it("should return null for non-matching query", () => {
    const result = findIndicator("xyznonexistent", 90);
    assert.equal(result, null);
  });

  it("should be case-insensitive", () => {
    const result = findIndicator("pEnTa3");
    assert.ok(result);
    assert.equal(result?.code, "PENTA3_COVERAGE");
  });

  it("should handle accents", () => {
    const result = findIndicator("couverture penta3");
    assert.ok(result);
  });
});

describe("findIndicators", () => {
  it("should return multiple results for 'couverture'", () => {
    const results = findIndicators("couverture");
    assert.ok(results.length > 1);
  });

  it("should sort by score descending", () => {
    const results = findIndicators("penta");
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].score >= results[i].score, "Results should be sorted by score descending");
    }
  });

  it("should deduplicate by indicator code", () => {
    const results = findIndicators("penta");
    const codes = results.map((r) => r.indicator.code);
    const unique = new Set(codes);
    assert.equal(unique.size, codes.length);
  });
});

describe("getIndicatorsByDomain", () => {
  it("should return coverage indicators", () => {
    const results = getIndicatorsByDomain("coverage");
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.equal(r.domain, "coverage");
    }
  });

  it("should return dropout indicators", () => {
    const results = getIndicatorsByDomain("dropout");
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.equal(r.domain, "dropout");
    }
  });

  it("should return empty for unknown domain", () => {
    const results = getIndicatorsByDomain("nonexistent" as never);
    assert.equal(results.length, 0);
  });
});

describe("getIndicatorsByAntigen", () => {
  it("should return Penta indicators", () => {
    const results = getIndicatorsByAntigen("Penta");
    assert.ok(results.length > 0);
    for (const r of results) {
      assert.equal(r.antigen, "Penta");
    }
  });

  it("should return BCG indicators", () => {
    const results = getIndicatorsByAntigen("BCG");
    assert.ok(results.length > 0);
  });
});

describe("getAvailableAntigens", () => {
  it("should return a sorted list of unique antigens", () => {
    const antigens = getAvailableAntigens();
    assert.ok(antigens.length > 0);
    assert.ok(antigens.includes("BCG"));
    assert.ok(antigens.includes("Penta"));
    // Check sorted
    for (let i = 1; i < antigens.length; i++) {
      assert.ok(antigens[i - 1] <= antigens[i], "Antigens should be sorted");
    }
  });
});

describe("evaluateThreshold", () => {
  it("should evaluate coverage above target as target", () => {
    const ind = PEV_INDICATOR_BY_CODE["PENTA3_COVERAGE"];
    const result = evaluateThreshold(ind, 92);
    assert.equal(result.level, "target");
    assert.equal(result.color, "green");
  });

  it("should evaluate coverage below the alert bound (80 %) as critical", () => {
    const ind = PEV_INDICATOR_BY_CODE["PENTA3_COVERAGE"];
    assert.equal(evaluateThreshold(ind, 50).level, "critical");
    const result = evaluateThreshold(ind, 79.9);
    assert.equal(result.level, "critical");
    assert.equal(result.color, "red");
  });

  it("should evaluate coverage between warning and target as warning (no gap)", () => {
    const ind = PEV_INDICATOR_BY_CODE["PENTA3_COVERAGE"];
    for (const v of [80, 85, 89.9]) {
      const result = evaluateThreshold(ind, v);
      assert.equal(result.level, "warning", String(v));
      assert.equal(result.color, "orange");
    }
  });

  it("should evaluate dropout between target and warning as warning (inverted)", () => {
    const ind = PEV_INDICATOR_BY_CODE["PENTA1_PENTA3_DROPOUT"];
    assert.equal(evaluateThreshold(ind, 7).level, "warning");
    assert.equal(evaluateThreshold(ind, 10).level, "warning");
    assert.equal(evaluateThreshold(ind, 10.1).level, "critical");
  });

  it("flags impossible values as suspect", () => {
    assert.equal(isSuspectValue(112.8, "coverage"), true);
    assert.equal(isSuspectValue(100, "coverage"), false);
    assert.equal(isSuspectValue(-1.9, "dropout"), true);
    assert.equal(isSuspectValue(0, "dropout"), false);
  });

  it("should evaluate dropout above low as critical (inverted)", () => {
    const ind = PEV_INDICATOR_BY_CODE["PENTA1_PENTA3_DROPOUT"];
    const result = evaluateThreshold(ind, 20);
    assert.equal(result.level, "critical");
    assert.equal(result.color, "red");
  });

  it("should evaluate dropout below target as target (inverted)", () => {
    const ind = PEV_INDICATOR_BY_CODE["PENTA1_PENTA3_DROPOUT"];
    const result = evaluateThreshold(ind, 3);
    assert.equal(result.level, "target");
    assert.equal(result.color, "green");
  });

  it("should return unknown for indicator without thresholds", () => {
    const ind = PEV_INDICATORS.find((i) => !i.thresholds);
    if (ind) {
      const result = evaluateThreshold(ind, 50);
      assert.equal(result.level, "unknown");
    }
  });
});
