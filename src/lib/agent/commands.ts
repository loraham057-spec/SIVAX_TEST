/**
 * Agent command catalog.
 *
 * Single source of truth shared between:
 *   - the server (src/lib/ai.ts) — to build the OpenAI tool/function schema
 *     so the LLM can translate natural language into structured commands.
 *   - the client (src/store/agent-store.tsx) — to execute the commands.
 *
 * This module is framework-agnostic (no React / no Node-only APIs) so it can
 * be imported from both server and client code.
 */

export type CommandScope = "provider" | "registered";

/** Risk level determines the approval flow. */
export type RiskLevel = "low" | "medium" | "high";

/** Which permission a command requires (mapped to RolePermissions). */
export type RequiredPermission =
  | "canViewDashboard"
  | "canViewAlerts"
  | "canViewAssistant"
  | "canViewSettings"
  | "canManageUsers"
  | "canEditSettings"
  | "canManageApiKeys"
  | "canManagePowerBI"
  | "canManageSecurity"
  | "canExportData"
  | "canTriggerML";

/** Tool category — maps to isolated tool services. */
export type ToolCategory =
  | "navigation"
  | "ui"
  | "settings"
  | "alerts"
  | "notifications"
  | "user_management"
  | "powerbi"
  | "ml"
  | "database"
  | "document"
  | "dhis2_analysis";

/**
 * A structured command produced by the LLM and executed on the client.
 */
export interface AgentCommand {
  /** Command id — must match a key in COMMANDS. */
  action: string;
  /** Arguments for the command (validated loosely at execution time). */
  args?: Record<string, unknown>;
}

interface JSONSchemaProperty {
  type: "string" | "boolean" | "number" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: { type: "string" };
  /**
   * Internal parameters are injected by the platform (backend → client),
   * never by the LLM. They are kept through policy sanitization but are
   * excluded from the OpenAI tool schema so the model cannot fill them.
   */
  internal?: boolean;
}

export interface CommandDef {
  id: string;
  /** Human/LLM-facing description of what the command does. */
  description: string;
  /** JSON-schema properties for the command arguments. */
  parameters: Record<string, JSONSchemaProperty>;
  /** Which argument keys are required. */
  required?: string[];
  /**
   * "provider"   → handled directly by the AgentProvider (router, theme, auth, api).
   * "registered" → needs a handler registered by a mounted page/component.
   */
  scope: CommandScope;
  /** For "registered" commands: the route to navigate to before executing. */
  route?: string;
  /** Risk level: low = auto-execute, medium = confirm, high = explicit approval. */
  risk: RiskLevel;
  /** Permission required to execute this command. */
  permission?: RequiredPermission;
  /** Tool category for tracing/observability. */
  category: ToolCategory;
  /** Fallback confirmation sentence (French) shown when the LLM returns no text. */
  speak: (args: Record<string, unknown>) => string;
}

/** Known application routes the agent can navigate to. */
export const NAV_DESTINATIONS = {
  home: "/dashboard",
  dashboard: "/dashboard",
  assistant: "/assistant",
  alerts: "/notifications",
  notifications: "/notifications",
  reports: "/reports",
  settings: "/settings",
  help: "/help",
  documentation: "/documentation",
} as const;

export type NavDestination = keyof typeof NAV_DESTINATIONS;

export const SETTINGS_TABS = ["profile", "configurations", "security", "users"] as const;
export const ALERT_TYPES = ["analysis", "prediction", "danger", "deadline", "imminent"] as const;
export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export const ALERT_STATUSES = ["all", "unread", "read"] as const;
export const USER_ROLES = ["admin", "analyst", "viewer"] as const;
export const PROFILE_FIELDS = ["full_name", "organization", "country"] as const;
export const SECURITY_SETTINGS = ["two_factor", "session_timeout", "audit_log"] as const;

export const COMMANDS: Record<string, CommandDef> = {
  // ─── Navigation ─────────────────────────────────────────
  navigate: {
    id: "navigate",
    description:
      "Navigate to a page of the platform. Use for requests like 'go to settings', 'open the alerts page', 'show the dashboard', 'va sur l'onglet notifications'.",
    parameters: {
      destination: {
        type: "string",
        description: "The page to navigate to.",
        enum: Object.keys(NAV_DESTINATIONS),
      },
    },
    required: ["destination"],
    scope: "provider",
    risk: "low",
    category: "navigation",
    speak: (a) => `J'ouvre la page « ${a.destination} ».`,
  },

  // ─── Assistant UI ───────────────────────────────────────
  open_assistant: {
    id: "open_assistant",
    description: "Open the AI assistant side drawer.",
    parameters: {},
    scope: "provider",
    risk: "low",
    category: "ui",
    permission: "canViewAssistant",
    speak: () => "J'ouvre l'assistant.",
  },
  close_assistant: {
    id: "close_assistant",
    description: "Close the AI assistant side drawer.",
    parameters: {},
    scope: "provider",
    risk: "low",
    category: "ui",
    permission: "canViewAssistant",
    speak: () => "Je ferme l'assistant.",
  },

  // ─── Appearance ─────────────────────────────────────────
  set_theme: {
    id: "set_theme",
    description: "Switch the interface theme between light and dark mode.",
    parameters: {
      theme: { type: "string", description: "Target theme.", enum: ["light", "dark"] },
    },
    required: ["theme"],
    scope: "provider",
    risk: "low",
    category: "ui",
    speak: (a) => `Je passe en thème ${a.theme === "dark" ? "sombre" : "clair"}.`,
  },

  // ─── Power BI ───────────────────────────────────────────
  toggle_fullscreen: {
    id: "toggle_fullscreen",
    description:
      "Toggle fullscreen mode for the Power BI dashboard/report. Use for requests like 'activate fullscreen', 'plein écran', 'exit fullscreen'.",
    parameters: {
      enabled: {
        type: "boolean",
        description: "true to enter fullscreen, false to exit. If omitted, toggles.",
      },
    },
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: (a) =>
      a.enabled === true
        ? "J'active le plein écran du tableau de bord."
        : a.enabled === false
          ? "Je désactive le plein écran du tableau de bord."
          : "Je bascule le plein écran du tableau de bord.",
  },

  // ─── Layout ─────────────────────────────────────────────
  toggle_sidebar: {
    id: "toggle_sidebar",
    description: "Collapse or expand the navigation sidebar.",
    parameters: {},
    scope: "registered",
    risk: "low",
    category: "ui",
    speak: () => "Je bascule la barre latérale.",
  },

  // ─── Session ────────────────────────────────────────────
  logout: {
    id: "logout",
    description: "Sign the current user out of the platform.",
    parameters: {},
    scope: "provider",
    risk: "high",
    category: "ui",
    speak: () => "Je vous déconnecte.",
  },
  refresh: {
    id: "refresh",
    description: "Reload / refresh the current view and its data.",
    parameters: {},
    scope: "provider",
    risk: "low",
    category: "ui",
    speak: () => "J'actualise la page.",
  },

  // ─── Notifications ──────────────────────────────────────
  mark_all_notifications_read: {
    id: "mark_all_notifications_read",
    description: "Mark all notifications as read.",
    parameters: {},
    scope: "provider",
    risk: "low",
    category: "notifications",
    speak: () => "Je marque toutes les notifications comme lues.",
  },

  // ─── Alerts (page handlers) ─────────────────────────────
  filter_alerts: {
    id: "filter_alerts",
    description:
      "Filter the alerts list by status, type and/or severity. Example: 'show only critical alerts', 'affiche les alertes non lues'.",
    parameters: {
      status: { type: "string", description: "Read status filter.", enum: [...ALERT_STATUSES] },
      type: { type: "string", description: "Alert type filter.", enum: ["all", ...ALERT_TYPES] },
      severity: { type: "string", description: "Severity filter.", enum: ["all", ...ALERT_SEVERITIES] },
    },
    scope: "registered",
    route: "/notifications",
    risk: "low",
    category: "alerts",
    permission: "canViewAlerts",
    speak: () => "J'applique le filtre aux alertes.",
  },
  mark_all_alerts_read: {
    id: "mark_all_alerts_read",
    description: "Mark every alert as read.",
    parameters: {},
    scope: "registered",
    route: "/notifications",
    risk: "low",
    category: "alerts",
    permission: "canViewAlerts",
    speak: () => "Je marque toutes les alertes comme lues.",
  },
  mark_alert_read: {
    id: "mark_alert_read",
    description: "Mark a single alert as read, identified by its id.",
    parameters: {
      id: { type: "string", description: "The alert id." },
    },
    required: ["id"],
    scope: "registered",
    route: "/notifications",
    risk: "low",
    category: "alerts",
    permission: "canViewAlerts",
    speak: () => "Je marque l'alerte comme lue.",
  },

  // ─── Settings (page handlers) ───────────────────────────
  switch_settings_tab: {
    id: "switch_settings_tab",
    description:
      "Open a specific tab inside the Settings page (Profile, Configurations, Security, Users).",
    parameters: {
      tab: { type: "string", description: "The settings tab.", enum: [...SETTINGS_TABS] },
    },
    required: ["tab"],
    scope: "registered",
    route: "/settings",
    risk: "low",
    category: "settings",
    permission: "canViewSettings",
    speak: (a) => `J'ouvre l'onglet « ${a.tab} » des paramètres.`,
  },
  set_profile_field: {
    id: "set_profile_field",
    description:
      "Fill a field of the user profile form (full name, organization, or country). Does not save until save_profile is called.",
    parameters: {
      field: { type: "string", description: "Profile field.", enum: [...PROFILE_FIELDS] },
      value: { type: "string", description: "New value for the field." },
    },
    required: ["field", "value"],
    scope: "registered",
    route: "/settings",
    risk: "medium",
    category: "settings",
    permission: "canEditSettings",
    speak: (a) => `Je renseigne le champ « ${a.field} ».`,
  },
  save_profile: {
    id: "save_profile",
    description: "Save the current profile form changes.",
    parameters: {},
    scope: "registered",
    route: "/settings",
    risk: "medium",
    category: "settings",
    permission: "canEditSettings",
    speak: () => "J'enregistre votre profil.",
  },
  toggle_security: {
    id: "toggle_security",
    description:
      "Enable or disable a security setting: two-factor authentication, session timeout, or the data export audit log.",
    parameters: {
      setting: { type: "string", description: "Security setting.", enum: [...SECURITY_SETTINGS] },
      value: { type: "boolean", description: "true to enable, false to disable." },
    },
    required: ["setting", "value"],
    scope: "registered",
    route: "/settings",
    risk: "high",
    category: "settings",
    permission: "canManageSecurity",
    speak: (a) => `Je ${a.value ? "active" : "désactive"} le paramètre de sécurité.`,
  },

  // ─── User management (admin, provider) ──────────────────
  create_user: {
    id: "create_user",
    description:
      "Create a new platform user account (admin only). Requires an email, a password and a role.",
    parameters: {
      email: { type: "string", description: "User email." },
      password: { type: "string", description: "Initial password." },
      full_name: { type: "string", description: "Full name." },
      role: { type: "string", description: "Access role.", enum: [...USER_ROLES] },
      organization: { type: "string", description: "Organization name." },
    },
    required: ["email", "password", "role"],
    scope: "provider",
    risk: "high",
    category: "user_management",
    permission: "canManageUsers",
    speak: (a) => `Je crée le compte pour ${a.email}.`,
  },
  update_user_role: {
    id: "update_user_role",
    description: "Change the access role of an existing user, identified by email (admin only).",
    parameters: {
      email: { type: "string", description: "The user's email." },
      role: { type: "string", description: "New role.", enum: [...USER_ROLES] },
    },
    required: ["email", "role"],
    scope: "provider",
    risk: "high",
    category: "user_management",
    permission: "canManageUsers",
    speak: (a) => `Je change le rôle de ${a.email} en ${a.role}.`,
  },
  delete_user: {
    id: "delete_user",
    description: "Delete a user account, identified by email (admin only).",
    parameters: {
      email: { type: "string", description: "The user's email." },
    },
    required: ["email"],
    scope: "provider",
    risk: "high",
    category: "user_management",
    permission: "canManageUsers",
    speak: (a) => `Je supprime le compte ${a.email}.`,
  },

  // ─── DHIS2 Analysis (AI-driven analytics) ──────────────
  run_dhis2_analysis: {
    id: "run_dhis2_analysis",
    description:
      "Run a DHIS2 data analysis from a natural-language question. The platform searches DHIS2 metadata for matching indicators/data elements, executes a controlled analytics query, and renders the result as a chart, KPI, or table in the dashboard. Use for requests like 'show vaccination coverage by health zone last 3 months', 'répartition des cas de paludisme par province', 'tendance des accouchements assistés'.",
    parameters: {
      question: {
        type: "string",
        description: "The user's analytical question in natural language (French or English). This text is used to search DHIS2 indicators.",
      },
      metricQuery: {
        type: "string",
        description: "Optional refined search query for DHIS2 metric lookup (e.g. 'paludisme cas confirmés', 'vaccination BCG'). If omitted, the question itself is used.",
      },
      periodPreset: {
        type: "string",
        description: "Relative time period for the analysis. Use 'periods' instead when the user names specific months.",
        enum: ["THIS_MONTH", "LAST_MONTH", "LAST_COMPLETE_MONTH", "THIS_YEAR", "LAST_YEAR", "LAST_3_MONTHS", "LAST_6_MONTHS", "LAST_12_MONTHS", "YEAR_OVER_YEAR"],
      },
      periods: {
        type: "array",
        description: "Explicit DHIS2 period codes when the user names specific months or years. Monthly: YYYYMM, e.g. ['202509'] for September 2025. Yearly: YYYY, e.g. ['2022','2023','2024','2025'] for an evolution from 2022 to 2025. Takes precedence over periodPreset.",
        items: { type: "string" },
      },
      orgUnitId: {
        type: "string",
        description: "DHIS2 organisation unit ID to analyze. Defaults to the national root (ymGeqzoPhN3 for DRC).",
      },
      orgUnitLevel: {
        type: "number",
        description: "Organisation unit level of the orgUnitId (1=country, 2=province, 3=health zone, 4=health area, 5=facility).",
      },
      targetOrgUnitLevel: {
        type: "number",
        description: "If set, breaks down the data by this geographic level (e.g. 3 for health zones within a province). Omit for a single aggregate.",
      },
      visualization: {
        type: "string",
        description: "Preferred visualization type. Use 'auto' to let the platform choose the best chart based on the data.",
        enum: ["auto", "kpi", "line", "bar", "pie", "table"],
      },
      metricId: {
        type: "string",
        description: "Internal: DHIS2 metric ID selected by the backend. When present, skips frontend metric search to ensure consistency.",
        internal: true,
      },
      llmInterpretation: {
        type: "string",
        description: "Internal: LLM-generated interpretation to display in the analytics container instead of the hardcoded explanation.",
        internal: true,
      },
      analysisPayload: {
        type: "object",
        description: "Internal: complete structured analysis computed server-side by the agent (single source of truth). When present, the frontend renders it directly without re-querying DHIS2.",
        internal: true,
      },
    },
    required: ["question"],
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "dhis2_analysis",
    permission: "canViewDashboard",
    speak: (a) => `Je lance l'analyse DHIS2 : « ${a.question} ».`,
  },

  // ─── Power BI Embedded control (agent → report) ──────────
  powerbi_get_state: {
    id: "powerbi_get_state",
    description:
      "Get the current state of the embedded Power BI report: active page, active filters, available pages and bookmarks. Use when the user asks 'what am I looking at?' or when context is needed before applying changes.",
    parameters: {},
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: () => "Je récupère l'état courant du rapport Power BI.",
  },
  powerbi_get_pages: {
    id: "powerbi_get_pages",
    description:
      "List all available pages in the embedded Power BI report. Use before navigating to a page to verify it exists.",
    parameters: {},
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: () => "Je récupère la liste des pages du rapport.",
  },
  powerbi_get_bookmarks: {
    id: "powerbi_get_bookmarks",
    description:
      "List all available bookmarks in the embedded Power BI report. Use before applying a bookmark to verify it exists.",
    parameters: {},
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: () => "Je récupère la liste des bookmarks du rapport.",
  },
  powerbi_change_page: {
    id: "powerbi_change_page",
    description:
      "Navigate to a specific page in the embedded Power BI report. The pageName must be a valid page from powerbi_get_pages. Use for requests like 'go to coverage page', 'affiche la chaîne d'approvisionnement', 'va sur la surveillance'.",
    parameters: {
      pageName: {
        type: "string",
        description: "The technical page name (from powerbi_get_pages). Do not guess — always use a name returned by powerbi_get_pages.",
      },
    },
    required: ["pageName"],
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: (a) => `Je change la page du rapport vers « ${a.pageName} ».`,
  },
  powerbi_apply_bookmark: {
    id: "powerbi_apply_bookmark",
    description:
      "Apply a bookmark to the embedded Power BI report. The bookmarkName must be a valid bookmark from powerbi_get_bookmarks.",
    parameters: {
      bookmarkName: {
        type: "string",
        description: "The technical bookmark name (from powerbi_get_bookmarks). Do not guess — always use a name returned by powerbi_get_bookmarks.",
      },
    },
    required: ["bookmarkName"],
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: (a) => `J'applique le bookmark « ${a.bookmarkName} ».`,
  },
  powerbi_apply_filters: {
    id: "powerbi_apply_filters",
    description:
      "Apply filters to the embedded Power BI report. Each filter targets a table.column with an operator and values. Valid tables: dim_org_units (columns: province_name, zone_name), dim_indicators (columns: antigen, pev_domain), dim_date (columns: year, month, year_month). Use for requests like 'filter by Kinshasa', 'filtre Penta3', 'montre 2025'.",
    parameters: {
      filters: {
        type: "array",
        description: "Array of filter commands to apply. Each filter has: table, column, operator ('In'|'Equals'|'Contains'), values (array of strings).",
        items: { type: "string" },
      },
    },
    required: ["filters"],
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: () => "J'applique les filtres au rapport Power BI.",
  },
  powerbi_clear_filters: {
    id: "powerbi_clear_filters",
    description:
      "Clear all filters (or filters on a specific table) from the embedded Power BI report. Use for requests like 'reset filters', 'reviens à la vue nationale', 'efface les filtres'.",
    parameters: {
      table: {
        type: "string",
        description: "Optional table name to clear filters on. If omitted, clears all filters.",
      },
    },
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: () => "J'efface les filtres du rapport Power BI.",
  },
  powerbi_query: {
    id: "powerbi_query",
    description:
      "Execute a DAX query against the Power BI dataset to retrieve data values. Use for questions that require actual numbers (e.g. 'what is the Penta3 coverage in Kinshasa?'). The query must be a valid DAX EVALUATE statement. Only read-only queries are allowed.",
    parameters: {
      dax: {
        type: "string",
        description: "A DAX query (EVALUATE statement) to execute against the dataset. Must be read-only.",
      },
    },
    required: ["dax"],
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: () => "J'exécute une requête DAX sur le dataset Power BI.",
  },
  powerbi_get_model: {
    id: "powerbi_get_model",
    description:
      "Get the Power BI semantic model metadata: tables, columns, and PEV indicator definitions. Use to understand what data is available before constructing a DAX query.",
    parameters: {},
    scope: "registered",
    route: "/dashboard",
    risk: "low",
    category: "powerbi",
    permission: "canViewDashboard",
    speak: () => "Je récupère les métadonnées du modèle Power BI.",
  },
};

/**
 * Build the OpenAI "tools" array from the command catalog.
 */
export function buildOpenAITools() {
  return Object.values(COMMANDS).map((cmd) => ({
    type: "function" as const,
    function: {
      name: cmd.id,
      description: cmd.description,
      parameters: {
        type: "object" as const,
        // Internal parameters are platform-injected; never expose them to
        // the LLM so it cannot fabricate them.
        properties: Object.fromEntries(
          Object.entries(cmd.parameters).filter(([, p]) => !p.internal),
        ),
        required: cmd.required ?? [],
        additionalProperties: false,
      },
    },
  }));
}

/**
 * Default confirmation reply built from executed commands, used when the LLM
 * returns tool calls without any accompanying natural-language text.
 */
export function buildDefaultReply(commands: AgentCommand[]): string {
  if (commands.length === 0) return "";
  return commands
    .map((c) => COMMANDS[c.action]?.speak(c.args ?? {}) ?? "")
    .filter(Boolean)
    .join(" ");
}
