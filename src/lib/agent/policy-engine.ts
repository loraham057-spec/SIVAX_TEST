/**
 * Policy Engine — validation layer between LLM output and command execution.
 *
 * Every command produced by the LLM must pass through this engine before
 * the AgentProvider executes it. The engine performs:
 *
 * 1. Schema validation — required fields present, types correct, enum values valid.
 * 2. Authorization    — the user's role has the required permission.
 * 3. Risk assessment  — classifies the command as low / medium / high risk.
 * 4. Input sanitization — strips unexpected fields, trims strings.
 *
 * The engine returns a ValidationResult that the AgentProvider uses to decide
 * whether to auto-execute, request confirmation, or reject the command.
 */

import {
  COMMANDS,
  type AgentCommand,
  type CommandDef,
  type RiskLevel,
  type RequiredPermission,
} from "@/lib/agent/commands";
import { hasPermission, type UserRole } from "@/lib/auth/types";

export interface ValidationResult {
  valid: boolean;
  risk: RiskLevel;
  /** Sanitized command (unexpected args removed, strings trimmed). */
  sanitized: AgentCommand;
  /** Error message if invalid. */
  error?: string;
  /** Whether the command requires user confirmation before execution. */
  requiresApproval: boolean;
  /** Human-readable description of what the command will do. */
  description: string;
}

/**
 * Validate a single command against the policy engine.
 */
export function validateCommand(
  cmd: AgentCommand,
  userRole: UserRole | undefined | null
): ValidationResult {
  const def: CommandDef | undefined = COMMANDS[cmd.action];

  // ─── 1. Unknown command ───────────────────────────────────
  if (!def) {
    return {
      valid: false,
      risk: "high",
      sanitized: cmd,
      requiresApproval: false,
      description: `Commande inconnue: ${cmd.action}`,
      error: `Unknown command: ${cmd.action}`,
    };
  }

  const args = cmd.args ?? {};

  // ─── 2. Schema validation ─────────────────────────────────
  const schemaError = validateSchema(def, args);
  if (schemaError) {
    return {
      valid: false,
      risk: def.risk,
      sanitized: cmd,
      requiresApproval: false,
      description: def.speak(args),
      error: schemaError,
    };
  }

  // ─── 3. Authorization ─────────────────────────────────────
  if (def.permission) {
    const allowed = hasPermission(userRole, def.permission as Parameters<typeof hasPermission>[1]);
    if (!allowed) {
      return {
        valid: false,
        risk: def.risk,
        sanitized: cmd,
        requiresApproval: false,
        description: def.speak(args),
        error: `Permission denied: your role cannot perform "${cmd.action}"`,
      };
    }
  }

  // ─── 4. Input sanitization ────────────────────────────────
  const sanitized = sanitizeCommand(cmd, def);

  // ─── 5. Risk assessment ───────────────────────────────────
  const requiresApproval = def.risk === "medium" || def.risk === "high";

  return {
    valid: true,
    risk: def.risk,
    sanitized,
    requiresApproval,
    description: def.speak(sanitized.args ?? {}),
  };
}

/**
 * Validate command arguments against the command's JSON schema.
 */
function validateSchema(
  def: CommandDef,
  args: Record<string, unknown>
): string | undefined {
  // Check required fields.
  for (const field of def.required ?? []) {
    if (args[field] === undefined || args[field] === null || args[field] === "") {
      return `Missing required field: "${field}"`;
    }
  }

  // Check types and enum values.
  for (const [key, prop] of Object.entries(def.parameters)) {
    const value = args[key];
    if (value === undefined || value === null) continue;

    if (prop.type === "string" && typeof value !== "string") {
      return `Field "${key}" must be a string`;
    }
    if (prop.type === "boolean" && typeof value !== "boolean") {
      return `Field "${key}" must be a boolean`;
    }
    if (prop.type === "number" && typeof value !== "number") {
      return `Field "${key}" must be a number`;
    }
    if (prop.enum && !prop.enum.includes(String(value))) {
      return `Field "${key}" must be one of: ${prop.enum.join(", ")}`;
    }
  }

  return undefined;
}

/**
 * Sanitize command arguments: keep only declared fields, trim strings.
 */
function sanitizeCommand(
  cmd: AgentCommand,
  def: CommandDef
): AgentCommand {
  const rawArgs = cmd.args ?? {};
  const allowedKeys = Object.keys(def.parameters);
  const sanitizedArgs: Record<string, unknown> = {};

  for (const key of allowedKeys) {
    if (rawArgs[key] !== undefined && rawArgs[key] !== null) {
      const value = rawArgs[key];
      if (typeof value === "string") {
        sanitizedArgs[key] = value.trim();
      } else {
        sanitizedArgs[key] = value;
      }
    }
  }

  return { action: cmd.action, args: sanitizedArgs };
}

/**
 * Batch-validate multiple commands.
 * Returns the list of valid commands and any errors.
 */
export function validateCommands(
  commands: AgentCommand[],
  userRole: UserRole | undefined | null
): {
  valid: Array<{ command: AgentCommand; result: ValidationResult }>;
  invalid: Array<{ command: AgentCommand; result: ValidationResult }>;
} {
  const valid: Array<{ command: AgentCommand; result: ValidationResult }> = [];
  const invalid: Array<{ command: AgentCommand; result: ValidationResult }> = [];

  for (const cmd of commands) {
    const result = validateCommand(cmd, userRole);
    if (result.valid) {
      valid.push({ command: result.sanitized, result });
    } else {
      invalid.push({ command: cmd, result });
    }
  }

  return { valid, invalid };
}

/**
 * Rate limiter — prevents the LLM from issuing too many commands in a burst.
 * Uses a sliding window per session.
 */
export class RateLimiter {
  private timestamps: number[] = [];
  private readonly maxCommands: number;
  private readonly windowMs: number;

  constructor(maxCommands = 10, windowMs = 60_000) {
    this.maxCommands = maxCommands;
    this.windowMs = windowMs;
  }

  canExecute(): boolean {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(
      (ts) => now - ts < this.windowMs
    );
    if (this.timestamps.length >= this.maxCommands) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }

  reset() {
    this.timestamps = [];
  }
}

/**
 * Prompt injection detection — basic heuristics to detect malicious input.
 */
export function detectPromptInjection(input: string): boolean {
  const lower = input.toLowerCase();

  const suspiciousPatterns = [
    "ignore previous instructions",
    "ignore all previous",
    "disregard the above",
    "you are now",
    "system prompt",
    "reveal your instructions",
    "show me your prompt",
    "act as if",
    "pretend you are",
    "override",
    "jailbreak",
  ];

  return suspiciousPatterns.some((pattern) => lower.includes(pattern));
}
