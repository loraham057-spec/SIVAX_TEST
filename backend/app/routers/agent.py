"""
Agent router — main entry point for AI assistant interactions.

Flow:
    POST /api/agent/chat
        → Run LangGraph agent
        → Return structured actions + natural language response
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from app.agents.decision_assistant import agent_graph
from app.agents.conversation_memory import ConversationMemory
from app.policy import detect_prompt_input
from langchain_core.messages import HumanMessage, AIMessage

router = APIRouter()

# Upper bounds on what the client can push into the model context.
MAX_HISTORY_TURNS = 20
MAX_MESSAGE_CHARS = 4000


class ChatRequest(BaseModel):
    message: str
    user_role: str = "viewer"
    user_email: str = ""
    history: list[dict] = []
    execution_feedback: list[dict] = []
    # Context from the last successful analysis (indicator, geography, periods).
    # Sent by the frontend so the agent can resolve anaphoric references
    # like "montre l'évolution de ce nombre" or "et pour Kinshasa ?".
    last_analysis_context: Optional[dict] = None
    # Conversation ID for persistent memory (Supabase-backed)
    conversation_id: Optional[str] = None
    user_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    actions: list[dict]
    results: list[dict]
    intent: Optional[str] = None
    status: str = "done"
    clarification: Optional[str] = None
    # Structured clarification (slot, options, partial understanding) so the
    # frontend can render clickable option buttons
    clarification_request: Optional[dict] = None
    confidence: Optional[float] = None
    business_intent: Optional[str] = None
    qid: Optional[str] = None
    analysis_plan: Optional[dict] = None
    response_contract: Optional[dict] = None
    error: Optional[str] = None
    analysis_payload: Optional[dict] = None
    # Context to be sent back in the next request for anaphora resolution
    analysis_context: Optional[dict] = None


def _build_analysis_context(final_state: dict) -> dict | None:
    """Extract a serializable analysis context from the final agent state.

    This is sent to the frontend, which sends it back as
    `last_analysis_context` in the next request, enabling anaphora
    resolution (e.g. "montre l'évolution de ce nombre").
    """
    facts = final_state.get("verified_facts")
    if not facts or not isinstance(facts, dict):
        return None
    metric = facts.get("metric", {})
    scope = facts.get("query_scope", {})
    plan = final_state.get("analysis_plan") or {}
    contract = final_state.get("response_contract") or facts.get("response_contract") or {}
    plan_entities = plan.get("entities") or final_state.get("entities") or {}
    return {
        "version": "2.0",
        "metric_id": metric.get("id", ""),
        "metric_name": metric.get("name", ""),
        "org_unit_id": scope.get("org_unit_id", ""),
        "org_unit_name": scope.get("org_unit_name", ""),
        "periods": scope.get("periods", []),
        "target_org_unit_level": scope.get("target_level"),
        "geographic_levels": plan_entities.get("geographic_levels", []),
        "breakdown": plan_entities.get("breakdown"),
        "antigens": scope.get("antigens") or plan_entities.get("antigens", []),
        "qid": plan.get("qid") or final_state.get("qid"),
        "business_intent": plan.get("analysis_type") or final_state.get("business_intent"),
        "measurement_type": contract.get("measurement_type"),
        "population": contract.get("population"),
        "threshold": contract.get("threshold"),
        "comparison_operator": contract.get("comparison_operator"),
        "analysis_depth": plan_entities.get("analysis_depth"),
        "render_type": plan.get("render_type"),
        "total": facts.get("total"),
        "trend": facts.get("trend"),
        "derived": facts.get("derived"),
        "data_quality": facts.get("data_quality"),
    }


def _build_initial_state(req: ChatRequest) -> dict:
    messages = []
    for msg in req.history:
        if msg.get("role") == "user":
            messages.append(HumanMessage(content=msg.get("content", "")))
        elif msg.get("role") == "assistant":
            messages.append(AIMessage(content=msg.get("content", "")))

    content = req.message
    if req.execution_feedback:
        feedback = "\n".join(
            f"- {item.get('action', 'unknown')}: "
            f"{'success' if item.get('success') else item.get('error', 'failed')}"
            for item in req.execution_feedback
        )
        content = f"{content}\n\n[EXECUTION FEEDBACK]\n{feedback}"
    messages.append(HumanMessage(content=content))

    # ─── Load conversation memory ───────────────────────
    # Load persistent memory for this conversation from Supabase (or in-memory
    # fallback). This gives the agent full multi-turn context: all previous
    # analyses, mentioned entities, user preferences, and topics.
    conv_id = req.conversation_id or "default"
    conv_mem = ConversationMemory(conversation_id=conv_id, user_id=req.user_id)
    conv_mem.load()

    return {
        "messages": messages,
        "user_role": req.user_role,
        "user_email": req.user_email,
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
        "all_verified_facts": [],
        "fact_retries": 0,
        "analysis_payload": None,
        "response": None,
        "error": None,
        # Conversation context for anaphora resolution
        "last_analysis_context": req.last_analysis_context,
        # Conversation memory (persistent, multi-turn)
        "conversation_memory": conv_mem.to_dict(),
        "conversation_id": conv_id,
        "user_id": req.user_id,
    }


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest, request: Request):
    # ─── Prompt injection check ─────────────────────────────
    if detect_prompt_input(req.message):
        raise HTTPException(
            status_code=400,
            detail="Potential prompt injection detected. Please rephrase your request.",
        )

    # ─── Build message history ──────────────────────────────
    # The client returns the entire conversation on every turn. Truncating here
    # bounds the context — and the per-turn cost — regardless of what it sends
    # (PERF-25). Individual messages are capped too, so one pasted document
    # cannot blow up the prompt on its own.
    messages = []
    for msg in req.history[-MAX_HISTORY_TURNS:]:
        content = str(msg.get("content", ""))[:MAX_MESSAGE_CHARS]
        if msg.get("role") == "user":
            messages.append(HumanMessage(content=content))
        elif msg.get("role") == "assistant":
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=req.message[:MAX_MESSAGE_CHARS]))

    # ─── Run the LangGraph agent ────────────────────────────
    initial_state = {
        "messages": messages,
        "user_role": req.user_role,
        "user_email": req.user_email,
        "intent": None,
        "confidence": 0.0,
        "entities": {},
        "status": "processing",
        "clarification": None,
        "actions": [],
        "results": [],
        "iteration": 0,
        "verified_facts": None,
        "fact_retries": 0,
        "response": None,
        "error": None,
    }

    try:
        final_state = await agent_graph.ainvoke(initial_state)
        # Build analysis context for the frontend to send back in follow-ups
        analysis_ctx = _build_analysis_context(final_state)
        # Persist conversation memory to Supabase
        mem_data = final_state.get("conversation_memory")
        if mem_data:
            mem = ConversationMemory.from_dict(mem_data)
            mem.save()
        return ChatResponse(
            response=final_state.get("response", ""),
            actions=final_state.get("actions", []),
            results=final_state.get("results", []),
            intent=final_state.get("intent"),
            status=final_state.get("status", "done"),
            clarification=final_state.get("clarification"),
            clarification_request=final_state.get("clarification_request"),
            confidence=final_state.get("confidence"),
            business_intent=final_state.get("business_intent"),
            qid=final_state.get("qid"),
            analysis_plan=final_state.get("analysis_plan"),
            response_contract=final_state.get("response_contract"),
            error=final_state.get("error"),
            analysis_payload=final_state.get("analysis_payload"),
            analysis_context=analysis_ctx,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {str(e)}")


NODE_STATUSES = {
    "context_analysis": "analyzing",
    "planner": "retrieving_context",
    "tool_execution": "processing_data",
    "result_verification": "validating",
    "response_generation": "generating",
    "fact_check": "validating",
    "clarification": "generating",
    "chat_responder": "generating",
    "fast_navigation": "processing_data",
}


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    if detect_prompt_input(req.message):
        raise HTTPException(
            status_code=400,
            detail="Potential prompt injection detected. Please rephrase your request.",
        )

    async def event_stream():
        state = _build_initial_state(req)
        last_status = None
        try:
            async for update in agent_graph.astream(state, stream_mode="updates"):
                for node, values in update.items():
                    status = NODE_STATUSES.get(node)
                    if status and status != last_status:
                        last_status = status
                        yield f"event: status\ndata: {json.dumps({'status': status})}\n\n"
                    if isinstance(values, dict):
                        state.update(values)

            # Persist conversation memory to Supabase
            mem_data = state.get("conversation_memory")
            if mem_data:
                mem = ConversationMemory.from_dict(mem_data)
                mem.save()

            result = {
                "reply": state.get("response", ""),
                "commands": state.get("actions", []),
                "results": state.get("results", []),
                "intent": state.get("intent"),
                "status": state.get("status", "done"),
                "clarification": state.get("clarification"),
                "clarification_request": state.get("clarification_request"),
                "confidence": state.get("confidence"),
                "business_intent": state.get("business_intent"),
                "qid": state.get("qid"),
                "analysis_plan": state.get("analysis_plan"),
                "response_contract": state.get("response_contract"),
                "error": state.get("error"),
                "analysis_payload": state.get("analysis_payload"),
                "analysis_context": _build_analysis_context(state),
            }
            yield f"event: complete\ndata: {json.dumps(result, ensure_ascii=False, default=str)}\n\n"
        except Exception as exc:
            payload = json.dumps({"status": "error", "error": str(exc)})
            yield f"event: error\ndata: {payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
