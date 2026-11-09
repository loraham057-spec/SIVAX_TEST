"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Dhis2AnalysisResult, Dhis2AnalysisRequest, AnalysisPayload } from "@/types";
import { dhis2Service } from "@/services";
import { useRegisterCommand } from "@/lib/agent/agent-provider";
import { useAssistant } from "@/store/assistant-store";
import type { AIProcessingStatus } from "@/lib/ai-processing";

interface AnalysisContextValue {
  analysis: Dhis2AnalysisResult | null;
  /** Decision Intelligence: structured payload from the agent */
  analysisPayload: AnalysisPayload | null;
  loading: boolean;
  error: string | null;
  /** Message de chargement dynamique basé sur la nature du prompt. */
  loadingMessage: string;
  /** Statut fonctionnel courant du pipeline IA. */
  processingStatus: AIProcessingStatus | null;
  runAnalysis: (req: Partial<Dhis2AnalysisRequest>) => Promise<string>;
  /** Inject a structured analysis payload directly from the agent (no DHIS2 re-query). */
  setAnalysisPayload: (payload: AnalysisPayload | null) => void;
  clearAnalysis: () => void;
}

const AnalysisContext = createContext<AnalysisContextValue | undefined>(undefined);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const { isTyping, loadingMessage, processingStatus } = useAssistant();
  const [analysis, setAnalysis] = useState<Dhis2AnalysisResult | null>(null);
  const [analysisPayload, setAnalysisPayloadState] = useState<AnalysisPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether we're in "pending" mode (prompt submitted, waiting for backend
  // to decide if an analysis command will be returned).
  const pendingRef = useRef(false);

  // Démarrer le loading immédiatement quand l'utilisateur soumet un prompt,
  // avant même que le backend ne réponde. Si une commande d'analyse est
  // renvoyée, runAnalysis() prend le relais. Sinon, le loading est annulé
  // quand isTyping repasse à false.
  useEffect(() => {
    if (isTyping) {
      pendingRef.current = true;
      setLoading(true);
      setError(null);
    } else if (pendingRef.current) {
      // Le backend a répondu et aucune commande d'analyse n'a été exécutée
      // (runAnalysis aurait remis pendingRef à false). On annule le loading.
      pendingRef.current = false;
      setLoading(false);
    }
  }, [isTyping]);

  const runAnalysis = useCallback(async (req: Partial<Dhis2AnalysisRequest>, llmInterpretation?: string): Promise<string> => {
    // Une vraie analyse prend le relais : on n'est plus en mode "pending".
    pendingRef.current = false;
    setLoading(true);
    setError(null);

    try {
      const result = await dhis2Service.runAnalysis(req, llmInterpretation);
      setAnalysis(result);
      // Legacy path renders through Dhis2AnalysisPanel only — clear any
      // structured payload so two divergent analyses are never shown together.
      setAnalysisPayloadState(null);

      if (result.status === "needs_clarification") {
        return result.interpretation;
      }

      const total = result.summary?.total ?? 0;
      const orgUnitCount = result.summary?.orgUnitCount ?? 0;
      const vizLabel = result.visualization === "kpi" ? "carte KPI" : result.visualization === "line" ? "courbe" : result.visualization === "bar" ? "graphique en barres" : result.visualization === "pie" ? "camembert" : "tableau";

      let reply = `Analyse terminée : ${result.title}. Total : ${total.toLocaleString("fr-FR")}. Affiché sous forme de ${vizLabel}`;
      if (orgUnitCount > 0) reply += ` sur ${orgUnitCount} unités géographiques`;
      reply += ".";
      if (result.warnings.length > 0) reply += ` ${result.warnings.join(" ")}`;

      return reply;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur d'analyse DHIS2";
      setError(msg);
      return `Erreur: ${msg}`;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearAnalysis = useCallback(() => {
    pendingRef.current = false;
    setAnalysis(null);
    setAnalysisPayloadState(null);
    setError(null);
  }, []);

  const setAnalysisPayload = useCallback((payload: AnalysisPayload | null) => {
    pendingRef.current = false;
    setAnalysisPayloadState(payload);
    setLoading(false);
    setError(null);
  }, []);

  useRegisterCommand("run_dhis2_analysis", async (args) => {
    // ─── Single-analysis architecture ────────────────────────
    // When the agent already ran the analysis server-side, it hands the
    // complete structured payload in the command args. Render it directly —
    // no second DHIS2/metric-search round-trip, no result divergence.
    const payload = args.analysisPayload as AnalysisPayload | undefined;
    if (payload && typeof payload === "object" && payload.metric && payload.verified_facts) {
      setAnalysis(null); // the legacy panel must not show stale/parallel results
      setAnalysisPayload(payload);
      const total = payload.summary?.total;
      return `Analyse terminée : ${payload.title ?? payload.metric.name}.${
        typeof total === "number" ? ` Total : ${total.toLocaleString("fr-FR")}.` : ""
      }`;
    }

    // ─── Legacy path (manual explorer / agent without payload) ──
    const req: Partial<Dhis2AnalysisRequest> = {
      question: String(args.question ?? ""),
      metricQuery: args.metricQuery ? String(args.metricQuery) : undefined,
      metricId: args.metricId ? String(args.metricId) : undefined,
      periodPreset: args.periodPreset as Dhis2AnalysisRequest["periodPreset"] | undefined,
      periods: Array.isArray(args.periods) ? args.periods.map(String) : undefined,
      orgUnitId: args.orgUnitId ? String(args.orgUnitId) : undefined,
      orgUnitLevel: args.orgUnitLevel === undefined ? undefined : Number(args.orgUnitLevel),
      targetOrgUnitLevel: args.targetOrgUnitLevel === undefined ? undefined : Number(args.targetOrgUnitLevel),
      visualization: args.visualization as Dhis2AnalysisRequest["visualization"] | undefined,
    };
    const llmInterpretation = args.llmInterpretation ? String(args.llmInterpretation) : undefined;
    return runAnalysis(req, llmInterpretation);
  });

  return (
    <AnalysisContext.Provider value={{ analysis, analysisPayload, loading, error, loadingMessage, processingStatus, runAnalysis, setAnalysisPayload, clearAnalysis }}>
      {children}
    </AnalysisContext.Provider>
  );
}

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider");
  return ctx;
}
