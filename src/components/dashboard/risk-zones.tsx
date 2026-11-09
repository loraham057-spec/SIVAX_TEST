"use client";

import { useEffect, useState, useMemo } from "react";
import { ShieldAlert, AlertTriangle, ShieldCheck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Risk Zones — province risk scores with factor breakdown.
 *
 * This space answers: which provinces are most at risk?
 * Shows: risk score ranking + factor contributions + methodology.
 *
 * The risk score is computed client-side from province data
 * (same formula as backend/app/tools/risk_scorer.py).
 */

interface ProvinceData {
  indicator_id: string;
  label: string;
  unit: string;
  domain: string;
  org_unit_id: string;
  org_unit_name: string;
  latest_period: string;
  latest_value: number;
}

const RISK_INDICATORS = {
  coverage_penta3: "v9b9aYsA5PM",
  dropout_penta1_penta3: "MULXtL8iom8",
  coverage_bcg: "cWJXYKCXrLx",
  sous_vaccines: "RMHgIqfBG7N",
};

const WEIGHTS = {
  coverage_penta3: 0.30,
  dropout_penta1_penta3: 0.25,
  coverage_bcg: 0.15,
  sous_vaccines: 0.10,
};

function normalize01(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function normalizeInverse01(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (max - value) / (max - min)));
}

function riskLevel(score: number): { label: string; color: string; icon: typeof ShieldAlert } {
  if (score >= 70) return { label: "Critique", color: "text-rose-600 bg-rose-500/10", icon: ShieldAlert };
  if (score >= 50) return { label: "Élevé", color: "text-amber-600 bg-amber-500/10", icon: AlertTriangle };
  if (score >= 30) return { label: "Modéré", color: "text-blue-600 bg-blue-500/10", icon: AlertTriangle };
  return { label: "Faible", color: "text-emerald-600 bg-emerald-500/10", icon: ShieldCheck };
}

export function RiskZones() {
  const [loading, setLoading] = useState(true);
  const [provinces, setProvinces] = useState<ProvinceData[]>([]);

  useEffect(() => {
    let active = true;
    fetch("/api/provinces?domain=vaccination")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setProvinces(data ?? []);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const riskScores = useMemo(() => {
    // Group by org_unit
    const byProvince: Record<string, { name: string; values: Record<string, number> }> = {};
    for (const p of provinces) {
      if (!byProvince[p.org_unit_id]) {
        byProvince[p.org_unit_id] = { name: p.org_unit_name, values: {} };
      }
      byProvince[p.org_unit_id].values[p.indicator_id] = p.latest_value;
    }

    // Find max sous-vaccinés for relative normalization
    const svValues = Object.values(byProvince)
      .map((p) => p.values[RISK_INDICATORS.sous_vaccines])
      .filter((v) => v !== undefined);
    const svMax = svValues.length > 0 ? Math.max(...svValues) : 1;

    // Compute scores
    const scores = Object.entries(byProvince).map(([id, prov]) => {
      const vals = prov.values;
      const factors: Record<string, { value: number; contribution: number }> = {};
      let weightedSum = 0;
      let totalWeight = 0;

      const penta3 = vals[RISK_INDICATORS.coverage_penta3];
      if (penta3 !== undefined) {
        const norm = normalizeInverse01(penta3, 0, 100);
        const contribution = norm * WEIGHTS.coverage_penta3;
        factors.coverage_penta3 = { value: penta3, contribution };
        weightedSum += contribution;
        totalWeight += WEIGHTS.coverage_penta3;
      }

      const dropout = vals[RISK_INDICATORS.dropout_penta1_penta3];
      if (dropout !== undefined) {
        const norm = normalize01(dropout, 0, 30);
        const contribution = norm * WEIGHTS.dropout_penta1_penta3;
        factors.dropout_penta1_penta3 = { value: dropout, contribution };
        weightedSum += contribution;
        totalWeight += WEIGHTS.dropout_penta1_penta3;
      }

      const bcg = vals[RISK_INDICATORS.coverage_bcg];
      if (bcg !== undefined) {
        const norm = normalizeInverse01(bcg, 0, 100);
        const contribution = norm * WEIGHTS.coverage_bcg;
        factors.coverage_bcg = { value: bcg, contribution };
        weightedSum += contribution;
        totalWeight += WEIGHTS.coverage_bcg;
      }

      const sv = vals[RISK_INDICATORS.sous_vaccines];
      if (sv !== undefined && svMax > 0) {
        const norm = Math.min(1, sv / svMax);
        const contribution = norm * WEIGHTS.sous_vaccines;
        factors.sous_vaccines = { value: sv, contribution };
        weightedSum += contribution;
        totalWeight += WEIGHTS.sous_vaccines;
      }

      const score = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 50;
      return {
        id,
        name: prov.name,
        score: Math.round(score * 10) / 10,
        factors,
        missing: [
          ...(!factors.coverage_penta3 ? ["Penta3"] : []),
          ...(!factors.dropout_penta1_penta3 ? ["Dropout"] : []),
          ...(!factors.coverage_bcg ? ["BCG"] : []),
          ...(!factors.sous_vaccines ? ["Sous-vaccinés"] : []),
        ],
      };
    });

    return scores.sort((a, b) => b.score - a.score);
  }, [provinces]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  if (provinces.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border bg-card">
        <p className="text-sm text-muted-foreground">
          Données de province en cours de synchronisation.
        </p>
      </div>
    );
  }

  const critical = riskScores.filter((s) => s.score >= 70);
  const high = riskScores.filter((s) => s.score >= 50 && s.score < 70);

  return (
    <div className="space-y-4">
      {/* ─── Summary bar ─── */}
      <div className="flex items-center gap-4 rounded-lg border bg-card p-3 text-xs">
        <span className="font-medium">Score de risque par province</span>
        <span className="text-rose-600 font-medium">{critical.length} critique(s)</span>
        <span className="text-amber-600 font-medium">{high.length} élevé(s)</span>
        <span className="text-muted-foreground">{riskScores.length} provinces au total</span>
      </div>

      {/* ─── Risk ranking table ─── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">Classement des provinces par risque</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">#</th>
                <th className="pb-2 pr-4 font-medium">Province</th>
                <th className="pb-2 pr-4 font-medium">Score</th>
                <th className="pb-2 pr-4 font-medium">Niveau</th>
                <th className="pb-2 pr-4 font-medium">Penta3</th>
                <th className="pb-2 pr-4 font-medium">Dropout</th>
                <th className="pb-2 pr-4 font-medium">BCG</th>
                <th className="pb-2 font-medium">Facteurs manquants</th>
              </tr>
            </thead>
            <tbody>
              {riskScores.map((s, i) => {
                const level = riskLevel(s.score);
                const Icon = level.icon;
                return (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4 font-medium">{s.name}</td>
                    <td className="py-2 pr-4">
                      <span className="text-base font-bold">{s.score}</span>
                      <span className="text-[10px] text-muted-foreground">/100</span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", level.color)}>
                        <Icon className="h-3 w-3" />
                        {level.label}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {s.factors.coverage_penta3 ? `${s.factors.coverage_penta3.value.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {s.factors.dropout_penta1_penta3 ? `${s.factors.dropout_penta1_penta3.value.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {s.factors.coverage_bcg ? `${s.factors.coverage_bcg.value.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {s.missing.length > 0 ? s.missing.join(", ") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Methodology ─── */}
      <div className="rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground">
        <h4 className="mb-2 font-medium text-foreground">Méthodologie du score de risque</h4>
        <p className="mb-2">
          Score = moyenne pondérée de 4 facteurs normalisés [0-1] × 100:
        </p>
        <ul className="ml-4 space-y-1">
          <li>• Couverture Penta3 (poids {WEIGHTS.coverage_penta3 * 100}%): faible = risque élevé</li>
          <li>• Abandon Penta1-Penta3 (poids {WEIGHTS.dropout_penta1_penta3 * 100}%): élevé = risque élevé</li>
          <li>• Couverture BCG (poids {WEIGHTS.coverage_bcg * 100}%): faible = risque élevé</li>
          <li>• Sous-vaccinés (poids {WEIGHTS.sous_vaccines * 100}%): nombre élevé = risque élevé</li>
        </ul>
        <p className="mt-2">
          Niveaux: 0-29 = faible, 30-49 = modéré, 50-69 = élevé, 70-100 = critique.
          Le score est transparent et explicable par facteur.
        </p>
      </div>
    </div>
  );
}
