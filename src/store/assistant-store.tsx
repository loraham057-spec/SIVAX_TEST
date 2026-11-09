"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ChatMessage } from "@/types";
import { assistantService } from "@/services";
import { useAgent } from "@/lib/agent/agent-provider";
import { useAuth } from "@/lib/auth/auth-provider";
import { useTranslations } from "next-intl";
import type { AgentCommand } from "@/lib/agent/commands";
import type { AIProcessingStatus, AICompleteEvent } from "@/lib/ai-processing";
import { conversationService, type Conversation } from "@/lib/agent/conversations";
import { usePowerBIStore } from "@/store/powerbi-store";

// ─── SSE streaming helper ──────────────────────────────────

interface StreamParams {
  message: string;
  history?: ChatMessage[];
  executionFeedback?: Array<{ action: string; success: boolean; error?: string }>;
  lastAnalysisContext?: Record<string, unknown> | null;
  conversationId?: string | null;
  userId?: string | null;
  // The backend policy engine gates commands on the role; without it every
  // request is treated as a viewer and admin actions are refused upstream.
  userRole?: string | null;
  userEmail?: string | null;
  powerbiState?: {
    activePage: string | null;
    activePageDisplayName: string | null;
    filters: Array<{ table: string; column: string; operator: string; values: string[] }>;
    pages: Array<{ name: string; displayName: string }>;
    bookmarks: Array<{ name: string; displayName: string }>;
  } | null;
  onStatus?: (status: AIProcessingStatus) => void;
}

/**
 * Calls /api/assistant/stream and parses SSE events.
 * Returns the final AICompleteEvent when the "complete" event is received.
 */
async function streamAssistant(params: StreamParams): Promise<AICompleteEvent> {
  const response = await fetch("/api/assistant/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      history: params.history,
      executionFeedback: params.executionFeedback,
      lastAnalysisContext: params.lastAnalysisContext ?? null,
      conversationId: params.conversationId ?? null,
      userId: params.userId ?? null,
      userRole: params.userRole ?? null,
      userEmail: params.userEmail ?? null,
      powerbiState: params.powerbiState ?? null,
    }),
  });

  if (!response.ok || !response.body) {
    // Fallback to non-streaming endpoint
    const res = await assistantService.chat({
      message: params.message,
      history: params.history,
      executionFeedback: params.executionFeedback,
      userRole: params.userRole,
      userEmail: params.userEmail,
    });
    return res as unknown as AICompleteEvent;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE events from buffer
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      const lines = eventBlock.split("\n");
      let eventType = "";
      let dataStr = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        else if (line.startsWith("data: ")) dataStr += line.slice(6);
      }
      if (!eventType || !dataStr) continue;

      try {
        const data = JSON.parse(dataStr);
        if (eventType === "status" && data.status) {
          params.onStatus?.(data.status as AIProcessingStatus);
        } else if (eventType === "complete") {
          return data as AICompleteEvent;
        } else if (eventType === "error") {
          throw new Error(data.error ?? "Assistant streaming error");
        }
      } catch (parseErr) {
        // If JSON parse fails and it's not an error event, skip
        if (eventType === "error") throw parseErr;
      }
    }
  }

  // If we exit the loop without a complete event, throw
  throw new Error("Assistant stream ended without completion");
}

/** Maximum number of auto-correction retries when commands fail. */
const MAX_AUTO_CORRECTION_RETRIES = 2;

/**
 * Génère un titre condensé et intelligent de 4 à 6 mots à partir du message.
 *
 * Stratégie :
 * 1. Normalise le texte (accents, ponctuation, casse)
 * 2. Supprime les mots vides (articles, pronoms, verbes auxiliaires, politesse…)
 * 3. Préserve les entités clés (noms de maladies, antigènes, lieux, périodes)
 * 4. Détecte le verbe d'action principal et le place en premier si pertinent
 * 5. Capitalise la première lettre
 */
function generateTitle(content: string): string {
  // Mots vides FR/EN à ignorer
  const stopWords = new Set([
    // Articles
    "le", "la", "les", "un", "une", "des", "du", "de", "d", "l",
    "the", "a", "an",
    // Conjonctions
    "et", "ou", "mais", "donc", "or", "and", "but", "so", "yet", "nor",
    // Pronoms
    "je", "tu", "il", "elle", "nous", "vous", "ils", "elles", "on",
    "i", "you", "he", "she", "we", "they", "it", "me", "moi",
    "mon", "ma", "mes", "my", "your", "ton", "ta", "tes",
    "ce", "cette", "ces", "this", "that", "these", "those",
    // Prépositions
    "avec", "sans", "sur", "dans", "par", "pour", "vers",
    "with", "without", "by", "for", "to", "in", "on", "at", "from",
    // Modaux / auxiliaires
    "est", "sont", "été", "être", "ai", "as", "a", "avons", "avez", "ont",
    "is", "are", "was", "were", "be", "been", "being",
    "peux", "peut", "peuvent", "veux", "veut", "dois", "faut",
    "can", "could", "would", "should", "must", "may", "might",
    // Politesse
    "stp", "sil", "te", "plait", "plaît", "please", "thanks", "merci",
    // Question words (on garde la question implicite via le contexte)
    "que", "quoi", "qui", "comment", "pourquoi", "quand", "ou",
    "where", "when", "why", "how", "what", "which",
    // Divers
    "plus", "moins", "tres", "very", "more", "less", "much",
    "aussi", "also", "too",
  ]);

  // Verbes d'action à détecter (pour les placer en premier)
  const actionVerbs = new Set([
    "analyse", "analyser", "affiche", "afficher", "montre", "montrer",
    "donne", "donner", "calcule", "calculer", "compare", "comparer",
    "trace", "tracer", "genere", "generer", "visualise", "visualiser",
    "analyse", "analyze", "show", "display", "give", "calculate",
    "compare", "plot", "generate", "visualize", "filter", "filtre",
  ]);

  // Normalisation
  const cleaned = content
    .trim()
    .replace(/[?!.,;:«»""'()\[\]/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "Nouvelle conversation";

  // Tokenisation
  const allWords = cleaned.split(" ");

  // Filtrer les mots vides et trop courts
  const significant = allWords.filter(
    (w) => w.length >= 2 && !stopWords.has(w.toLowerCase()),
  );

  // Détecter un verbe d'action dans les premiers mots
  const actionIdx = significant.findIndex((w) => actionVerbs.has(w.toLowerCase()));
  let titleWords: string[];

  if (actionIdx >= 0 && actionIdx <= 2) {
    // Le verbe d'action est tôt dans la phrase — le mettre en premier
    const verb = significant[actionIdx];
    const rest = significant.filter((_, i) => i !== actionIdx);
    titleWords = [verb, ...rest].slice(0, 6);
  } else {
    // Pas de verbe d'action early — prendre les mots significatifs dans l'ordre
    titleWords = significant.slice(0, 6);
  }

  // Fallback : si rien de significatif, prendre les premiers mots bruts
  if (titleWords.length === 0) {
    titleWords = allWords.slice(0, 4);
  }

  // Si moins de 4 mots significatifs, compléter avec les mots bruts restants
  if (titleWords.length < 4) {
    const used = new Set(titleWords.map((w) => w.toLowerCase()));
    for (const w of allWords) {
      if (titleWords.length >= 6) break;
      if (!used.has(w.toLowerCase())) {
        titleWords.push(w);
        used.add(w.toLowerCase());
      }
    }
  }

  // Construire le titre
  let title = titleWords.join(" ");

  // Capitaliser la première lettre
  title = title.charAt(0).toUpperCase() + title.slice(1);

  // Limiter la longueur totale (sécurité)
  if (title.length > 60) {
    title = title.slice(0, 57).trim() + "…";
  }

  return title;
}

interface AssistantContextValue {
  isOpen: boolean;
  messages: ChatMessage[];
  isTyping: boolean;
  error: string | null;
  /** Message de chargement dynamique basé sur la nature du prompt. */
  loadingMessage: string;
  /** Statut fonctionnel courant du pipeline IA (pour l'animation de progression). */
  processingStatus: AIProcessingStatus | null;
  /** Conversation active (null = nouvelle conversation non persistée). */
  activeConversationId: string | null;
  /** Titre de la conversation active. */
  activeConversationTitle: string | null;
  /** Liste des conversations de l'utilisateur. */
  conversations: Conversation[];
  /** Indique si l'historique est en cours de chargement. */
  isLoadingHistory: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  sendMessage: (content: string) => void;
  clearMessages: () => void;
  /** Crée une nouvelle conversation vide. */
  newConversation: () => void;
  /** Charge une conversation existante. */
  loadConversation: (id: string) => void;
  /** Rafraîchit la liste des conversations. */
  refreshConversations: () => Promise<void>;
  /** Supprime définitivement une conversation (et ses messages). */
  deleteConversation: (id: string) => Promise<void>;
}

const AssistantContext = createContext<AssistantContextValue | undefined>(undefined);

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "msg-welcome",
    role: "assistant",
    content:
      "Hello! I'm your SIVAX assistant. I can navigate the platform, filter alerts, modify your settings, manage users, and much more. How can I help you?",
    timestamp: new Date(0),
  },
];

/**
 * Détecte la nature du prompt et renvoie un message de chargement adapté.
 * Mots-clés en français et anglais. Utilise le translator i18n pour la locale courante.
 */
function detectLoadingMessage(prompt: string, t: (key: string) => string): string {
  const p = prompt.toLowerCase();

  // ─── Analyse de données ───
  const analysisKeywords = [
    "combien", "nombre", "taux", "couverture", "statistique", "statistiques",
    "cas", "donnée", "données", "analyse", "évolution", "tendance", "comparaison",
    "indicateur", "indicateurs", "paludisme", "palu", "malaria", "vaccination",
    "vaccin", "bcg", "dtc", "rougeole", "polio", "fièvre", "fievre", "jaune",
    "maternelle", "maternité", "nutrition", "accouchement", "cpn", "périmètre",
    "mortalité", "morbidity", "incidence", "prévalence", "district", "zone",
    "province", "centre", "hôpital", "hopital", "formation sanitaire",
    "count", "rate", "coverage", "data", "analysis", "trend", "compare",
    "indicator", "vaccine", "measles", "polio", "yellow fever",
  ];
  if (analysisKeywords.some((kw) => p.includes(kw))) {
    return t("analysis");
  }

  // ─── Navigation ───
  const navKeywords = [
    "va ", "aller", "ouvre", "ouvrir", "page", "onglet", "navigue", "naviguer",
    "affiche", "montrer", "go to", "open", "navigate", "settings", "paramètres",
    "parametre", "alerts", "alertes", "notifications", "help", "aide",
    "documentation", "dashboard", "tableau de bord", "retour",
  ];
  if (navKeywords.some((kw) => p.includes(kw))) {
    return t("navigation");
  }

  // ─── Paramètres / Actions ───
  const actionKeywords = [
    "modifie", "modifier", "changer", "change", "thème", "theme", "dark",
    "light", "sombre", "clair", "créer", "create", "utilisateur", "user",
    "supprimer", "delete", "profil", "profile", "sécurité", "securite",
    "security", "déconnexion", "logout", "rafraîchir", "refresh",
  ];
  if (actionKeywords.some((kw) => p.includes(kw))) {
    return t("action");
  }

  // ─── Information / Question générale ───
  return t("default");
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { register, executeAll } = useAgent();
  const { user } = useAuth();
  const tLoading = useTranslations("loading");
  const tAssistant = useTranslations("assistant");
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("Traitement de votre demande en cours…");
  const [processingStatus, setProcessingStatus] = useState<AIProcessingStatus | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  // Analysis context from the last successful analysis — sent back to the
  // backend in follow-up requests so the agent can resolve references like
  // "montre l'évolution de ce nombre" or "et pour Kinshasa ?".
  const [lastAnalysisContext, setLastAnalysisContext] = useState<Record<string, unknown> | null>(null);

  // Update welcome message when locale changes.
  useEffect(() => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === "msg-welcome" ? { ...m, content: tAssistant("welcome") } : m
      )
    );
  }, [tAssistant]);

  // ─── Load conversation list when user is available ──────
  const refreshConversations = useCallback(async () => {
    if (!user) return;
    try {
      const list = await conversationService.list();
      setConversations(list);
    } catch {
      // Silently fail — history is optional
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      void refreshConversations();
    }
  }, [user, refreshConversations]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev: boolean) => !prev), []);

  // Register open/close assistant handlers with the agent.
  useEffect(() => {
    const unregisterOpen = register("open_assistant", () => {
      setIsOpen(true);
    });
    const unregisterClose = register("close_assistant", () => {
      setIsOpen(false);
    });
    return () => {
      unregisterOpen();
      unregisterClose();
    };
  }, [register]);

  const sendMessage = useCallback(
    (content: string) => {
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content,
        timestamp: new Date(),
      };
      setMessages((prev: ChatMessage[]) => [...prev, userMessage]);
      setIsTyping(true);
      setError(null);
      setLoadingMessage(detectLoadingMessage(content, tLoading));
      setProcessingStatus("analyzing");

      // ─── Persist user message ────────────────────────────
      let convId = activeConversationId;
      const persistUserMessage = async () => {
        if (!user) return;
        try {
          // Create conversation on first message
          if (!convId) {
            const title = generateTitle(content);
            convId = await conversationService.create(user.id, title);
            setActiveConversationId(convId);
            setActiveConversationTitle(title);
            void refreshConversations();
          }
          await conversationService.addMessage(convId, {
            role: "user",
            content,
          });
        } catch (err) {
          console.error("[assistant] persist user message failed:", err);
        }
      };
      void persistUserMessage();

      // Build conversation history (exclude welcome message and the just-added user message)
      const history = messages
        .filter((m) => m.id !== "msg-welcome")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));

      // ─── SSE streaming + auto-correction loop ─────────────
      const runWithAutoCorrection = async () => {
        let executionFeedback: Array<{ action: string; success: boolean; error?: string }> | undefined;
        let finalReply = "";
        let finalSuggestions: string[] | undefined;
        let hasAnalysisCommand = false;
        let lastRes: AICompleteEvent | null = null;

        for (let attempt = 0; attempt <= MAX_AUTO_CORRECTION_RETRIES; attempt++) {
          // ─── Stream request via SSE ──────────────────────
          const res = await streamAssistant({
            message: content,
            history,
            executionFeedback,
            lastAnalysisContext,
            conversationId: convId,
            userId: user?.id ?? null,
            userRole: user?.role ?? null,
            userEmail: user?.email ?? null,
            powerbiState: usePowerBIStore.getState().state,
            onStatus: (status) => setProcessingStatus(status),
          });
          lastRes = res;

          const commands: AgentCommand[] = (res as { commands?: AgentCommand[] }).commands ?? [];
          finalSuggestions = (res as { suggestions?: string[] }).suggestions;

          // If no commands, we're done — the LLM answered with text only
          if (commands.length === 0) {
            finalReply = res.reply || "Action effectuée.";
            break;
          }

          // ─── Enrichir les commandes avec les résultats du backend ──
          // Architecture "analyse unique" : le backend a déjà exécuté l'analyse
          // DHIS2 (Supabase-first) et renvoie le payload structuré complet.
          // On le passe tel quel dans la commande — le frontend le rend
          // directement, sans relancer d'analyse (métrique, données et
          // interprétation restent parfaitement cohérentes).
          const backendResults = (res as { results?: Array<{ action: string; result?: { metric?: { id: string }; verified_facts?: Record<string, unknown> } }> }).results ?? [];
          const dhis2Result = backendResults.find((r) => r.action === "run_dhis2_analysis");
          const backendMetricId = dhis2Result?.result?.metric?.id;
          const backendPayload = res.analysis_payload;
          const llmReply = res.reply;

          const enrichedCommands = commands.map((cmd) => {
            if (cmd.action === "run_dhis2_analysis") {
              return {
                ...cmd,
                args: {
                  ...cmd.args,
                  ...(backendPayload ? { analysisPayload: backendPayload } : {}),
                  ...(backendMetricId ? { metricId: backendMetricId } : {}),
                  ...(llmReply ? { llmInterpretation: llmReply } : {}),
                },
              };
            }
            return cmd;
          });

          // Commands received — execute them
          setProcessingStatus("processing_data");
          const execResults = await executeAll(enrichedCommands);

          // Check for failures
          const failures = execResults.filter((r) => !r.success);
          const successes = execResults.filter((r) => r.success);

          // Détecter si une analyse DHIS2 a été exécutée avec succès
          if (enrichedCommands.some((c) => c.action === "run_dhis2_analysis")) {
            hasAnalysisCommand = true;
          }

          if (failures.length === 0) {
            // All commands succeeded
            setProcessingStatus("completed");
            finalReply = res.reply || successes.map((r) => r.message).join(" ") || "Action effectuée.";
            break;
          }

          // Some commands failed — prepare feedback for retry
          executionFeedback = execResults.map((r) => ({
            action: r.action,
            success: r.success,
            error: r.error,
          }));

          // Use the LLM's reply as the base, but we'll retry
          finalReply = res.reply || "";

          // If this was the last attempt, keep the partial result
          if (attempt === MAX_AUTO_CORRECTION_RETRIES) {
            const failureMsg = failures
              .map((f) => `${f.action}: ${f.error}`)
              .join("; ");
            finalReply = `${finalReply}\n\n⚠️ Certaines actions ont échoué après ${MAX_AUTO_CORRECTION_RETRIES + 1} tentatives: ${failureMsg}`;
            break;
          }

          // Update status to show retry
          setProcessingStatus("retrying");
          setLoadingMessage(tLoading("retrying"));
        }

        setProcessingStatus(null);

        // ─── Structured clarification options & follow-up chips ──
        // When the agent asks a structured clarification, render its options
        // as clickable suggestions (the click sends the option label, which
        // the backend matches deterministically against the pending slot).
        // After a successful analysis, render deterministic follow-up
        // suggestions (deepening: breakdown, trend, diagnosis...).
        const clarificationReq = lastRes?.clarification_request;
        if (clarificationReq?.options?.length) {
          finalSuggestions = clarificationReq.options.map((o) => o.label);
        } else if (!finalSuggestions?.length) {
          const followups = lastRes?.analysis_payload?.suggested_followups;
          if (followups?.length) {
            finalSuggestions = followups.map((f) => f.message);
          }
        }

        // ─── Store analysis context for follow-up requests ──
        // The backend returns the context (indicator, geography, periods)
        // from the last analysis. We send it back in the next request so
        // the agent can resolve references like "ce nombre" or "cette province".
        const analysisCtx = (lastRes as { analysisContext?: Record<string, unknown> | null })?.analysisContext;
        if (analysisCtx && typeof analysisCtx === "object" && Object.keys(analysisCtx).length > 0) {
          setLastAnalysisContext(analysisCtx);
        } else if (!hasAnalysisCommand) {
          // Non-analysis response — clear the context so it doesn't leak
          setLastAnalysisContext(null);
        }

        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}-ai`,
          role: "assistant",
          content: finalReply || "Action effectuée.",
          timestamp: new Date(),
          suggestions: finalSuggestions,
        };
        setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);

        // ─── Persist assistant message ─────────────────────
        if (user && convId) {
          try {
            await conversationService.addMessage(convId, {
              role: "assistant",
              content: assistantMessage.content,
              suggestions: finalSuggestions,
            });
            void refreshConversations();
          } catch {
            // Persistence is optional
          }
        }
      };

      runWithAutoCorrection()
        .catch((err: Error) => {
          setError(err.message);
          setProcessingStatus("error");
          // Distinguish backend application errors from connectivity issues.
          // The SSE error event wraps any backend exception (including
          // TypeErrors) as its `error` field, so a Python traceback like
          // "unhashable type: 'list'" is NOT a connection problem.
          const isConnectionError = /fetch|network|ECONNREFUSED|timeout|Failed to fetch/i.test(
            err.message,
          );
          const fallback: ChatMessage = {
            id: `msg-${Date.now()}-ai`,
            role: "assistant",
            content: isConnectionError
              ? `I couldn't connect to the AI backend. Please ensure the Next.js server is running and LLM keys are configured. Error: ${err.message}`
              : `The AI backend encountered an error while processing your request. Error: ${err.message}`,
            timestamp: new Date(),
          };
          setMessages((prev: ChatMessage[]) => [...prev, fallback]);
        })
        .finally(() => {
          setIsTyping(false);
          setProcessingStatus(null);
        });
    },
    [executeAll, messages, tLoading, user, activeConversationId, refreshConversations]
  );

  const clearMessages = useCallback(() => {
    setMessages(INITIAL_MESSAGES);
    setError(null);
    setActiveConversationId(null);
    setActiveConversationTitle(null);
  }, []);

  const newConversation = useCallback(() => {
    setMessages(INITIAL_MESSAGES);
    setError(null);
    setActiveConversationId(null);
    setActiveConversationTitle(null);
    setProcessingStatus(null);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    setIsLoadingHistory(true);
    setError(null);
    try {
      const loadedMessages = await conversationService.loadMessages(id);
      const conv = conversations.find((c) => c.id === id);
      setActiveConversationId(id);
      setActiveConversationTitle(conv?.title ?? null);

      // Prepend welcome message, then loaded messages
      const welcome = INITIAL_MESSAGES[0];
      setMessages([welcome, ...loadedMessages]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load conversation";
      setError(msg);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [conversations]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await conversationService.delete(id);
      // Si la conversation supprimée était active, réinitialiser
      if (id === activeConversationId) {
        setActiveConversationId(null);
        setActiveConversationTitle(null);
        setMessages(INITIAL_MESSAGES);
      }
      await refreshConversations();
    } catch (err) {
      console.error("[assistant] deleteConversation failed:", err);
    }
  }, [activeConversationId, refreshConversations]);

  return (
    <AssistantContext.Provider
      value={{
        isOpen,
        messages,
        isTyping,
        error,
        loadingMessage,
        processingStatus,
        activeConversationId,
        activeConversationTitle,
        conversations,
        isLoadingHistory,
        open,
        close,
        toggle,
        sendMessage,
        clearMessages,
        newConversation,
        loadConversation,
        refreshConversations,
        deleteConversation,
      }}
    >
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
}
