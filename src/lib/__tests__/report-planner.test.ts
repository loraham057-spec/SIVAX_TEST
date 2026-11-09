/**
 * Tests for the Report Engine planner (prompt understanding).
 *
 * Run with: npx tsx --test src/lib/__tests__/report-planner.test.ts
 *
 * Covers the pure-logic parsing: geographic scope extraction, period
 * parsing (N derniers mois, trimestre, semestre, année, intervalles)
 * and LLM-plan sanitation (duration enforcement, non-geo scopes).
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { heuristicPlan, parsePeriod, parseScope, sanitizePlan } from "../report-engine/planner";

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return (ey - sy) * 12 + (em - sm) + 1;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

describe("parseScope", () => {
  it("extracts scope after à (accented preposition)", () => {
    assert.equal(parseScope("Génère-moi un rapport sur l'état des stocks à Kinshasa pour juillet 2026."), "Kinshasa");
  });

  it("extracts scope after au with hyphen", () => {
    assert.equal(parseScope("rapport sur la chaîne du froid au Haut-Katanga"), "Haut-Katanga");
  });

  it("extracts multi-word scope after dans le", () => {
    assert.equal(parseScope("Rapport de performance vaccinale dans le Nord Kivu sur 12 mois"), "Nord Kivu");
  });

  it("extracts accented scope", () => {
    assert.equal(parseScope("Rapport sur l'approvisionnement au Kasaï"), "Kasaï");
  });

  it("does not treat organizations as places", () => {
    assert.equal(parseScope("Rapport synthèse de la gestion des stocks pour Gavi"), undefined);
  });

  it("does not treat capitalized month names as places", () => {
    assert.equal(parseScope("Rapport des sorties pour Juillet 2026"), undefined);
  });

  it("returns undefined when no place is mentioned", () => {
    assert.equal(parseScope("Fais-moi un rapport sur les ruptures de stock sur les 6 derniers mois."), undefined);
  });
});

describe("parsePeriod", () => {
  it("parses N derniers mois (digits)", () => {
    const p = parsePeriod("rapport sur les 6 derniers mois");
    assert.ok(p);
    assert.equal(monthsBetween(p.start, p.end), 6);
    assert.equal(p.end, currentMonth());
  });

  it("parses N derniers mois (words)", () => {
    const p = parsePeriod("au cours des six derniers mois");
    assert.ok(p);
    assert.equal(monthsBetween(p.start, p.end), 6);
  });

  it("parses mois dernier as a single month", () => {
    const p = parsePeriod("rapport du mois dernier");
    assert.ok(p);
    assert.equal(p.start, p.end);
    assert.notEqual(p.start, currentMonth());
  });

  it("parses premier semestre with year", () => {
    assert.deepEqual(parsePeriod("pour le premier semestre 2026"), { start: "2026-01", end: "2026-06" });
  });

  it("parses ce trimestre from the quarter start", () => {
    const p = parsePeriod("rapport ce trimestre");
    assert.ok(p);
    assert.equal(p.end, currentMonth());
    assert.ok(monthsBetween(p.start, p.end) <= 3);
  });

  it("parses a single month + year", () => {
    assert.deepEqual(parsePeriod("pour juillet 2026"), { start: "2026-07", end: "2026-07" });
  });

  it("parses month ranges", () => {
    assert.deepEqual(parsePeriod("en mars et avril 2026"), { start: "2026-03", end: "2026-04" });
    assert.deepEqual(parsePeriod("de mars a juin 2026"), { start: "2026-03", end: "2026-06" });
  });

  it("parses a bare year", () => {
    assert.deepEqual(parsePeriod("rapport sur la couverture pour 2025"), { start: "2025-01", end: "2025-12" });
  });

  it("returns null when nothing matches", () => {
    assert.equal(parsePeriod("rapport performance abandon penta"), null);
  });
});

describe("heuristicPlan", () => {
  it("classifies stock prompts and keeps stock despite 'performance' wording", () => {
    assert.equal(heuristicPlan("rapport sur les ruptures de stock et la performance").reportType, "STOCK_STATUS");
  });

  it("classifies performance prompts", () => {
    assert.equal(heuristicPlan("rapport de couverture vaccinale Penta3").reportType, "PERFORMANCE");
  });

  it("detects audiences", () => {
    assert.equal(heuristicPlan("rapport destiné à la direction").audience, "EXECUTIVE");
    assert.equal(heuristicPlan("rapport pour Gavi").audience, "DONOR");
  });

  it("never plans a period ending after the current month", () => {
    const plan = heuristicPlan("rapport sur les 3 derniers mois");
    assert.ok(plan.period.end <= currentMonth());
  });
});

describe("sanitizePlan", () => {
  it("enforces the exact duration of 'les N derniers mois'", () => {
    const plan = sanitizePlan(
      { reportType: "STOCK_STATUS", period: { start: "2026-04", end: "2026-10" } },
      "rapport sur les ruptures sur les 6 derniers mois",
    );
    assert.equal(monthsBetween(plan.period.start, plan.period.end), 6);
  });

  it("drops organizations supplied as geographicScope by the LLM", () => {
    const plan = sanitizePlan(
      { reportType: "STOCK_STATUS", geographicScope: "Gavi", period: { start: "2026-01", end: "2026-03" } },
      "rapport de stock pour Gavi",
    );
    assert.equal(plan.geographicScope, undefined);
  });

  it("clamps future periods to the current month", () => {
    const plan = sanitizePlan(
      { reportType: "PERFORMANCE", period: { start: "2099-01", end: "2099-12" } },
      "rapport de performance",
    );
    assert.ok(plan.period.end <= currentMonth());
  });
});
