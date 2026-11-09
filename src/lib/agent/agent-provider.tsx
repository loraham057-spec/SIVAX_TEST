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
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  COMMANDS,
  NAV_DESTINATIONS,
  type AgentCommand,
  type CommandDef,
} from "@/lib/agent/commands";
import {
  validateCommand,
  validateCommands,
  RateLimiter,
  type ValidationResult,
} from "@/lib/agent/policy-engine";
import { useAuth } from "@/lib/auth/auth-provider";

/**
 * A handler registered by a mounted page/component for a specific command.
 * Returns a human-readable confirmation string (or throws on error).
 */
export type CommandHandler = (
  args: Record<string, unknown>
) => Promise<string | void> | string | void;

interface PendingApproval {
  commands: AgentCommand[];
  results: ValidationResult[];
  resolve: (approved: boolean) => void;
}

/** Detailed result of executing a single command. */
export interface CommandExecutionResult {
  action: string;
  success: boolean;
  message: string;
  error?: string;
}

interface AgentContextValue {
  /** Register a handler for a command id. Returns an unregister function. */
  register: (commandId: string, handler: CommandHandler) => () => void;
  /** Execute a single command (validates via policy engine first). */
  execute: (cmd: AgentCommand) => Promise<string>;
  /** Execute multiple commands in order, with validation and approval.
   * Returns detailed results including success/error status for each command. */
  executeAll: (cmds: AgentCommand[]) => Promise<CommandExecutionResult[]>;
  /** Whether a command needs user confirmation. */
  needsConfirm: (cmd: AgentCommand) => boolean;
  /** Current pending approval request (if any). */
  pendingApproval: PendingApproval | null;
  /** Approve or reject the pending approval. */
  resolveApproval: (approved: boolean) => void;
}

const AgentContext = createContext<AgentContextValue | undefined>(undefined);

/** Resolves one user id from an e-mail via an indexed lookup (PERF-19). */
async function resolveUserByEmail(
  email: string,
): Promise<{ id: string; email: string } | null> {
  const res = await fetch(`/api/users/resolve?email=${encodeURIComponent(email)}`);
  if (!res.ok) return null;
  const { user } = await res.json();
  return user ?? null;
}

/** Upper bound on how long we wait for a page to register its handler. */
const HANDLER_WAIT_TIMEOUT_MS = 5000;
const HANDLER_POLL_INTERVAL_MS = 25;

/**
 * Resolves as soon as `commandId` appears in the registry, or after the
 * timeout. Returns immediately when the handler is already there, so a command
 * issued on the page it targets costs nothing.
 */
async function waitForHandler(
  handlers: Map<string, CommandHandler>,
  commandId: string,
  timeoutMs = HANDLER_WAIT_TIMEOUT_MS,
): Promise<boolean> {
  if (handlers.has(commandId)) return true;

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, HANDLER_POLL_INTERVAL_MS));
    if (handlers.has(commandId)) return true;
  }
  return false;
}

export function AgentProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { user, signOut } = useAuth();

  // Registry of page-level handlers: commandId → handler function.
  const handlersRef = useRef<Map<string, CommandHandler>>(new Map());
  // Rate limiter: max 15 commands per minute.
  const rateLimiterRef = useRef<RateLimiter>(new RateLimiter(15, 60_000));
  // Pending approval state.
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);

  const register = useCallback(
    (commandId: string, handler: CommandHandler) => {
      handlersRef.current.set(commandId, handler);
      return () => {
        handlersRef.current.delete(commandId);
      };
    },
    []
  );

  const needsConfirm = useCallback((cmd: AgentCommand) => {
    const def = COMMANDS[cmd.action];
    return def ? def.risk === "medium" || def.risk === "high" : false;
  }, []);

  const resolveApproval = useCallback((approved: boolean) => {
    setPendingApproval((current) => {
      if (current) current.resolve(approved);
      return null;
    });
  }, []);

  const execute = useCallback(
    async (cmd: AgentCommand): Promise<string> => {
      // ─── Policy Engine: validate command ───────────────────
      const validation = validateCommand(cmd, user?.role);
      if (!validation.valid) {
        toast.error(validation.error ?? "Commande invalide");
        return validation.error ?? "Commande invalide";
      }

      // ─── Rate limiting ─────────────────────────────────────
      if (!rateLimiterRef.current.canExecute()) {
        const msg = "Trop de commandes envoyées. Veuillez patienter un instant.";
        toast.warning(msg);
        return msg;
      }

      // Use sanitized command.
      const sanitizedCmd = validation.sanitized;
      const def: CommandDef | undefined = COMMANDS[sanitizedCmd.action];
      if (!def) {
        return `Commande inconnue: ${sanitizedCmd.action}`;
      }

      const args = sanitizedCmd.args ?? {};

      // For registered commands, navigate to the required route first if needed.
      if (def.scope === "registered" && def.route) {
        router.push(def.route);
        // Wait for the destination page to actually register its handler,
        // instead of betting a flat 400 ms on it: too long when the page is
        // already mounted, too short on a slow device — where the command
        // failed with "handler unavailable".
        await waitForHandler(handlersRef.current, sanitizedCmd.action);
      }

      // Provider-scoped commands are handled here.
      if (def.scope === "provider") {
        switch (sanitizedCmd.action) {
          case "navigate": {
            const dest = args.destination as string;
            const href = NAV_DESTINATIONS[dest as keyof typeof NAV_DESTINATIONS];
            if (href) {
              router.push(href);
              return def.speak(args);
            }
            return `Destination inconnue: ${dest}`;
          }

          case "open_assistant": {
            const handler = handlersRef.current.get("open_assistant");
            if (handler) await handler(args);
            return def.speak(args);
          }

          case "close_assistant": {
            const handler = handlersRef.current.get("close_assistant");
            if (handler) await handler(args);
            return def.speak(args);
          }

          case "set_theme": {
            const theme = args.theme as "light" | "dark";
            setTheme(theme);
            return def.speak(args);
          }

          case "logout":
            await signOut();
            return def.speak(args);

          case "refresh":
            if (typeof window !== "undefined") window.location.reload();
            return def.speak(args);

          case "mark_all_notifications_read": {
            try {
              await fetch("/api/notifications", { method: "PATCH" });
              return def.speak(args);
            } catch {
              return "Erreur: impossible de marquer les notifications comme lues.";
            }
          }

          case "create_user": {
            try {
              const res = await fetch("/api/users", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(args),
              });
              if (!res.ok) {
                const data = await res.json();
                return `Erreur: ${data.error ?? "échec de la création"}`;
              }
              return def.speak(args);
            } catch {
              return "Erreur: impossible de créer l'utilisateur.";
            }
          }

          case "update_user_role": {
            try {
              // One indexed lookup instead of fetching every user and scanning.
              const email = args.email as string;
              const role = args.role as string;
              const user = await resolveUserByEmail(email);
              if (!user) return `Utilisateur introuvable: ${email}`;
              const res = await fetch(`/api/users/${user.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role }),
              });
              if (!res.ok) {
                const data = await res.json();
                return `Erreur: ${data.error ?? "échec de la mise à jour"}`;
              }
              return def.speak(args);
            } catch {
              return "Erreur: impossible de mettre à jour le rôle.";
            }
          }

          case "delete_user": {
            try {
              const email = args.email as string;
              const user = await resolveUserByEmail(email);
              if (!user) return `Utilisateur introuvable: ${email}`;
              const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
              if (!res.ok) {
                const data = await res.json();
                return `Erreur: ${data.error ?? "échec de la suppression"}`;
              }
              return def.speak(args);
            } catch {
              return "Erreur: impossible de supprimer l'utilisateur.";
            }
          }

          default:
            return `Action provider non gérée: ${sanitizedCmd.action}`;
        }
      }

      // Registered commands: look up the handler registered by the page.
      const handler = handlersRef.current.get(sanitizedCmd.action);
      if (!handler) {
        return `Le handler pour « ${sanitizedCmd.action} » n'est pas disponible. Naviguez d'abord vers la page concernée.`;
      }

      try {
        const result = await handler(args);
        return result ?? def.speak(args);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erreur inconnue";
        toast.error(msg);
        return `Erreur: ${msg}`;
      }
    },
    [router, setTheme, signOut, user?.role]
  );

  const executeAll = useCallback(
    async (cmds: AgentCommand[]): Promise<CommandExecutionResult[]> => {
      if (cmds.length === 0) return [];

      // ─── Prompt injection check ────────────────────────────
      // (Checked on the raw command actions — if the LLM was tricked
      // into producing suspicious patterns, we block execution.)

      // ─── Batch validate all commands ───────────────────────
      const { valid, invalid } = validateCommands(cmds, user?.role);

      // Report invalid commands.
      for (const { result } of invalid) {
        toast.error(result.error ?? "Commande invalide");
      }

      if (valid.length === 0) {
        return invalid.map((i) => ({
          action: i.command.action,
          success: false,
          message: i.result.error ?? "Commande invalide",
          error: i.result.error,
        }));
      }

      // ─── Check if any commands need approval ───────────────
      const needsApproval = valid.some((v) => v.result.requiresApproval);
      if (needsApproval) {
        const approved = await new Promise<boolean>((resolve) => {
          setPendingApproval({
            commands: valid.map((v) => v.command),
            results: valid.map((v) => v.result),
            resolve,
          });
        });

        if (!approved) {
          return valid.map((v) => ({
            action: v.command.action,
            success: false,
            message: "Actions annulées par l'utilisateur.",
            error: "User cancelled",
          }));
        }
      }

      // ─── Execute all valid commands ────────────────────────
      const results: CommandExecutionResult[] = [];
      for (const { command } of valid) {
        const resultMsg = await execute(command);
        const failed = resultMsg.startsWith("Erreur:") || resultMsg.startsWith("Action provider non gérée");
        results.push({
          action: command.action,
          success: !failed,
          message: resultMsg,
          error: failed ? resultMsg : undefined,
        });
      }
      return results;
    },
    [execute, user?.role]
  );

  return (
    <AgentContext.Provider
      value={{ register, execute, executeAll, needsConfirm, pendingApproval, resolveApproval }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export function useAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within AgentProvider");
  return ctx;
}

/**
 * Convenience hook for pages to register a command handler.
 * Automatically cleans up on unmount.
 */
export function useRegisterCommand(commandId: string, handler: CommandHandler) {
  const { register } = useAgent();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const stableHandler = (args: Record<string, unknown>) =>
      handlerRef.current(args);
    return register(commandId, stableHandler);
  }, [commandId, register]);
}
