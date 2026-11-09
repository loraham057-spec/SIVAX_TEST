/**
 * Tests for the analytics slicing helpers shared by the DHIS2 pages.
 *
 * Run with: npx tsx --test src/lib/__tests__/dhis2-analytics.test.ts
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  cumulativeAnnualized,
  cumulativeRatio,
  cumulativeTotals,
  deriveAll,
  deriveSeries,
  totalOverPeriods,
  expandPeriods,
  incompletePeriods,
  latestByOrgUnit,
  latestSnapshot,
  mergeResults,
  onlyOrgUnit,
  excludeOrgUnit,
  periodSpan,
  pickIndicators,
  withDimensions,
} from "../dhis2-analytics";
import { formatDhis2PeriodRange } from "../dhis2-format";

const NOW = new Date(2026, 9, 3); // 3 Oct 2026
const ROOT = "ROOT";

const result = withDimensions(
  {
    rows: [
      ["penta3", "202606", ROOT, "97.8"],
      ["penta3", "202607", ROOT, "96.6"],
      ["penta3", "202609", ROOT, "40"], // previous month: still being reported
      ["penta3", "202606", "KIN", "90"],
      ["penta3", "202607", "KIN", "92"],
      ["penta3", "202605", "KAS", "70"],
      ["penta3", "202608", "KAS", "75"],
      ["bcg", "202607", ROOT, "88"],
      ["bcg", "202607", "KIN", "85"],
    ],
    metaData: { items: { KIN: { name: "Kinshasa" }, KAS: { name: "Kasaï" }, [ROOT]: { name: "RDC" } }, dimensions: {} },
  },
  ["penta3", "bcg"],
);

describe("expandPeriods", () => {
  it("expands LAST_N_MONTHS to the N months ending at the last complete month", () => {
    assert.deepEqual(expandPeriods(["LAST_3_MONTHS"], NOW), ["202608", "202607", "202606"]);
    assert.deepEqual(expandPeriods(["LAST_6_MONTHS"], new Date(2026, 9, 13)), ["202608", "202607", "202606", "202605", "202604", "202603"]);
  });
  it("expands LAST_COMPLETE_MONTH to M-2, the latest month the ETL syncs", () => {
    assert.deepEqual(expandPeriods(["LAST_COMPLETE_MONTH"], NOW), ["202608"]);
    assert.deepEqual(expandPeriods(["LAST_COMPLETE_MONTH"], new Date(2026, 1, 10)), ["202512"]);
  });
  it("handles year boundaries", () => {
    assert.deepEqual(expandPeriods(["LAST_3_MONTHS"], new Date(2026, 0, 15)), ["202511", "202510", "202509"]);
  });
  it("expands THIS_YEAR up to the current month and LAST_YEAR fully", () => {
    assert.equal(expandPeriods(["THIS_YEAR"], NOW).length, 10);
    assert.equal(expandPeriods(["LAST_YEAR"], NOW).length, 12);
    assert.equal(expandPeriods(["YEAR_OVER_YEAR"], NOW).length, 22);
  });
  it("passes explicit codes through and dedupes", () => {
    assert.deepEqual(expandPeriods(["202601", "202601", "LAST_MONTH"], NOW), ["202601", "202609"]);
  });
});

describe("incompletePeriods", () => {
  it("returns the current and previous month", () => {
    assert.deepEqual(incompletePeriods(NOW), ["202610", "202609"]);
    assert.deepEqual(incompletePeriods(new Date(2026, 0, 2)), ["202601", "202512"]);
  });
});

describe("slicing", () => {
  it("onlyOrgUnit keeps the selected unit and rebuilds dimensions", () => {
    const focus = onlyOrgUnit(result, ROOT)!;
    assert.equal(focus.rows.length, 4);
    assert.deepEqual(focus.metaData.dimensions.ou, [ROOT]);
    assert.deepEqual(focus.metaData.dimensions.dx, ["penta3", "bcg"]);
  });
  it("excludeOrgUnit drops the parent", () => {
    const children = excludeOrgUnit(result, ROOT)!;
    assert.ok(children.rows.every((r) => r[2] !== ROOT));
    assert.deepEqual(children.metaData.dimensions.ou, ["KAS", "KIN"]);
  });
  it("pickIndicators keeps the requested order and returns null when empty", () => {
    assert.deepEqual(pickIndicators(result, ["bcg"])!.metaData.dimensions.dx, ["bcg"]);
    assert.equal(pickIndicators(result, ["nope"]), null);
  });
});

describe("latestByOrgUnit", () => {
  it("takes the latest complete period per unit and skips the parent", () => {
    const latest = latestByOrgUnit(result, "penta3", { exclude: [ROOT], now: NOW });
    const byId = Object.fromEntries(latest.map((l) => [l.ouId, l]));
    assert.equal(latest.length, 2);
    assert.equal(byId.KIN.period, "202607");
    assert.equal(byId.KIN.value, 92);
    assert.equal(byId.KIN.name, "Kinshasa");
    assert.equal(byId.KAS.period, "202608");
  });
  it("ignores months still being reported when a complete one exists", () => {
    const [root] = latestByOrgUnit(result, "penta3", { exclude: ["KIN", "KAS"], now: NOW });
    assert.equal(root.period, "202607");
    assert.equal(root.value, 96.6);
  });
  it("latestSnapshot yields one row per unit", () => {
    const snap = latestSnapshot(result, "penta3", { exclude: [ROOT], now: NOW })!;
    assert.equal(snap.rows.length, 2);
    assert.deepEqual(snap.metaData.dimensions.dx, ["penta3"]);
  });
});

describe("deriveSeries", () => {
  const stock = withDimensions(
    {
      rows: [
        ["sdu", "202607", ROOT, "800"],
        ["cmm", "202607", ROOT, "400"],
        ["reports", "202607", ROOT, "200"],
        ["reports", "202607", "KIN", "50"],
        ["so", "202607", ROOT, "20"],
        ["a", "202607", "KIN", "3"],
        ["b", "202607", "KIN", "4"],
      ],
      metaData: { items: {}, dimensions: {} },
    },
  );
  it("computes a ratio per (period, unit)", () => {
    const r = deriveSeries(stock, { id: "mos", name: "Mois de stock", num: ["sdu"], den: ["cmm"] })!;
    assert.deepEqual(r.rows, [["mos", "202607", ROOT, "2"]]);
    assert.equal(r.metaData.items.mos.name, "Mois de stock");
  });
  it("treats a missing numerator as zero when asked (DHIS2 drops zeros)", () => {
    const r = deriveSeries(stock, { id: "pct", name: "% FOSA en rupture", num: ["so"], den: ["reports"], factor: 100, missingNumIsZero: true })!;
    const byOu = Object.fromEntries(r.rows.map((x) => [x[2], x[3]]));
    assert.equal(byOu[ROOT], "10");
    assert.equal(byOu.KIN, "0");
  });
  it("subtracts from the numerator and requires the subtracted value", () => {
    // Wastage rate = (used − administered) ÷ used.
    const r = deriveSeries(stock, { id: "w", name: "w", num: ["sdu"], subtract: ["cmm"], den: ["sdu"], factor: 100 })!;
    assert.deepEqual(r.rows, [["w", "202607", ROOT, "50"]]);
    assert.equal(deriveSeries(stock, { id: "w", name: "w", num: ["sdu"], subtract: ["missing"], den: ["sdu"] }), null);
  });
  it("sums without a denominator and skips zero denominators", () => {
    assert.equal(deriveSeries(stock, { id: "s", name: "s", num: ["a", "b"] })!.rows[0][3], "7");
    assert.equal(deriveSeries(stock, { id: "x", name: "x", num: ["sdu"], den: ["missing"] }), null);
  });
  it("deriveAll merges in order and totalOverPeriods sums a unit's months", () => {
    const all = deriveAll(stock, [
      { id: "s", name: "s", num: ["a", "b"] },
      { id: "mos", name: "m", num: ["sdu"], den: ["cmm"] },
    ])!;
    assert.deepEqual(all.metaData.dimensions.dx, ["s", "mos"]);
    assert.equal(totalOverPeriods(result, "penta3", "KIN"), 182);
    assert.equal(totalOverPeriods(result, "nope", "KIN"), null);
  });
  it("periodSpan returns the first and last periods present for a unit", () => {
    assert.deepEqual(periodSpan(result, ["penta3", "bcg"], ROOT), { first: "202606", last: "202609" });
    assert.deepEqual(periodSpan(result, ["penta3"], "KAS"), { first: "202605", last: "202608" });
    assert.equal(periodSpan(result, ["nope"], ROOT), null);
  });
  it("formatDhis2PeriodRange labels ranges compactly", () => {
    assert.equal(formatDhis2PeriodRange("202604", "202608"), "avr.–août 2026");
    assert.equal(formatDhis2PeriodRange("202510", "202603"), "oct. 2025–mars 2026");
    assert.equal(formatDhis2PeriodRange("202608", "202608"), "août 2026");
  });
});

describe("mergeResults", () => {
  it("concatenates rows and items", () => {
    const a = onlyOrgUnit(result, "KIN")!;
    const b = onlyOrgUnit(result, "KAS")!;
    const merged = mergeResults([a, null, b], ["penta3", "bcg"])!;
    assert.equal(merged.rows.length, a.rows.length + b.rows.length);
    assert.equal(merged.metaData.items.KAS.name, "Kasaï");
    assert.equal(mergeResults([null]), null);
  });
});

describe("cumulative values over the period", () => {
  const monthly = withDimensions(
    {
      rows: [
        ["cov", "202606", "KIN", "90"], // 30 days
        ["cov", "202607", "KIN", "100"], // 31 days
        ["cov", "202609", "KIN", "10"], // previous month: still being reported
        ["cov", "202607", ROOT, "95"],
        ["p1", "202606", "KIN", "100"],
        ["p3", "202606", "KIN", "90"],
        ["p1", "202607", "KIN", "300"],
        ["p3", "202607", "KIN", "290"],
        ["p1", "202608", "KIN", "1000"], // no Penta3 that month: excluded from the ratio
      ],
      metaData: { items: { KIN: { name: "Kinshasa" } }, dimensions: {} },
    },
  );

  it("cumulativeAnnualized is the day-weighted mean of complete months", () => {
    const [kin] = cumulativeAnnualized(monthly, "cov", { exclude: [ROOT], now: NOW });
    assert.equal(kin.ouId, "KIN");
    assert.equal(kin.name, "Kinshasa");
    assert.ok(Math.abs(kin.value - (90 * 30 + 100 * 31) / 61) < 1e-9);
    assert.deepEqual([kin.first, kin.last, kin.months], ["202606", "202607", 2]);
  });

  it("cumulativeRatio sums numerators and denominators over months where all are reported", () => {
    const [kin] = cumulativeRatio(monthly, { num: "p1", subtract: "p3", den: "p1", factor: 100 }, { now: NOW });
    assert.equal(kin.value, ((400 - 380) / 400) * 100); // 5 %, not the mean of 10 % and 3.3 %
    assert.deepEqual([kin.first, kin.last, kin.months], ["202606", "202607", 2]);
    assert.deepEqual(cumulativeRatio(null, { num: "p1", den: "p1" }), []);
  });
});

describe("cumulativeTotals", () => {
  it("sums each indicator over the months where all are reported", () => {
    const r = withDimensions({
      rows: [
        ["p1", "202606", "KIN", "100"], ["p3", "202606", "KIN", "90"],
        ["p1", "202607", "KIN", "300"], ["p3", "202607", "KIN", "290"],
        ["p1", "202608", "KIN", "1000"],
        ["p1", "202609", "KIN", "5"], ["p3", "202609", "KIN", "5"], // incomplete month
      ],
      metaData: { items: { KIN: { name: "Kinshasa" } }, dimensions: {} },
    });
    const [kin] = cumulativeTotals(r, ["p1", "p3"], { now: NOW });
    assert.deepEqual(kin.totals, { p1: 400, p3: 380 });
    assert.deepEqual([kin.name, kin.first, kin.last, kin.months], ["Kinshasa", "202606", "202607", 2]);
    assert.deepEqual(cumulativeTotals(null, ["p1"]), []);
  });
});
