"""
Command catalog — mirrors the TypeScript definitions in commands.ts.

Single source of truth for the FastAPI backend. Each command has:
- id, description, parameters (JSON schema), risk level, required permission.
"""

from __future__ import annotations

from enum import Enum


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ActionStatus(str, Enum):
    AUTO_EXECUTED = "auto_executed"
    NEEDS_APPROVAL = "needs_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    FAILED = "failed"


# Navigation destinations
NAV_DESTINATIONS = {
    "home": "/dashboard",
    "dashboard": "/dashboard",
    "assistant": "/assistant",
    "alerts": "/notifications",
    "notifications": "/notifications",
    "reports": "/reports",
    "settings": "/settings",
    "help": "/help",
    "documentation": "/documentation",
}

SETTINGS_TABS = ["profile", "configurations", "security", "users"]
ALERT_TYPES = ["analysis", "prediction", "danger", "deadline", "imminent"]
ALERT_SEVERITIES = ["info", "warning", "critical"]
ALERT_STATUSES = ["all", "unread", "read"]
USER_ROLES = ["admin", "analyst", "viewer"]
PROFILE_FIELDS = ["full_name", "organization", "country"]
SECURITY_SETTINGS = ["two_factor", "session_timeout", "audit_log"]

COMMAND_CATALOG: dict[str, dict] = {
    # Navigation
    "navigate": {
        "description": "Navigate to a page of the platform.",
        "parameters": {"destination": {"type": "string", "enum": list(NAV_DESTINATIONS.keys())}},
        "required": ["destination"],
        "scope": "provider",
        "risk": RiskLevel.LOW,
        "category": "navigation",
        "permission": None,
    },
    # Assistant UI
    "open_assistant": {
        "description": "Open the AI assistant side drawer.",
        "parameters": {},
        "required": [],
        "scope": "provider",
        "risk": RiskLevel.LOW,
        "category": "ui",
        "permission": "canViewAssistant",
    },
    "close_assistant": {
        "description": "Close the AI assistant side drawer.",
        "parameters": {},
        "required": [],
        "scope": "provider",
        "risk": RiskLevel.LOW,
        "category": "ui",
        "permission": "canViewAssistant",
    },
    # Appearance
    "set_theme": {
        "description": "Switch the interface theme.",
        "parameters": {"theme": {"type": "string", "enum": ["light", "dark"]}},
        "required": ["theme"],
        "scope": "provider",
        "risk": RiskLevel.LOW,
        "category": "ui",
        "permission": None,
    },
    # Layout
    "toggle_sidebar": {
        "description": "Collapse or expand the navigation sidebar.",
        "parameters": {},
        "required": [],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "ui",
        "permission": None,
    },
    # Session
    "logout": {
        "description": "Sign the current user out.",
        "parameters": {},
        "required": [],
        "scope": "provider",
        "risk": RiskLevel.HIGH,
        "category": "ui",
        "permission": None,
    },
    "refresh": {
        "description": "Reload the current view.",
        "parameters": {},
        "required": [],
        "scope": "provider",
        "risk": RiskLevel.LOW,
        "category": "ui",
        "permission": None,
    },
    # Notifications
    "mark_all_notifications_read": {
        "description": "Mark all notifications as read.",
        "parameters": {},
        "required": [],
        "scope": "provider",
        "risk": RiskLevel.LOW,
        "category": "notifications",
        "permission": None,
    },
    # Alerts
    "filter_alerts": {
        "description": "Filter the alerts list.",
        "parameters": {
            "status": {"type": "string", "enum": ALERT_STATUSES},
            "type": {"type": "string", "enum": ["all"] + ALERT_TYPES},
            "severity": {"type": "string", "enum": ["all"] + ALERT_SEVERITIES},
        },
        "required": [],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "alerts",
        "permission": "canViewAlerts",
        "route": "/notifications",
    },
    "mark_all_alerts_read": {
        "description": "Mark every alert as read.",
        "parameters": {},
        "required": [],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "alerts",
        "permission": "canViewAlerts",
        "route": "/notifications",
    },
    "mark_alert_read": {
        "description": "Mark a single alert as read.",
        "parameters": {"id": {"type": "string"}},
        "required": ["id"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "alerts",
        "permission": "canViewAlerts",
        "route": "/notifications",
    },
    # Settings
    "switch_settings_tab": {
        "description": "Open a settings tab.",
        "parameters": {"tab": {"type": "string", "enum": SETTINGS_TABS}},
        "required": ["tab"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "settings",
        "permission": "canViewSettings",
        "route": "/settings",
    },
    "set_profile_field": {
        "description": "Fill a profile field.",
        "parameters": {
            "field": {"type": "string", "enum": PROFILE_FIELDS},
            "value": {"type": "string"},
        },
        "required": ["field", "value"],
        "scope": "registered",
        "risk": RiskLevel.MEDIUM,
        "category": "settings",
        "permission": "canEditSettings",
        "route": "/settings",
    },
    "save_profile": {
        "description": "Save profile changes.",
        "parameters": {},
        "required": [],
        "scope": "registered",
        "risk": RiskLevel.MEDIUM,
        "category": "settings",
        "permission": "canEditSettings",
        "route": "/settings",
    },
    "toggle_security": {
        "description": "Toggle a security setting.",
        "parameters": {
            "setting": {"type": "string", "enum": SECURITY_SETTINGS},
            "value": {"type": "boolean"},
        },
        "required": ["setting", "value"],
        "scope": "registered",
        "risk": RiskLevel.HIGH,
        "category": "settings",
        "permission": "canManageSecurity",
        "route": "/settings",
    },
    # User management
    "create_user": {
        "description": "Create a new user account (admin only).",
        "parameters": {
            "email": {"type": "string"},
            "password": {"type": "string"},
            "full_name": {"type": "string"},
            "role": {"type": "string", "enum": USER_ROLES},
            "organization": {"type": "string"},
        },
        "required": ["email", "password", "role"],
        "scope": "provider",
        "risk": RiskLevel.HIGH,
        "category": "user_management",
        "permission": "canManageUsers",
    },
    "update_user_role": {
        "description": "Change a user's role (admin only).",
        "parameters": {
            "email": {"type": "string"},
            "role": {"type": "string", "enum": USER_ROLES},
        },
        "required": ["email", "role"],
        "scope": "provider",
        "risk": RiskLevel.HIGH,
        "category": "user_management",
        "permission": "canManageUsers",
    },
    "delete_user": {
        "description": "Delete a user account (admin only).",
        "parameters": {"email": {"type": "string"}},
        "required": ["email"],
        "scope": "provider",
        "risk": RiskLevel.HIGH,
        "category": "user_management",
        "permission": "canManageUsers",
    },
    # DHIS2 Analysis
    "run_dhis2_analysis": {
        "description": (
            "Run a DHIS2 data analysis from a natural-language question. "
            "The platform searches DHIS2 metadata for matching indicators/data elements, "
            "executes a controlled analytics query, and renders the result as a chart, KPI, or table. "
            "Use for requests like 'show vaccination coverage by health zone last 3 months', "
            "'répartition des cas de paludisme par province'."
        ),
        "parameters": {
            "question": {"type": "string"},
            "metricQuery": {"type": "string"},
            "metricId": {"type": "string"},
            "metricName": {"type": "string"},
            "antigens": {
                "type": "array",
                "items": {"type": "string"},
            },
            "periodPreset": {
                "type": "string",
                "enum": [
                    "THIS_MONTH", "LAST_MONTH", "THIS_YEAR", "LAST_YEAR",
                    "LAST_3_MONTHS", "LAST_6_MONTHS", "LAST_12_MONTHS", "YEAR_OVER_YEAR",
                ],
            },
            "periods": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Explicit DHIS2 period codes: monthly (YYYYMM, e.g. ['202509']) or yearly (YYYY, e.g. ['2022','2023','2024','2025'] for a 2022-2025 range). Takes precedence over periodPreset. Use yearly codes when the user asks for a multi-year evolution.",
            },
            "orgUnitId": {"type": "string"},
            "orgUnitLevel": {"type": "number"},
            "targetOrgUnitLevel": {"type": "number"},
            "qid": {"type": "string"},
            "analysisIntent": {"type": "string"},
            "measurementType": {
                "type": "string",
                "enum": ["value", "count", "proportion", "rate"],
            },
            "threshold": {"type": "number"},
            "comparisonOperator": {
                "type": "string",
                "enum": ["gt", "gte", "lt", "lte", "eq"],
            },
            "renderType": {
                "type": "string",
                "enum": [
                    "kpi_answer", "ranking_answer", "trend_answer", "diagnostic_answer",
                    "geographic_answer", "comparative_answer", "alert_answer", "executive_brief",
                ],
            },
            "visualization": {
                "type": "string",
                "enum": ["auto", "kpi", "line", "bar", "pie", "table"],
            },
        },
        "required": ["question"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "dhis2_analysis",
        "permission": "canViewDashboard",
        "route": "/dashboard",
    },
    # Semantic layer — resolve business terms to DHIS2 indicators
    "resolve_indicator": {
        "description": (
            "Resolve a natural language indicator name to DHIS2 indicator IDs. "
            "Returns matching indicators with definitions, thresholds, and scores. "
            "Use before running an analysis to find the right DHIS2 indicator."
        ),
        "parameters": {
            "query": {"type": "string", "description": "Natural language indicator name (e.g. 'couverture penta3', 'abandon')"},
        },
        "required": ["query"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "semantic_layer",
        "permission": "canViewDashboard",
    },
    # Risk scorer — compute province risk scores
    "compute_risk_scores": {
        "description": (
            "Compute a transparent risk score per province based on vaccination "
            "indicators (coverage Penta3, dropout, BCG, trend, sous-vaccinés). "
            "Returns scores 0-100 with factor contributions for explainability. "
            "Use for 'quelles zones sont à risque ?' or 'identifier les provinces prioritaires'."
        ),
        "parameters": {
            "province_data": {
                "type": "array",
                "description": "List of provinces with their indicator values",
                "items": {
                    "type": "object",
                    "properties": {
                        "org_unit_id": {"type": "string"},
                        "org_unit_name": {"type": "string"},
                        "values": {"type": "object", "description": "Map of indicator_id → value"},
                    },
                },
            },
        },
        "required": ["province_data"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "risk_scorer",
        "permission": "canViewDashboard",
    },
    # Diagnostic engine — identify factors associated with gaps
    "diagnose_gaps": {
        "description": (
            "Diagnose vaccination performance gaps across provinces. "
            "Identifies provinces below threshold, computes correlations with "
            "secondary indicators, and generates hypotheses. "
            "Use for 'pourquoi la couverture est-elle faible ?' or diagnostic questions."
        ),
        "parameters": {
            "primary_indicator": {
                "type": "string",
                "description": "DHIS2 indicator ID to diagnose (e.g. 'v9b9aYsA5PM' for Penta3)",
            },
            "province_data": {
                "type": "array",
                "description": "List of provinces with their indicator values",
                "items": {
                    "type": "object",
                    "properties": {
                        "org_unit_id": {"type": "string"},
                        "org_unit_name": {"type": "string"},
                        "values": {"type": "object"},
                    },
                },
            },
        },
        "required": ["primary_indicator", "province_data"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "diagnostic_engine",
        "permission": "canViewDashboard",
    },
    # Analysis planner — create multi-step analysis plans
    "create_analysis_plan": {
        "description": (
            "Create a multi-step analysis plan for a business question. "
            "Determines which indicators to query and which analysis steps "
            "to execute (situation → gap → diagnosis → risk → action). "
            "Use at the start of a complex analysis to structure the approach."
        ),
        "parameters": {
            "question": {"type": "string", "description": "The user's business question"},
            "entities": {"type": "object", "description": "Extracted entities (indicator, period, geography)"},
        },
        "required": ["question"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "analysis_planner",
        "permission": "canViewDashboard",
    },
    # Alert detector — detect early warnings
    "detect_alerts": {
        "description": (
            "Detect early warnings for an indicator based on historical "
            "baseline and configurable thresholds. Alerts include coverage "
            "decline, dropout spike, trend reversal, and threshold breach. "
            "Each alert carries a severity and a confidence level."
        ),
        "parameters": {
            "indicator_id": {"type": "string", "description": "DHIS2 indicator UID"},
            "org_unit_id": {"type": "string", "description": "DHIS2 org unit UID"},
            "org_unit_name": {"type": "string", "description": "Org unit display name"},
            "series": {
                "type": "array",
                "description": "Chronological series of {period, value}",
                "items": {
                    "type": "object",
                    "properties": {
                        "period": {"type": "string"},
                        "value": {"type": "number"},
                    },
                },
            },
            "thresholds": {
                "type": "object",
                "description": "Optional override of default alert thresholds",
            },
        },
        "required": ["indicator_id", "series"],
        "scope": "registered",
        "risk": RiskLevel.LOW,
        "category": "alert_detector",
        "permission": "canViewDashboard",
    },
}


# Categories the planner must never call directly: they are building blocks
# run_dhis2_analysis orchestrates server-side, and the frontend has no handler
# for them. Everything else in the catalog mirrors src/lib/agent/commands.ts.
INTERNAL_CATEGORIES = {
    "semantic_layer", "risk_scorer", "diagnostic_engine", "analysis_planner", "alert_detector",
}


def build_openai_tools(user_role: str | None = None) -> list[dict]:
    """Build the OpenAI tools array from the command catalog.

    Exposes every frontend-executable command, minus the internal analysis
    tools. When a role is given, commands the role is not permitted to run are
    left out so the model does not propose them; validate_action stays the
    authoritative check at execution time.
    """
    from app.policy import has_permission  # local import: policy imports this module

    tools = []
    for cmd_id, cmd in COMMAND_CATALOG.items():
        if cmd["category"] in INTERNAL_CATEGORIES:
            continue
        permission = cmd.get("permission")
        if user_role is not None and permission and not has_permission(user_role, permission):
            continue
        tools.append({
            "type": "function",
            "function": {
                "name": cmd_id,
                "description": cmd["description"],
                "parameters": {
                    "type": "object",
                    "properties": cmd["parameters"],
                    "required": cmd["required"],
                    "additionalProperties": False,
                },
            },
        })
    return tools
