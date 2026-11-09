"""
Phase 3 — Pipeline Runner with full tracing.

Runs a test question through the actual agent LangGraph and captures the
intermediate state at every node, producing a structured trace that the
diagnostic engine can analyze to pinpoint the exact failure layer.

The trace captures:
    - intent classification (ANALYZE / CHAT / CHALLENGE)
    - extracted entities (indicator, geography, period, antigens)
    - clarification decision (PROCEED / CLARIFY)
    - planned actions (DHIS2 queries)
    - tool execution results
    - verified facts
    - final response text
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import HumanMessage

from app.agents.decision_assistant import AgentState, build_agent_graph
from app.eval.question_generator import TestCase


@dataclass
class PipelineTrace:
    """Full trace of a question through the agent pipeline."""
    question: str
    # ── Layer 1: Intent classification ──
    intent: str | None = None
    confidence: float = 0.0
    # ── Layer 2: Entity extraction ──
    extracted_entities: dict[str, Any] = field(default_factory=dict)
    # ── Layer 3: Clarification decision ──
    clarification_action: str | None = None  # PROCEED / CLARIFY / PROCEED_WITH_DEFAULTS
    clarification_request: dict[str, Any] | None = None
    # ── Layer 4: Planning ──
    planned_actions: list[dict[str, Any]] = field(default_factory=list)
    # ── Layer 5: Tool execution ──
    tool_results: list[dict[str, Any]] = field(default_factory=list)
    # ── Layer 6: Verification ──
    verified_facts: dict[str, Any] | None = None
    # ── Layer 7: Final response ──
    response_text: str | None = None
    response_status: str | None = None  # "done" / "awaiting_clarification"
    # ── Metadata ──
    elapsed_seconds: float = 0.0
    error: str | None = None
    # ── Expected (from TestCase) ──
    expected: dict[str, Any] = field(default_factory=dict)
    strategy: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "intent": self.intent,
            "confidence": self.confidence,
            "extracted_entities": self.extracted_entities,
            "clarification_action": self.clarification_action,
            "clarification_request": self.clarification_request,
            "planned_actions": self.planned_actions,
            "tool_results": self.tool_results,
            "verified_facts": self.verified_facts,
            "response_text": self.response_text,
            "response_status": self.response_status,
            "elapsed_seconds": self.elapsed_seconds,
            "error": self.error,
            "expected": self.expected,
            "strategy": self.strategy,
        }


# Build the graph once (expensive)
_graph = None


def _get_graph():
    global _graph
    if _graph is None:
        _graph = build_agent_graph()
    return _graph


def run_question(test_case: TestCase, conversation_id: str = "eval") -> PipelineTrace:
    """Run a single test question through the agent pipeline.

    Returns a full PipelineTrace with every intermediate step captured.
    """
    trace = PipelineTrace(
        question=test_case.question,
        expected={
            "indicator_id": test_case.expected_indicator_id,
            "indicator_label": test_case.expected_indicator_label,
            "org_unit_id": test_case.expected_org_unit_id,
            "org_unit_name": test_case.expected_org_unit_name,
            "period": test_case.expected_period,
            "value": test_case.expected_value,
        },
        strategy=test_case.strategy,
    )

    start = time.time()
    try:
        graph = _get_graph()
        initial_state: AgentState = {
            "messages": [HumanMessage(content=test_case.question)],
            "conversation_id": f"eval-{conversation_id}",
            "user_id": None,
            "user_email": "",
            "user_role": "admin",  # eval runs with full permissions
            "intent": None,
            "confidence": 0.0,
            "entities": {},
            "business_intent": None,
            "qid": None,
            "analysis_plan": None,
            "response_contract": None,
            "status": "processing",
            "clarification": None,
            "clarification_decision": None,
            "clarification_request": None,
            "actions": [],
            "results": [],
            "iteration": 0,
            "verified_facts": None,
            "all_verified_facts": None,
            "last_analysis_context": None,
            "conversation_memory": None,
        }

        # Use ainvoke because tool_execution is an async node.
        final_state = asyncio.run(
            graph.ainvoke(initial_state, {"recursion_limit": 25})
        )

        # ── Extract trace from final state ──
        trace.intent = final_state.get("intent")
        trace.confidence = final_state.get("confidence", 0.0)
        trace.extracted_entities = final_state.get("entities", {})

        decision = final_state.get("clarification_decision")
        if decision:
            trace.clarification_action = decision.get("action")
            trace.clarification_request = decision.get("clarification_request")

        trace.planned_actions = final_state.get("actions", [])
        trace.tool_results = final_state.get("results", [])
        trace.verified_facts = final_state.get("verified_facts")
        trace.response_status = final_state.get("status")

        # Extract response text from the last AI message
        messages = final_state.get("messages", [])
        for msg in reversed(messages):
            if hasattr(msg, "content") and msg.content:
                trace.response_text = str(msg.content)
                break

    except Exception as e:
        trace.error = f"{type(e).__name__}: {e}"

    trace.elapsed_seconds = round(time.time() - start, 2)
    return trace
