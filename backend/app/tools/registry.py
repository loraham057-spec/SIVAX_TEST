"""
Tool registry — maps tool categories to isolated tool implementations.

Each tool is an isolated service with a typed interface. The registry
provides a single lookup point for the agent to find the right tool
for a given command category.
"""

from __future__ import annotations

from app.tools.powerbi import PowerBITool
from app.tools.ml import MLTool
from app.tools.database import DatabaseTool
from app.tools.document import DocumentTool
from app.tools.notification import NotificationTool
from app.tools.dhis2 import Dhis2Tool
from app.tools.semantic_layer import SemanticLayer
from app.tools.risk_scorer import RiskScorer
from app.tools.diagnostic_engine import DiagnosticEngine
from app.tools.analysis_planner import AnalysisPlanner
from app.tools.alert_detector import AlertDetector
from app.core.config import settings


class ToolRegistry:
    """Registry of available tools, keyed by category."""

    def __init__(self):
        self._tools: dict[str, object] = {}

    def register(self, category: str, tool: object):
        self._tools[category] = tool

    def get(self, category: str) -> object | None:
        return self._tools.get(category)


# ─── Tool implementations ──────────────────────────────────

tool_registry = ToolRegistry()
tool_registry.register("powerbi", PowerBITool())
tool_registry.register("ml", MLTool())
tool_registry.register("database", DatabaseTool())
tool_registry.register("document", DocumentTool())
tool_registry.register("notification", NotificationTool())
tool_registry.register("dhis2_analysis", Dhis2Tool())
tool_registry.register("semantic_layer", SemanticLayer())
tool_registry.register("risk_scorer", RiskScorer())
tool_registry.register("diagnostic_engine", DiagnosticEngine())
tool_registry.register("analysis_planner", AnalysisPlanner())
tool_registry.register("alert_detector", AlertDetector())


# ─── Tool allow-list per role ──────────────────────────────

TOOL_ALLOW_LIST: dict[str, list[str]] = {
    "admin": ["powerbi", "ml", "database", "document", "notification", "dhis2_analysis", "semantic_layer", "risk_scorer", "diagnostic_engine", "analysis_planner", "alert_detector"],
    "analyst": ["powerbi", "ml", "database", "document", "dhis2_analysis", "semantic_layer", "risk_scorer", "diagnostic_engine", "analysis_planner", "alert_detector"],
    "viewer": ["powerbi", "database", "dhis2_analysis", "semantic_layer", "risk_scorer", "diagnostic_engine", "analysis_planner", "alert_detector"],
}


def is_tool_allowed(role: str, category: str) -> bool:
    """Check if a user role is allowed to use a tool category."""
    allowed = TOOL_ALLOW_LIST.get(role, [])
    return category in allowed
