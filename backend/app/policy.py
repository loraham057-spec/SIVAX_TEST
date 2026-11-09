"""
Policy Engine — validation layer for AI actions (FastAPI backend).

Every action produced by the LLM must pass through this engine.
Validates schema, checks authorization, assesses risk, sanitizes input.
"""

from __future__ import annotations

import re

from app.tools.schema import COMMAND_CATALOG, RiskLevel, ActionStatus

# Role permissions (mirrors src/lib/auth/types.ts)
ROLE_PERMISSIONS: dict[str, dict[str, bool]] = {
    "admin": {
        "canViewDashboard": True, "canViewAlerts": True, "canViewAssistant": True,
        "canViewSettings": True, "canManageUsers": True, "canEditSettings": True,
        "canManageApiKeys": True, "canManagePowerBI": True, "canManageSecurity": True,
        "canExportData": True, "canTriggerML": True,
    },
    "analyst": {
        "canViewDashboard": True, "canViewAlerts": True, "canViewAssistant": True,
        "canViewSettings": False, "canManageUsers": False, "canEditSettings": False,
        "canManageApiKeys": False, "canManagePowerBI": False, "canManageSecurity": False,
        "canExportData": True, "canTriggerML": True,
    },
    "viewer": {
        "canViewDashboard": True, "canViewAlerts": True, "canViewAssistant": True,
        "canViewSettings": False, "canManageUsers": False, "canEditSettings": False,
        "canManageApiKeys": False, "canManagePowerBI": False, "canManageSecurity": False,
        "canExportData": False, "canTriggerML": False,
    },
}


def has_permission(role: str | None, permission: str) -> bool:
    if not role or role not in ROLE_PERMISSIONS:
        return False
    return ROLE_PERMISSIONS[role].get(permission, False)


def validate_schema(cmd_def: dict, args: dict) -> str | None:
    """Validate args against the command's JSON schema."""
    required = cmd_def.get("required", [])
    for field in required:
        if field not in args or args[field] is None or args[field] == "":
            return f'Missing required field: "{field}"'

    params = cmd_def.get("parameters", {})
    for key, prop in params.items():
        value = args.get(key)
        if value is None:
            continue

        expected_type = prop.get("type")
        if expected_type == "string" and not isinstance(value, str):
            return f'Field "{key}" must be a string'
        if expected_type == "boolean" and not isinstance(value, bool):
            return f'Field "{key}" must be a boolean'
        if expected_type == "number" and not isinstance(value, (int, float)):
            return f'Field "{key}" must be a number'

        enum_values = prop.get("enum")
        if enum_values and str(value) not in enum_values:
            return f'Field "{key}" must be one of: {", ".join(enum_values)}'

    return None


def sanitize_args(args: dict, cmd_def: dict) -> dict:
    """Keep only declared fields, trim strings."""
    allowed = set(cmd_def.get("parameters", {}).keys())
    sanitized = {}
    for key in allowed:
        if key in args and args[key] is not None:
            value = args[key]
            if isinstance(value, str):
                sanitized[key] = value.strip()
            else:
                sanitized[key] = value
    return sanitized


def normalize_period_args(args: dict) -> dict:
    """
    Normalize period arguments for run_dhis2_analysis before schema validation.

    The LLM sometimes puts a custom range like "2022-2025" or a single year
    into periodPreset instead of using the explicit 'periods' parameter.
    Instead of hard-failing on the enum check, convert year ranges to
    explicit yearly period codes (['2022','2023','2024','2025']).
    """
    preset = args.get("periodPreset")
    if not isinstance(preset, str) or not preset.strip():
        return args

    valid_presets = {
        "THIS_MONTH", "LAST_MONTH", "THIS_YEAR", "LAST_YEAR",
        "LAST_3_MONTHS", "LAST_6_MONTHS", "LAST_12_MONTHS", "YEAR_OVER_YEAR",
    }
    preset_norm = preset.strip().upper()
    # Normalize accented separators (à -> A) so the regex below matches.
    preset_norm = preset_norm.replace("À", "A").replace("É", "E").replace("È", "E")
    if preset_norm in valid_presets:
        return args

    # Year range: "2022-2025", "2022_2025", "2022 A 2025", "2022 TO 2025"…
    range_match = re.search(r"(\d{4})\s*(?:[-_/]|A|TO|BIS)?\s*(\d{4})", preset_norm)
    single_match = re.fullmatch(r"(\d{4})(\d{2})?", preset_norm)
    normalized = dict(args)
    if range_match:
        start, end = int(range_match.group(1)), int(range_match.group(2))
        if 1990 <= start <= end <= 2100 and end - start <= 20:
            if not normalized.get("periods"):
                normalized["periods"] = [str(y) for y in range(start, end + 1)]
            normalized["periodPreset"] = "LAST_12_MONTHS"
            return normalized
    elif single_match:
        if not normalized.get("periods"):
            normalized["periods"] = [preset_norm]
        normalized["periodPreset"] = "LAST_12_MONTHS"
        return normalized

    # Unrecognized preset: fall back to a safe default instead of failing.
    normalized["periodPreset"] = "LAST_12_MONTHS"
    return normalized


def validate_action(action: str, args: dict, user_role: str | None) -> dict:
    """
    Validate a single action through the policy engine.

    Returns:
        {
            "valid": bool,
            "risk": str,
            "sanitized_args": dict,
            "error": str | None,
            "requires_approval": bool,
            "description": str,
        }
    """
    cmd_def = COMMAND_CATALOG.get(action)
    if not cmd_def:
        return {
            "valid": False,
            "risk": "high",
            "sanitized_args": args,
            "error": f"Unknown command: {action}",
            "requires_approval": False,
            "description": f"Unknown command: {action}",
        }

    # Normalize period args before schema validation so the LLM can pass
    # year ranges (e.g. "2022-2025") via periodPreset without hitting the
    # enum check.
    if action == "run_dhis2_analysis":
        args = normalize_period_args(args)

    # Schema validation
    schema_error = validate_schema(cmd_def, args)
    if schema_error:
        return {
            "valid": False,
            "risk": cmd_def["risk"].value,
            "sanitized_args": args,
            "error": schema_error,
            "requires_approval": False,
            "description": cmd_def["description"],
        }

    # Authorization
    permission = cmd_def.get("permission")
    if permission and not has_permission(user_role, permission):
        return {
            "valid": False,
            "risk": cmd_def["risk"].value,
            "sanitized_args": args,
            "error": f"Permission denied: role '{user_role}' cannot perform '{action}'",
            "requires_approval": False,
            "description": cmd_def["description"],
        }

    # Sanitize
    sanitized = sanitize_args(args, cmd_def)

    # Risk assessment
    risk = cmd_def["risk"].value
    requires_approval = risk in ("medium", "high")

    # ─── Health recommendation guard ───
    # Per ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §7.2.8, recommendations
    # that could influence public health decisions (vaccination strategy,
    # stock reallocation, outbreak response) require human validation
    # even if the underlying command is low-risk. This prevents the AI
    # from autonomously triggering operational changes without sign-off.
    if action in ("compute_risk_scores", "diagnose_gaps", "detect_alerts"):
        # These tools produce recommendations — flag for review
        # unless the user explicitly requested an automated run.
        auto_run = sanitized.get("auto_run", False)
        if not auto_run:
            requires_approval = True
            if risk == "low":
                risk = "medium"

    return {
        "valid": True,
        "risk": risk,
        "sanitized_args": sanitized,
        "error": None,
        "requires_approval": requires_approval,
        "description": cmd_def["description"],
    }


def detect_prompt_input(text: str) -> bool:
    """Basic prompt injection detection."""
    lower = text.lower()
    patterns = [
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
    ]
    return any(p in lower for p in patterns)
