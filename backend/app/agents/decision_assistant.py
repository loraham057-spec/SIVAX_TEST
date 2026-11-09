"""
LangGraph Agent — AI Decision Assistant (v2).

Graph flow:
    User Input
        ↓
    context_analysis (intent + confidence + extracted entities)
        ↓
    router (conditional edges)
        ├─ CHAT       → chat_responder → END
        ├─ AMBIGUOUS  → clarification → END (status=awaiting_clarification)
        └─ ACTION     → planner → tool_execution → verification
                            ↑                    │
                            └──── retry ─────────┘ (max 2 iterations)
                                                 ↓
                                       response_generation → END

The LLM NEVER generates code, SQL, or Power BI commands.
It only produces structured JSON actions validated by the policy engine.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import re
from typing import Annotated, Any, TypedDict, Optional
from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import (
    SystemMessage,
    HumanMessage,
    AIMessage,
    ToolMessage,
    BaseMessage,
)
from langgraph.graph.message import add_messages
from app.core.config import settings
from app.tools.registry import tool_registry
from app.tools.schema import build_openai_tools, COMMAND_CATALOG
from app.policy import validate_action, ActionStatus
from app.agents.conversation_context import is_followup, resolve_context
from app.agents.clarification_engine import (
    apply_clarification_answer,
    decide as clarification_decide,
    suggest_followups,
)
from app.agents.conversation_memory import ConversationMemory
from app.agents.geo_resolution import (
    NATIONAL_OU,
    PROVINCE_MAP,
    resolve_geography_smart,
    resolve_org_unit,
)
from app.agents.alias_learning import record_alias_confirmation, record_alias_rejection
from app.agents.navigation_fastpath import match_navigation, navigation_reply
from app.tools.analysis_planner import AnalysisPlanner
from app.tools.question_catalog import classify_business_question, extract_business_entities


MAX_ITERATIONS = 2
MAX_FACT_RETRIES = 1
CLARIFICATION_THRESHOLD = 0.65
# Lower threshold for ANALYZE when all key entities are present
ANALYZE_ENTITY_COMPLETE_THRESHOLD = 0.50

# Intents that trigger the action pipeline (planner + tools)
ACTION_INTENTS = {
    "NAVIGATE", "FILTER", "ANALYZE", "FORECAST", "MANAGE_USERS",
    "CONFIGURE", "NOTIFY", "EXPORT",
}

# Intents answered directly without tools
CHAT_INTENTS = {"CHAT", "MEDICAL_INFO"}

# Challenge intent — user is questioning a previous answer's figures
# This must re-trigger the analysis pipeline, NOT go to chat_responder
CHALLENGE_INTENT = "CHALLENGE"
ACTION_INTENTS.add(CHALLENGE_INTENT)

# Patterns that indicate the user is challenging a previous figure
CHALLENGE_PATTERNS = [
    r"pourquoi.*\d",
    r"pas\s+(correct|bon|juste|cohérent)",
    r"différen[ct]",
    r"contradict",
    r"erreur",
    r"incoherent",
    r"incohérent",
    r"pas\s+le\s+même",
    r"pas\s+la\s+même",
    r"le\s+chiffre.*pas",
    r"tu\s+as\s+dit",
    r"tu\s+t'es\s+trompé",
    r"corrige",
    r"recalcul",
]

# Tool categories whose calls are read-only, so several of them can run
# concurrently. Anything that mutates state (users, settings, notifications)
# stays sequential to keep ordering deterministic.
PARALLEL_SAFE_CATEGORIES = {"dhis2_analysis", "powerbi", "ml", "database", "document"}


# ─── State ─────────────────────────────────────────────────

class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    user_role: str
    user_email: str
    # Context analysis
    intent: Optional[str]
    confidence: float
    entities: dict
    business_intent: Optional[str]
    qid: Optional[str]
    analysis_plan: Optional[dict]
    response_contract: Optional[dict]
    # Clarification
    status: str  # "processing" | "awaiting_clarification" | "done"
    clarification: Optional[str]
    # Deterministic clarification decision (from clarification_engine.decide)
    clarification_decision: Optional[dict]
    # Structured clarification request (slot, options, partial understanding)
    clarification_request: Optional[dict]
    # Action pipeline
    actions: list[dict]
    results: list[dict]
    iteration: int
    # Fact checking (ground truth from DHIS2 tool)
    verified_facts: Optional[dict]
    # ALL verified facts when multiple analyses run (e.g. Penta 1 + Penta 3).
    # verified_facts stays as the first one for backward compat; this list
    # holds every analysis result so response_generation can ground ALL figures.
    all_verified_facts: list[dict]
    fact_retries: int
    # Analysis payload for frontend container (single source of truth)
    analysis_payload: Optional[dict]
    # Output
    response: Optional[str]
    error: Optional[str]
    # Conversation context for anaphora resolution (persisted across requests)
    last_analysis_context: Optional[dict]
    # Conversation memory — persistent multi-turn context (like Windsurf/Devin)
    conversation_memory: Optional[dict]
    conversation_id: Optional[str]
    user_id: Optional[str]


# ─── Helpers ───────────────────────────────────────────────

def _llm(temperature: float = 0, fast: bool = False) -> ChatOpenAI:
    """Build a chat model.

    `fast=True` selects the small model. Classification, clarification and
    fact-checking never reach the user as prose — only the last node's output
    does — so paying for the large model on those nodes buys nothing. Routing
    them to a small model is the single biggest lever on LLM cost.
    """
    model = settings.openai_model_fast if fast else settings.openai_model
    # reasoning_effort is only supported by reasoning-capable models
    # (gpt-6-luna, o1, o3, o4-mini, …). Passing it to gpt-4o-mini or
    # gpt-4o raises "Unrecognized request argument supplied: reasoning_effort".
    reasoning_models = ("gpt-6", "o1", "o3", "o4-mini")
    kwargs: dict = {
        "model": model,
        "api_key": settings.openai_api_key,
        "temperature": temperature,
    }
    if model.startswith(reasoning_models):
        # GPT-6 Luna rejects a non-default temperature unless reasoning is disabled.
        kwargs["reasoning_effort"] = "none"
    return ChatOpenAI(**kwargs)


# Messages that need no classification at all: greetings, thanks, farewells.
# Running a full LLM classification on "bonjour" cost one round trip to decide
# something a regex settles (PERF-27).
_TRIVIAL_CHAT = re.compile(
    r"^\W*(bonjour|bonsoir|salut|coucou|hello|hi|hey|bjr|slt"
    r"|merci|merci beaucoup|thanks|thank you|ok|okay|d'accord|daccord"
    r"|au revoir|bye|à bientôt|a bientot|bonne journée|bonne journee)\W*$",
    re.IGNORECASE,
)


def _is_trivial_chat(text: str) -> bool:
    return bool(_TRIVIAL_CHAT.match(text.strip())) and len(text.strip()) <= 40


# Conversation turns kept when calling the model. The client sends the whole
# history back on every turn; without a server-side bound the context — and the
# cost — grows without limit over a long session (PERF-25).
# Lowered from 20 to 8: beyond that the marginal continuity value is negligible
# (the structured conversation memory already carries cross-turn context) while
# each extra assistant turn can weigh 1-2k tokens of Markdown tables — enough
# to blow the 30k TPM limit on gpt-4o in production (PERF-28).
MAX_HISTORY_MESSAGES = 8

# Hard cap on a single history message injected into a prompt. Old assistant
# replies carry full Markdown tables the current turn has no use for.
MAX_HISTORY_MESSAGE_CHARS = 2_000


def _recent_history(messages: list[BaseMessage], limit: int = MAX_HISTORY_MESSAGES) -> list[BaseMessage]:
    """Return the last `limit` messages with oversized text content truncated.

    Only plain-string contents are touched; tool_calls and structured content
    are preserved as-is so tool-calling flows keep working.
    """
    trimmed: list[BaseMessage] = []
    for message in messages[-limit:]:
        content = message.content
        if isinstance(content, str) and len(content) > MAX_HISTORY_MESSAGE_CHARS:
            message = message.model_copy(
                update={"content": content[:MAX_HISTORY_MESSAGE_CHARS] + "\n[... message tronqué ...]"}
            )
        trimmed.append(message)
    return trimmed


# Cap on the number of analysis cells serialized into an LLM prompt. The full
# cell list (up to ~516 zones × N periods) lives in the analysis_payload the
# frontend renders; the writer only needs a representative sample plus the
# precomputed total/trend/top/bottom to draft its table (PERF-28).
MAX_PROMPT_CELLS = 60


def _facts_for_prompt(facts: dict) -> dict:
    """Return a copy of verified_facts safe to inline in a prompt.

    Caps `cells` (keeping the highest and lowest values so ranking answers
    stay grounded) and `values`; the full data stays in the agent state for
    cell-based fact-checking.
    """
    cells = facts.get("cells") or []
    if len(cells) <= MAX_PROMPT_CELLS and len(facts.get("values") or []) <= 100:
        return facts
    slim = dict(facts)
    if len(cells) > MAX_PROMPT_CELLS:
        half = MAX_PROMPT_CELLS // 2
        ranked = sorted(
            (c for c in cells if c.get("value") is not None),
            key=lambda c: c["value"],
            reverse=True,
        )
        slim["cells"] = ranked[:half] + ranked[-half:]
        slim["cells_truncated"] = (
            f"{len(cells) - MAX_PROMPT_CELLS} intermediate cells omitted for brevity "
            f"(total: {len(cells)}); use total/trend/top/bottom for aggregates."
        )
    values = facts.get("values") or []
    if len(values) > 100:
        slim["values"] = values[:100]
    return slim


def _extract_numbers(text: str) -> list[float]:
    """Extract numeric values from text, handling French formats (spaces, commas, K/M suffixes)."""
    numbers: list[float] = []
    # Match numbers with optional thousand separators and K/M suffixes
    for match in re.finditer(r"(\d[\d\s,.]*\d(?:[.,]\d+)?)(\s*[kKmM])?", text):
        raw, suffix = match.group(1), match.group(2)
        cleaned = raw.replace("\u202f", "").replace("\u00a0", "").replace(" ", "")
        cleaned = cleaned.replace(",", ".") if cleaned.count(",") == 1 and "." not in cleaned else cleaned.replace(",", "")
        try:
            value = float(cleaned)
        except ValueError:
            continue
        if suffix:
            value *= 1_000 if suffix.strip().lower() == "k" else 1_000_000
        numbers.append(value)
    return numbers


def _summarize_results(results: list[dict]) -> list[dict]:
    """Strip action results down to what the writer actually needs.

    The full results were serialized with `indent=2`, which now includes the
    complete analytics payload added for PERF-01 — hundreds of rows the response
    model has no use for, at full token price. The verified facts are injected
    separately, so the result entry only has to carry status and identity.
    """
    trimmed: list[dict] = []
    for entry in results:
        item = {
            "action": entry.get("action"),
            "status": entry.get("status"),
        }
        for key in ("error", "risk", "description"):
            if entry.get(key):
                item[key] = entry[key]

        result = entry.get("result")
        if isinstance(result, dict):
            # Keep the identity of what was analysed, never the raw rows.
            summary = {k: result[k] for k in ("status", "message") if k in result}
            metric = result.get("metric")
            if isinstance(metric, dict):
                summary["metric"] = {"id": metric.get("id"), "name": metric.get("name")}
            if result.get("ambiguous"):
                summary["ambiguous"] = True
            if summary:
                item["result"] = summary

        trimmed.append(item)
    return trimmed


# Tokens that look like figures but are never data: DHIS2 period codes
# (202501), calendar years, dates, and DHIS2 UIDs. Counting them as claimed
# values triggered regeneration on perfectly correct answers (PERF-27).
_STRUCTURAL_TOKENS = re.compile(
    r"\b(?:20\d{2}(?:0[1-9]|1[0-2]))\b"          # YYYYMM period codes
    r"|\b(?:19|20)\d{2}\b"                        # years
    r"|\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b"        # dates
    r"|\b[A-Za-z][A-Za-z0-9]{10}\b"              # DHIS2 UIDs
)


def _strip_structural_tokens(text: str) -> str:
    return _STRUCTURAL_TOKENS.sub(" ", text)


def _parse_json(content: str) -> dict:
    """Extract the first JSON object from LLM output, tolerant to markdown fences."""
    text = content.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(
            line for line in lines if not line.strip().startswith("```")
        ).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}
    try:
        return json.loads(text[start : end + 1])
    except (json.JSONDecodeError, ValueError):
        return {}


# ─── Nodes ─────────────────────────────────────────────────

def context_analysis(state: AgentState) -> dict:
    """
    Classify intent, score confidence, and extract structured entities
    (indicator keywords, period, geography, visualization) in one LLM call.
    """
    last_message = state["messages"][-1]
    if not isinstance(last_message, HumanMessage):
        return {"intent": "CHAT", "confidence": 1.0, "entities": {}, "status": "processing"}

    # Greetings and acknowledgements need no model call to be classified.
    if _is_trivial_chat(str(last_message.content)):
        return {"intent": "CHAT", "confidence": 1.0, "entities": {}, "status": "processing"}

    # Bare page changes ("va sur l'onglet settings") are settled by a regex
    # and emit their commands directly — no classifier, no planner.
    nav = match_navigation(str(last_message.content))
    if nav:
        return {
            "intent": "NAVIGATE",
            "confidence": 1.0,
            "entities": {"destination": nav["destination"], "settings_tab": nav["tab"]},
            "actions": nav["actions"],
            "status": "processing",
        }

    system = SystemMessage(
        content=(
            "You are an intent and entity extractor for a healthcare analytics platform "
            "for the Democratic Republic of Congo (DHIS2 / SNIS RDC).\n\n"
            "Analyze the user's latest message and respond with ONLY a JSON object:\n"
            "{\n"
            '  "intent": one of [NAVIGATE, FILTER, ANALYZE, FORECAST, CHALLENGE, '
            "MANAGE_USERS, CONFIGURE, NOTIFY, EXPORT, MEDICAL_INFO, CHAT],\n"
            '  "confidence": float 0.0-1.0 (how certain you are about the intent AND '
            "that the request contains enough information to act on),\n"
            '  "entities": {\n'
            '    "indicator_keywords": [health indicators mentioned, e.g. "paludisme", "vaccination BCG"],\n'
            '    "period": period mentioned or null (e.g. "LAST_3_MONTHS", "LAST_12_MONTHS", "THIS_YEAR", "202503"),\n'
            '    "periods": explicit period codes when the user cites a custom range, e.g. ["2022","2023","2024","2025"] for a 2022-2025 year range, or ["202503","202504"] for monthly ranges. Leave null if a preset applies.\n'
            '    "geography": geographic scope or null (e.g. "provinces", "zones de santé", a province name),\n'
            '    "visualization": preferred chart type or null ("line", "bar", "pie", "kpi", "table"),\n'
            '    "antigens": vaccine antigens mentioned,\n'
            '    "measurement_type": "value" | "count" | "proportion" | "rate",\n'
            '    "geographic_levels": any of [health_area, health_zone, province, national],\n'
            '    "threshold": numeric threshold or null,\n'
            '    "comparison_operator": "gt" | "gte" | "lt" | "lte" | "eq" | null,\n'
            '    "population": target population or null,\n'
            '    "analysis_depth": "situation" | "diagnosis" | "risk" | "action",\n'
            '    "aggregation_mode": "single" | "all_mentioned" | "ambiguous"\n'
            "  },\n"
            '  "missing_info": [what critical information is missing to fulfill the request, if any]\n'
            "}\n\n"
            "Intent definitions:\n"
            "- ANALYZE: requests health data, statistics, comparisons, trends from DHIS2\n"
            "- CHALLENGE: user is questioning or contradicting a figure from a previous answer "
            "(e.g. 'pourquoi 262K et pas 1.3M ?', 'le chiffre n\'est pas correct', 'tu as dit X mais maintenant Y'). "
            "This MUST be treated as ANALYZE (re-run the analysis), NOT as CHAT.\n"
            "- MEDICAL_INFO: general medical/epidemiological knowledge questions (not platform data)\n"
            "- NAVIGATE: go to a page. FILTER: filter alerts/data. FORECAST: predictions.\n"
            "- MANAGE_USERS: user administration. CONFIGURE: settings. NOTIFY: notifications.\n"
            "- EXPORT: export reports. CHAT: greetings, small talk, meta questions about the assistant.\n\n"
            "CRITICAL RULES for confidence scoring:\n"
            "1. If the user explicitly mentions multiple categories with 'et' / 'and' / 'les deux' "
            "(e.g. 'cas présumés ET confirmés'), this is NOT ambiguity — it is a request for the "
            "aggregate of ALL mentioned categories. Set aggregation_mode='all_mentioned' and do NOT "
            "lower confidence for this reason.\n"
            "2. Set confidence LOW (<0.65) ONLY when: the request is genuinely vague, the indicator "
            "is truly unclear (no recognizable health term), OR critical geographic/period info is "
            "missing AND cannot be inferred from conversation history.\n"
            "3. If the user mentions a specific indicator + a geographic area + a period (even "
            "relative like 'mars 2025' or 'last 3 months'), confidence should be HIGH (>=0.7).\n"
            "4. aggregation_mode='ambiguous' should ONLY be used when the user genuinely didn't "
            "specify what they want (e.g. 'donne-moi les cas' without specifying confirmed vs "
            "suspected, and the context doesn't clarify).\n\n"
            "Consider the conversation history when extracting entities — the user may be "
            "answering a previous clarification question or following up on a previous analysis "
            "(e.g. 'et jusqu'à juillet ?' should inherit the indicator and geography from the "
            "previous turn).\n\n"
            "CRITICAL — Anaphora resolution (pronouns and references):\n"
            "- 'ce nombre', 'ces données', 'ce chiffre', 'ces cas' → inherit the indicator "
            "from the previous analysis turn. Extract the SAME indicator_keywords.\n"
            "- 'là', 'cette province', 'cette zone' → inherit the geography from the "
            "previous turn.\n"
            "- 'depuis', 'jusqu'à', 'à partir de' → inherit and extend the period context.\n"
            "- When the user says 'montre l'évolution de ce nombre', you MUST extract the "
            "SAME indicator_keywords as the previous analysis, NOT search for a new indicator.\n"
            "- If you cannot resolve a reference from history, set missing_info accordingly.\n"
        )
    )

    # Include recent history for context (clarification follow-ups).
    # Classification is a small, well-specified task — the fast model handles it.
    recent = state["messages"][-6:]
    response = _llm(fast=True).invoke([system] + recent)
    parsed = _parse_json(response.content)

    intent = str(parsed.get("intent", "CHAT")).upper()
    if intent not in ACTION_INTENTS and intent not in CHAT_INTENTS:
        intent = "CHAT"
    try:
        confidence = float(parsed.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    # ─── Regex-based challenge detection (complements LLM) ───
    # If the user's message matches challenge patterns AND there are
    # verified_facts from a previous turn, force CHALLENGE intent.
    # This is more reliable than depending on the LLM to classify it.
    last_msg_content = ""
    if isinstance(last_message, HumanMessage):
        last_msg_content = last_message.content or ""
    has_previous_facts = state.get("verified_facts") is not None
    if has_previous_facts and any(
        re.search(pattern, last_msg_content, re.IGNORECASE)
        for pattern in CHALLENGE_PATTERNS
    ):
        intent = CHALLENGE_INTENT
        confidence = max(confidence, 0.8)  # high confidence — we detected it

    entities = parsed.get("entities")
    if not isinstance(entities, dict):
        entities = {}
    entities["missing_info"] = parsed.get("missing_info", [])

    # ─── Defensive: normalize scalar entity fields that LLMs sometimes ─
    # return as lists (e.g. "analysis_depth": ["diagnosis"]). These fields
    # are used as dict keys or in string comparisons downstream; a list
    # would crash with "unhashable type: 'list'" or silently mismatch.
    _SCALAR_ENTITY_KEYS = (
        "analysis_depth", "geography", "visualization", "period",
        "measurement_type", "comparison_operator", "population",
        "aggregation_mode", "breakdown",
    )
    for _k in _SCALAR_ENTITY_KEYS:
        _v = entities.get(_k)
        if isinstance(_v, list):
            entities[_k] = _v[0] if _v else None

    deterministic_entities = extract_business_entities(last_msg_content)
    for key, value in deterministic_entities.items():
        if value not in (None, [], ""):
            entities[key] = value
    catalog_match = classify_business_question(last_msg_content)
    business_intent = catalog_match.get("intent")
    qid = catalog_match.get("qid")
    if catalog_match.get("status") == "ready" and intent in ("CHAT", "MEDICAL_INFO"):
        intent = "ANALYZE"
        confidence = max(confidence, catalog_match.get("confidence", 0.0), 0.7)

    # ─── Anaphora resolution via conversation memory ───
    # Load conversation memory (from Supabase or in-memory fallback)
    conv_mem_data = state.get("conversation_memory")
    if conv_mem_data:
        conv_mem = ConversationMemory.from_dict(conv_mem_data)
    else:
        conv_mem = ConversationMemory(
            conversation_id=state.get("conversation_id") or "default",
            user_id=state.get("user_id"),
        )
        conv_mem.load()

    # ─── Pending clarification: interpret the reply first ───
    # If the previous turn asked a structured clarification, try to match
    # this message against the proposed options and merge the saved partial
    # entities. If the user ignored the question, abandon it cleanly.
    pending = conv_mem.get_pending_clarification()
    if pending:
        answer = apply_clarification_answer(last_msg_content, pending)
        if answer["matched"]:
            for key, value in answer["entities"].items():
                if value not in (None, [], "") and entities.get(key) in (None, [], ""):
                    entities[key] = value
            intent = "ANALYZE"
            confidence = max(confidence, 0.85)
            conv_mem.store_clarification(
                pending.get("question", ""), last_msg_content
            )
            # ─── Platform-wide learning ───
            # The user just confirmed what a misspelled/unknown name refers
            # to. Persist the alias so ALL users benefit next time.
            _learn_from_clarification_answer(pending, answer, conv_mem.conversation_id)
        else:
            # ─── Negative feedback (opt 8) ───
            # The user's reply didn't match any proposed option. If this
            # clarification was triggered by a misspelled name (alias_original
            # is set), record a rejection so a wrong learned alias loses
            # confidence and eventually gets removed.
            _reject_from_clarification_answer(pending)
        conv_mem.clear_pending_clarification()

    # Get the last analysis from memory (falls back to last_analysis_context
    # from the frontend for backward compatibility)
    last_ctx = state.get("last_analysis_context")
    if not last_ctx:
        last_ctx = conv_mem.get_last_analysis()
    elif isinstance(last_ctx, dict):
        # Merge: memory might have more history
        mem_last = conv_mem.get_last_analysis()
        if mem_last and not last_ctx.get("metric_id"):
            last_ctx = mem_last

    if last_ctx and isinstance(last_ctx, dict):
        msg_text = last_message.content if isinstance(last_message, HumanMessage) else ""
        if is_followup(msg_text):
            entities, ctx_summary = resolve_context(msg_text, entities, last_ctx)
            entities["_context_summary"] = ctx_summary
            if confidence < 0.7:
                confidence = max(confidence, 0.7)

    # ─── Analytical follow-up override ───────────────────────
    # When the LLM classifies a follow-up like "quelles sont les zones les
    # plus a risque ?" as CHAT/MEDICAL_INFO, but the deterministic intent
    # detector sees an analytical intent (risk_alert, diagnosis, ranking…)
    # AND there is a previous analysis context to inherit from (loaded above
    # from conversation memory or frontend), force ANALYZE. Without this,
    # the agent gives a generic text answer instead of querying DHIS2 with
    # the inherited indicator. This runs AFTER context loading so the
    # memory-sourced last_ctx is available.
    from app.tools.question_catalog import ANALYTICAL_INTENTS
    if (
        intent in ("CHAT", "MEDICAL_INFO")
        and business_intent in ANALYTICAL_INTENTS
        and (last_ctx or state.get("verified_facts"))
    ):
        intent = "ANALYZE"
        confidence = max(confidence, 0.7)

    # Build the full memory context for the planner
    memory_prompt = conv_mem.get_relevant_context(
        last_message.content if isinstance(last_message, HumanMessage) else ""
    )

    # ─── Deterministic clarification decision ───
    # Runs AFTER context resolution so inherited slots never re-trigger
    # a clarification. Only relevant for analytical intents.
    decision = None
    if intent in ("ANALYZE", CHALLENGE_INTENT):
        # Pre-compute the smart geography resolution so detect_ambiguities can
        # surface misspelled place names as a clarification question instead
        # of silently guessing (and possibly matching the wrong org unit).
        # Skip the costly candidate search when the name is already an exact
        # province match (the common case — avoids scanning ~500 org units).
        geography = entities.get("geography")
        if geography and not entities.get("org_unit_id"):
            geo_res = resolve_geography_smart(str(geography))
            # Only store the resolution if it's NOT already resolved —
            # detect_ambiguities only needs ambiguous/not_found results.
            if geo_res.get("status") not in ("resolved", "generic"):
                entities["_geo_resolution"] = geo_res
        # Same idea for misspelled indicator names.
        indicator_query = (
            entities.get("metric_id")
            or (entities.get("indicator_keywords") and " ".join(entities["indicator_keywords"]))
            or ""
        )
        if indicator_query and not entities.get("metric_id"):
            from app.agents.metric_resolution import resolve_metric_smart
            metric_res = resolve_metric_smart(str(indicator_query))
            if metric_res.get("status") not in ("resolved",):
                entities["_metric_resolution"] = metric_res
        decision = clarification_decide(last_msg_content, entities, qid, business_intent)
        if decision["action"] == "PROCEED_WITH_DEFAULTS":
            entities["_assumptions"] = decision["assumptions"]

    # ─── Health terminology & domain knowledge ───
    # Resolve DRC vaccination abbreviations (VPOb, nVPO2, PFA, LQAS, etc.)
    # and enrich the state with relevant domain context from doc_sante.
    # This helps the planner and response generator use correct terminology
    # and include operational context (formulas, thresholds, campaign info).
    from app.tools.semantic_layer import SemanticLayer
    _sl = SemanticLayer()
    health_context = _sl.get_health_context(last_msg_content)
    if health_context.get("terminology") or health_context.get("formulas") or health_context.get("campaign_type"):
        entities["_health_context"] = health_context

    return {
        "intent": intent,
        "confidence": confidence,
        "entities": entities,
        "business_intent": business_intent,
        "qid": qid,
        "status": "processing",
        "clarification_decision": decision,
        "conversation_memory": conv_mem.to_dict(),
        "_memory_prompt": memory_prompt,
    }


def route_after_analysis(state: AgentState) -> str:
    """Conditional edge: decide which branch to take after context analysis."""
    intent = state.get("intent") or "CHAT"
    confidence = state.get("confidence", 0.5)
    entities = state.get("entities", {})
    decision = state.get("clarification_decision")

    # Deterministic navigation: commands were already produced upstream.
    if intent == "NAVIGATE" and state.get("actions"):
        return "fast_navigation"

    # CHALLENGE intent always goes to planner (re-run analysis, never chat)
    if intent == CHALLENGE_INTENT:
        return "planner"

    if intent in CHAT_INTENTS:
        return "chat_responder"

    # ─── Deterministic decision takes precedence ───
    # CLARIFY: a required slot is missing or genuinely ambiguous.
    # PROCEED / PROCEED_WITH_DEFAULTS: slots are complete (possibly via safe
    # defaults) — proceed even if the LLM confidence is low.
    if decision:
        if decision["action"] == "CLARIFY":
            return "clarification"
        return "planner"

    # ─── Fallback: legacy confidence-based routing ───
    if intent in ACTION_INTENTS and confidence < CLARIFICATION_THRESHOLD:
        has_indicator = bool(entities.get("indicator_keywords"))
        has_geo = bool(entities.get("geography"))
        has_period = bool(entities.get("period"))
        if has_indicator and has_geo and has_period:
            if confidence >= ANALYZE_ENTITY_COMPLETE_THRESHOLD:
                return "planner"
        return "clarification"

    return "planner"


def clarification(state: AgentState) -> dict:
    """Ask ONE structured clarification question when the request is ambiguous.

    The question skeleton (slot, options, partial understanding) is built
    deterministically by clarification_engine; the LLM only phrases it in
    natural French. A template fallback guarantees a usable question even
    if the LLM call fails.
    """
    entities = state.get("entities", {})
    intent = state.get("intent", "ANALYZE")
    decision = state.get("clarification_decision") or {}
    request = decision.get("clarification_request")

    template = ""
    if request:
        options_text = ", ".join(
            option["label"] for option in request.get("options", [])
        )
        template = request["question"]
        if options_text:
            template = f"{template} Options : {options_text}."
        if request.get("partial_understanding"):
            template = (
                f"J'ai compris : {request['partial_understanding']}. {template}"
            )

        system = SystemMessage(
            content=(
                "You are SIVAX, an AI assistant for a healthcare analytics platform (DHIS2, RDC). "
                "The user's request needs ONE clarification. Rephrase the following structured "
                "question in natural, polite French (max 3 sentences). Keep ALL the options, "
                "and mention what was already understood if provided. Do NOT answer the "
                "question yourself and do NOT ask about anything else.\n\n"
                f"Slot to clarify: {request['slot']} ({request.get('reason', '')})\n"
                f"Question: {request['question']}\n"
                f"Options: {options_text or 'free answer'}\n"
                f"Already understood: {request.get('partial_understanding') or 'nothing yet'}\n"
                f"Defaults available: {request.get('defaults_available') or {}}"
            )
        )
        try:
            response = _llm(temperature=0.3, fast=True).invoke(
                [system] + state["messages"][-4:]
            )
            question_text = response.content or template
        except Exception:
            question_text = template
    else:
        # Legacy fallback: free-form LLM clarification (no structured skeleton)
        missing = entities.get("missing_info", [])
        keywords = entities.get("indicator_keywords", [])
        system = SystemMessage(
            content=(
                "You are SIVAX, an AI assistant for a healthcare analytics platform (DHIS2, RDC). "
                "The user's request is ambiguous or incomplete. Generate ONE short, polite "
                "clarification question in French to get the missing information.\n\n"
                f"Detected intent: {intent}\n"
                f"Indicator keywords found: {', '.join(keywords) if keywords else 'none'}\n"
                f"Missing information: {', '.join(missing) if missing else 'unclear request'}\n\n"
                "Rules:\n"
                "- Be specific: propose concrete options the user can pick "
                "(e.g. 'Voulez-vous les cas de paludisme confirmés ou suspects ?').\n"
                "- Suggest defaults when reasonable (e.g. period: last 12 months, level: provinces).\n"
                "- Maximum 3 sentences. Do NOT answer the question yourself."
            )
        )
        response = _llm(temperature=0.3, fast=True).invoke(
            [system] + state["messages"][-6:]
        )
        question_text = response.content

    # Persist the pending clarification so the next turn can interpret the
    # user's reply as an answer to this specific slot.
    updates: dict = {
        "clarification": question_text,
        "clarification_request": request,
        "response": question_text,
        "status": "awaiting_clarification",
        "messages": [AIMessage(content=question_text)],
    }
    if request:
        conv_mem_data = state.get("conversation_memory")
        conv_mem = (
            ConversationMemory.from_dict(conv_mem_data) if conv_mem_data
            else ConversationMemory(
                conversation_id=state.get("conversation_id") or "default",
                user_id=state.get("user_id"),
            )
        )
        conv_mem.set_pending_clarification({**request, "question": question_text})
        updates["conversation_memory"] = conv_mem.to_dict()
    return updates


def fast_navigation(state: AgentState) -> dict:
    """Validate and hand navigation commands to the frontend without any model call.

    Mirrors the frontend-delegation branch of tool_execution: the policy
    engine still checks schema and role permissions, so a viewer asking for
    the users tab gets the page but not the tab.
    """
    entities = state.get("entities") or {}
    actions: list[dict] = []
    results: list[dict] = []

    for action in state.get("actions", []):
        validation = validate_action(
            action=action["action"],
            args=action.get("args", {}),
            user_role=state["user_role"],
        )
        if not validation["valid"]:
            results.append({
                "action": action["action"],
                "status": ActionStatus.REJECTED,
                "error": validation["error"],
            })
            continue
        actions.append({"action": action["action"], "args": validation["sanitized_args"]})
        results.append({
            "action": action["action"],
            "args": validation["sanitized_args"],
            "status": ActionStatus.AUTO_EXECUTED,
            "description": validation["description"],
        })

    tab_kept = any(a["action"] == "switch_settings_tab" for a in actions)
    if any(a["action"] == "navigate" for a in actions):
        response = navigation_reply(
            entities.get("destination", ""),
            entities.get("settings_tab") if tab_kept else None,
        )
    else:
        response = "Je ne peux pas ouvrir cette page avec votre rôle actuel."

    return {
        "actions": actions,
        "results": results,
        "response": response,
        "status": "done",
        "messages": [AIMessage(content=response)],
    }


def chat_responder(state: AgentState) -> dict:
    """Answer CHAT / MEDICAL_INFO intents directly, with medical guardrails."""
    intent = state.get("intent", "CHAT")

    medical_rules = ""
    if intent == "MEDICAL_INFO":
        medical_rules = (
            "\n- This is a medical/epidemiological knowledge question. Answer factually "
            "using established public health knowledge (WHO standards, DRC health programs).\n"
            "- NEVER provide individual diagnosis, prescriptions, or drug dosages.\n"
            "- If the question concerns personal medical advice, state that you can only "
            "provide general information and recommend consulting a health professional.\n"
            "- If the question could be answered with platform data, propose running an "
            "analysis (e.g. 'Je peux aussi analyser les données réelles sur ce sujet').\n"
        )

    system = SystemMessage(
        content=(
            "You are SIVAX, the AI assistant of a healthcare analytics platform for the "
            "Democratic Republic of Congo, connected to DHIS2 (SNIS RDC): 26 provinces, "
            "~516 health zones, data on vaccination, malaria, maternal health, nutrition, "
            "and disease surveillance.\n"
            "Respond concisely and professionally in the user's language (French by default)."
            f"{medical_rules}\n"
            "Never invent figures or statistics. If asked for data, explain that you can "
            "run an analysis on the real DHIS2 data."
        )
    )

    response = _llm(temperature=0.3).invoke([system] + _recent_history(state["messages"]))

    return {
        "response": response.content,
        "status": "done",
        "messages": [response],
    }


def planner(state: AgentState) -> dict:
    """Use the LLM with tool-calling to produce structured actions."""
    entities = state.get("entities", {})
    geography = entities.get("geography") if entities else None

    # ─── Use the org unit confirmed by the user in a clarification ───
    # apply_clarification_answer injects org_unit_id/org_unit_name directly
    # when the user picked a structured "org_unit:<id>" option. Re-resolving
    # the (mis)spelled geography would risk re-mismatching the wrong unit.
    confirmed_ou_id = entities.get("org_unit_id") if entities else None
    confirmed_ou_name = entities.get("org_unit_name") if entities else None
    if confirmed_ou_id and confirmed_ou_id != NATIONAL_OU:
        resolved_ou_id, resolved_ou_name = confirmed_ou_id, confirmed_ou_name or geography or ""
    else:
        # Resolve geography to a DHIS2 org unit ID
        resolved_ou_id, resolved_ou_name = resolve_org_unit(geography)

    # ─── Fallback: search the question text for a specific org unit ───
    # When the LLM extracts geography as a generic scope (e.g. "zones de santé")
    # instead of the specific place name (e.g. "Mosango"), resolve_org_unit
    # returns national. Try to find the specific org unit in the raw question.
    if resolved_ou_id == NATIONAL_OU:
        last_human = next(
            (message for message in reversed(state["messages"]) if isinstance(message, HumanMessage)),
            None,
        )
        if last_human:
            question_text = last_human.content or ""
            # Look for patterns like "zone de santé de X", "zone de sante X",
            # "province de X", "dans X" after a geographic keyword
            geo_match = re.search(
                r"(?:zone\s+de\s+sant[eé]\s+(?:de\s+|du\s+|de\s+la\s+|des\s+)?)"
                r"([A-ZÀ-Ý][\w\s'-]+?)"
                r"(?:\s+(?:pour|au|en|durant|sur|en\s+\d)|[,.;?!]|$)",
                question_text,
                re.IGNORECASE,
            )
            if not geo_match:
                geo_match = re.search(
                    r"(?:dans\s+(?:la\s+|le\s+|l')?)([A-ZÀ-Ý][\w\s'-]+?)"
                    r"(?:\s+(?:pour|au|en|durant|sur|en\s+\d)|[,.;?!]|$)",
                    question_text,
                    re.IGNORECASE,
                )
            if geo_match:
                place_name = geo_match.group(1).strip()
                # Avoid matching generic terms
                if place_name.lower() not in ("la province", "le pays", "le national", "la zone"):
                    # resolve_org_unit handles province aliases and fuzzy
                    # spelling variants before falling back to find_org_unit.
                    fallback_id, fallback_name = resolve_org_unit(place_name)
                    if fallback_id != NATIONAL_OU:
                        resolved_ou_id = fallback_id
                        resolved_ou_name = fallback_name

    # ─── Use context summary from anaphora resolution ───
    # The context_analysis node already resolved references like "ce nombre"
    # using the last_analysis_context. We just use the summary here.
    context_summary = entities.get("_context_summary", "") if entities else ""

    # Also use last_analysis_context directly for org unit resolution
    # (in case context_analysis didn't set geography but the context has it)
    last_ctx = state.get("last_analysis_context")
    if last_ctx and isinstance(last_ctx, dict):
        ctx_ou_id = last_ctx.get("org_unit_id", "")
        ctx_ou_name = last_ctx.get("org_unit_name", "")
        ctx_metric_id = last_ctx.get("metric_id", "")
        ctx_metric_name = last_ctx.get("metric_name", "")
        ctx_periods = last_ctx.get("periods", [])

        # If geography wasn't resolved from the message, use the context's org unit
        if resolved_ou_id == NATIONAL_OU and ctx_ou_id and ctx_ou_id != NATIONAL_OU:
            resolved_ou_id, resolved_ou_name = ctx_ou_id, ctx_ou_name

        # Enrich context summary with explicit metric ID if available
        if ctx_metric_id and not context_summary:
            context_summary = (
                f"Previous analysis used indicator '{ctx_metric_name}' "
                f"(DHIS2 ID: {ctx_metric_id}), geography '{ctx_ou_name}' "
                f"({ctx_ou_id}), periods {ctx_periods}."
            )

    if state.get("intent") in ("ANALYZE", CHALLENGE_INTENT):
        last_human = next(
            (message for message in reversed(state["messages"]) if isinstance(message, HumanMessage)),
            None,
        )
        question = last_human.content if last_human else ""
        analysis_plan = AnalysisPlanner().create_plan({"question": question, "entities": entities})
        actions = analysis_plan.get("executable_actions", [])
        for action in actions:
            action_args = action.setdefault("args", {})
            if not action_args.get("orgUnitId"):
                action_args["orgUnitId"] = resolved_ou_id
            if action_args["orgUnitId"] != NATIONAL_OU:
                action_args.pop("targetOrgUnitLevel", None)
        if actions:
            return {
                "actions": actions,
                "analysis_plan": analysis_plan,
                "response_contract": analysis_plan.get("response_contract"),
                "business_intent": analysis_plan.get("analysis_type"),
                "qid": analysis_plan.get("qid"),
            }

    llm = _llm().bind_tools(build_openai_tools(state["user_role"]))
    entities_hint = ""
    if entities:
        entities_hint = (
            "\n\nExtracted context from the user's request:\n"
            f"- Indicator keywords: {entities.get('indicator_keywords', [])}\n"
            f"- Period: {entities.get('period')}\n"
            f"- Geography: {entities.get('geography')}\n"
            f"- Resolved orgUnitId: {resolved_ou_id} ({resolved_ou_name})\n"
            f"- Visualization: {entities.get('visualization')}\n"
            "Use the Resolved orgUnitId as the orgUnitId parameter. "
            "Do NOT use the national default unless geography is empty or 'national'."
        )
        if context_summary:
            entities_hint += (
                f"\n\nCONVERSATION CONTEXT (from previous analysis):\n"
                f"{context_summary}\n"
                "The user is referencing the previous analysis. Use the SAME indicator "
                "and geography. Do NOT search for a different indicator."
            )

    # On retry, include previous errors so the planner can correct course
    retry_hint = ""
    if state.get("iteration", 0) > 0 and state.get("error"):
        retry_hint = (
            f"\n\nA previous attempt failed with: {state['error']}. "
            "Correct the arguments or choose a different approach."
        )

    # ─── Conversation memory (full multi-turn context) ───
    memory_prompt = state.get("_memory_prompt", "")

    # Build province list for the prompt
    province_list = ", ".join(f"{name} ({ou_id})" for name, ou_id in
                              sorted(PROVINCE_MAP.items(), key=lambda x: x[0])[:26])

    system = SystemMessage(
        content=(
            "You are an AI Decision Assistant for a healthcare analytics platform "
            "(DHIS2, Democratic Republic of Congo).\n"
            "You help users navigate, analyze health data, manage alerts, and configure "
            "settings.\n\n"
            "RULES:\n"
            "1. You MUST NEVER generate JavaScript, SQL, or Power BI commands.\n"
            "2. You can ONLY produce structured tool calls (commands).\n"
            "3. The backend validates every action before execution.\n"
            "4. For DHIS2 data questions, ALWAYS use run_dhis2_analysis. NEVER answer "
            "data questions from your internal knowledge — the platform's DHIS2 data is "
            "LIVE and current, your training cutoff does NOT apply.\n"
            "5. Infer reasonable defaults: national level (ymGeqzoPhN3), "
            "periodPreset=LAST_12_MONTHS, targetOrgUnitLevel=2 for geographic breakdown.\n"
            "6. When the user mentions specific months (e.g. 'septembre 2025', 'mars 2025'), "
            "convert to YYYYMM period codes and pass via the 'periods' parameter. "
            "For a range (mars à juillet 2025), list ALL months: 202503,202504,202505,202506,202507. "
            "For a YEAR range (e.g. 'de 2022 à 2025', '2022-2025', 'entre 2022 et 2025'), "
            "list ALL years as YYYY codes via 'periods' (e.g. ['2022','2023','2024','2025']) "
            "and keep periodPreset as LAST_12_MONTHS. NEVER put a year range in periodPreset.\n"
            "7. Visualization inference: use 'line' for evolution/trend over time "
            "(courbe, évolution, tendance), 'bar' for geographic breakdown "
            "(par province, par zone, répartition), 'pie' for proportions, "
            "'kpi' for single totals. Use 'auto' only if unclear.\n"
            "8. When the user asks for a specific province (e.g. 'Kinshasa'), set "
            "orgUnitId to that province's DHIS2 ID (use the Resolved orgUnitId from the "
            "extracted context) and do NOT set targetOrgUnitLevel "
            "(single province = aggregate, not breakdown).\n"
            "9. When the user asks for a province breakdown (e.g. 'par province'), "
            "set orgUnitId to national (ymGeqzoPhN3) and targetOrgUnitLevel=2.\n"
            "10. ALWAYS use the 'Resolved orgUnitId' from the extracted context when "
            "available. Do NOT default to national if a province was mentioned.\n"
            "11. For UI and administration requests (navigate, filter alerts, settings, "
            "user management), CALL the matching tool — never answer that you cannot do it: "
            "risky actions are shown to the user for confirmation before they run. For "
            "create_user, build full_name from the given first and last names and, when no "
            "role is stated, use role='viewer' and say so in your reply.\n"
            "12. Permissions are NOT your decision: if a tool is in your tool list, the "
            "user IS allowed to use it — call it. Only when the needed tool is absent from "
            "your list (e.g. no create_user tool), reply plainly that the current role does "
            "not allow the action and who to contact; do NOT substitute another tool such "
            "as navigate, and do NOT claim the action awaits confirmation.\n"
            f"\nDRC Provinces (name → DHIS2 ID): {province_list}\n"
            f"\nThe user's role is: {state['user_role']}"
            f"{entities_hint}"
            f"{memory_prompt}"
            f"{retry_hint}"
        )
    )

    messages = [system] + _recent_history(state["messages"])
    response = llm.invoke(messages)

    actions: list[dict] = []
    if response.tool_calls:
        for tc in response.tool_calls:
            actions.append({
                "action": tc["name"],
                "args": tc["args"],
            })

    # If the planner produced no tool calls, treat its text as a direct answer
    if not actions and response.content:
        return {
            "actions": [],
            "response": response.content,
            "status": "done",
            "messages": [response],
        }

    return {
        "actions": actions,
        "messages": [response],
    }


def route_after_planner(state: AgentState) -> str:
    """If the planner answered directly without tools, skip execution."""
    if not state.get("actions"):
        return END
    return "tool_execution"


async def tool_execution(state: AgentState) -> dict:
    """Execute each validated action through the appropriate tool.

    Results keep the order the planner produced. Read-only tool calls are
    dispatched concurrently — a question comparing two indicators used to add
    their DHIS2 latencies instead of overlapping them (PERF-28) — while
    side-effecting categories stay strictly sequential.
    """
    results: list[dict] = []
    # ToolMessage objects fed back to the LLM (one per tool_call_id), rebuilt
    # here because the planner's assistant message carried the tool_calls.
    tool_messages: list[ToolMessage] = []
    # Slot index → coroutine, so concurrent results land back in planner order.
    pending: dict[int, Any] = {}

    # Get the tool_call_ids from the last assistant message (planner response).
    # Map by INDEX (not by action name) to handle duplicate action names correctly.
    last_msg = state["messages"][-1] if state["messages"] else None
    tool_call_ids: list[str] = []
    if isinstance(last_msg, AIMessage) and last_msg.tool_calls:
        for tc in last_msg.tool_calls:
            tool_call_ids.append(tc.get("id", ""))

    for idx, action in enumerate(state["actions"]):
        cmd_name = action["action"]
        cmd_args = action.get("args", {})
        # Each action corresponds to a tool call by index
        tc_id = tool_call_ids[idx] if idx < len(tool_call_ids) else ""

        validation = validate_action(
            action=cmd_name,
            args=cmd_args,
            user_role=state["user_role"],
        )

        if not validation["valid"]:
            results.append({
                "action": cmd_name,
                "status": ActionStatus.REJECTED,
                "error": validation["error"],
            })
            # Add tool message so OpenAI history stays valid on retry
            if tc_id:
                tool_messages.append(ToolMessage(
                    content=f"Rejected: {validation['error']}",
                    tool_call_id=tc_id,
                ))
            continue

        risk = validation["risk"]
        if risk in ("medium", "high"):
            results.append({
                "action": cmd_name,
                "args": validation["sanitized_args"],
                "status": ActionStatus.NEEDS_APPROVAL,
                "risk": risk,
                "description": validation["description"],
            })
            if tc_id:
                tool_messages.append(ToolMessage(
                    content=f"Needs approval (risk: {risk})",
                    tool_call_id=tc_id,
                ))
            continue

        cmd = COMMAND_CATALOG.get(cmd_name)
        if not cmd:
            results.append({
                "action": cmd_name,
                "status": ActionStatus.FAILED,
                "error": f"Unknown command: {cmd_name}",
            })
            if tc_id:
                tool_messages.append(ToolMessage(
                    content=f"Unknown command: {cmd_name}",
                    tool_call_id=tc_id,
                ))
            continue

        category = cmd["category"]
        tool = tool_registry.get(category)
        if tool:
            slot = len(results)
            results.append({
                "action": cmd_name,
                "status": ActionStatus.AUTO_EXECUTED,
                # Keep args so the frontend can still render the chart
                "args": validation["sanitized_args"],
            })
            try:
                result = tool.execute(cmd_name, validation["sanitized_args"])
            except Exception as e:
                results[slot] = {
                    "action": cmd_name,
                    "status": ActionStatus.FAILED,
                    "error": str(e),
                }
                continue

            # Every tool but one exposes `async def execute`; awaiting is what
            # actually runs them (previously the coroutine object itself was
            # handed to the LLM).
            if inspect.isawaitable(result):
                if category in PARALLEL_SAFE_CATEGORIES:
                    pending[slot] = result
                    continue
                try:
                    result = await result
                except Exception as e:
                    results[slot] = {
                        "action": cmd_name,
                        "status": ActionStatus.FAILED,
                        "error": str(e),
                    }
                    continue
            results[slot]["result"] = result
        else:
            # Frontend-handled commands (navigation, UI, DHIS2 analysis).
            results.append({
                "action": cmd_name,
                "args": validation["sanitized_args"],
                "status": ActionStatus.AUTO_EXECUTED,
                "description": validation["description"],
            })
            if tc_id:
                tool_messages.append(ToolMessage(
                    content=f"Delegated to frontend: {validation['description']}",
                    tool_call_id=tc_id,
                ))

    # Await the read-only calls together rather than one after the other.
    if pending:
        slots = list(pending)
        settled = await asyncio.gather(*(pending[s] for s in slots), return_exceptions=True)
        for slot, outcome in zip(slots, settled):
            if isinstance(outcome, BaseException):
                results[slot] = {
                    "action": results[slot]["action"],
                    "status": ActionStatus.FAILED,
                    "error": str(outcome),
                }
            else:
                results[slot]["result"] = outcome

    # ─── Add ToolMessages for successful tool calls ─────────
    # Every tool_call in the planner's AIMessage MUST have a matching
    # ToolMessage in the history, otherwise OpenAI rejects the request on
    # retry. Rejected / needs-approval / unknown / delegated calls already
    # got their ToolMessage above; this covers the successful sync and
    # async executions.
    for idx, r in enumerate(results):
        if r.get("status") == ActionStatus.AUTO_EXECUTED and r.get("result") is not None:
            tc_id = tool_call_ids[idx] if idx < len(tool_call_ids) else ""
            if tc_id:
                # Truncate large results to keep the conversation history lean
                result_summary = str(r["result"])[:500]
                tool_messages.append(ToolMessage(
                    content=f"Executed: {result_summary}",
                    tool_call_id=tc_id,
                ))

    # Collect ground-truth facts from DHIS2 tool results
    verified_facts = None
    all_verified_facts: list[dict] = []
    analysis_payload = None
    all_analysis_payloads: list[dict] = []
    for r in results:
        result = r.get("result")
        if isinstance(result, dict) and result.get("verified_facts"):
            facts = result["verified_facts"]
            all_verified_facts.append(facts)
            payload = result.get("analysis_payload")
            if isinstance(payload, dict):
                all_analysis_payloads.append(payload)
            # Keep the first one as the "primary" for backward compat
            # (fact_check, _build_analysis_context, conversation_memory)
            if verified_facts is None:
                verified_facts = facts
                analysis_payload = payload

    # ─── Enrich command args with backend-resolved metric/org unit ───
    # This prevents the frontend from doing an independent metric search
    # that could select a different indicator (Bug 2 — divergence).
    # IMPORTANT: each action gets its OWN resolved metric from its own
    # result, not the first one's — otherwise Penta 3's chart would show
    # Penta 1's data.
    for r in results:
        if r.get("action") == "run_dhis2_analysis" and r.get("status") == ActionStatus.AUTO_EXECUTED:
            if "args" not in r or r["args"] is None:
                r["args"] = {}
            result = r.get("result")
            if isinstance(result, dict) and result.get("verified_facts"):
                facts = result["verified_facts"]
                metric_info = facts.get("metric", {})
                scope_info = facts.get("query_scope", {})
                metric_id = metric_info.get("id")
                org_unit_id = scope_info.get("org_unit_id")
                if metric_id and not r["args"].get("metricId"):
                    r["args"]["metricId"] = metric_id
                if org_unit_id and not r["args"].get("orgUnitId"):
                    r["args"]["orgUnitId"] = org_unit_id

    analysis_plan = state.get("analysis_plan") or {}
    response_contract = state.get("response_contract") or {}
    if isinstance(analysis_payload, dict):
        for payload in all_analysis_payloads:
            payload["qid"] = analysis_plan.get("qid") or state.get("qid")
            payload["analysis_type"] = analysis_plan.get("analysis_type") or state.get("business_intent")
            payload["render_type"] = analysis_plan.get("render_type") or payload.get("render_type")
            payload["indicators"] = analysis_plan.get("indicators", [])
            payload["response_contract"] = response_contract or payload.get("response_contract")
        analysis_payload["related_analyses"] = all_analysis_payloads[1:]
        analysis_payload["qid"] = analysis_plan.get("qid") or state.get("qid")
        analysis_payload["analysis_type"] = analysis_plan.get("analysis_type") or state.get("business_intent")
        analysis_payload["render_type"] = analysis_plan.get("render_type") or analysis_payload.get("render_type")
        analysis_payload["indicators"] = analysis_plan.get("indicators", [])
        facts = analysis_payload.get("verified_facts") or verified_facts or {}
        available_outputs = {
            "situation": bool(facts.get("cells")),
            "gap": bool(facts.get("derived")),
            "ranking": bool(facts.get("top") or facts.get("cells")),
            "trend": bool(facts.get("trend")),
            "diagnosis": bool(analysis_payload.get("diagnostic")),
            "risk_scoring": bool(analysis_payload.get("risk_scores")),
            "comparative": bool(facts.get("cells")),
            "action": False,
        }
        analysis_payload["plan_steps"] = [
            {
                "step": step.get("step"),
                "description": step.get("description"),
                "tool": step.get("tool"),
                "render_hint": step.get("render_hint"),
                "status": "completed" if available_outputs.get(step.get("step"), False) else "unavailable",
            }
            for step in analysis_plan.get("steps", [])
        ]
        analysis_payload["response_contract"] = response_contract or analysis_payload.get("response_contract")
        # Surface assumptions (defaults applied when the user did not specify
        # period/geography) and deterministic follow-up suggestions.
        entities = state.get("entities") or {}
        assumptions = entities.get("_assumptions")
        if assumptions:
            analysis_payload["assumptions"] = assumptions
        # Defensive: suggest_followups must never crash the whole agent
        # (it's a UI convenience, not a critical path).
        try:
            analysis_payload["suggested_followups"] = suggest_followups(
                analysis_plan.get("qid") or state.get("qid"),
                entities,
                state.get("business_intent"),
            )
        except Exception:
            analysis_payload["suggested_followups"] = []

    # ─── Store analysis results in conversation memory ───
    if verified_facts:
        conv_mem_data = state.get("conversation_memory")
        if conv_mem_data:
            conv_mem = ConversationMemory.from_dict(conv_mem_data)
        else:
            conv_mem = ConversationMemory(
                conversation_id=state.get("conversation_id") or "default",
                user_id=state.get("user_id"),
            )
        conv_mem.store_analysis(verified_facts)
        conv_mem.save()

    return {
        "results": results,
        "verified_facts": verified_facts,
        "all_verified_facts": all_verified_facts,
        "analysis_payload": analysis_payload,
        "messages": tool_messages,
        "conversation_memory": conv_mem.to_dict() if verified_facts else state.get("conversation_memory"),
    }


def result_verification(state: AgentState) -> dict:
    """Check action results; increment iteration counter for retry logic."""
    iteration = state.get("iteration", 0) + 1

    errors = [
        r for r in state["results"]
        if r.get("status") in (ActionStatus.FAILED, ActionStatus.REJECTED)
    ]
    if errors:
        error_msgs = "; ".join(e.get("error", "Unknown error") for e in errors)
        return {"error": error_msgs, "iteration": iteration}
    return {"error": None, "iteration": iteration}


# Failures the planner cannot fix by rewriting its arguments. Replanning on
# these burns one or two extra LLM calls to arrive at the same failure
# (PERF-27).
_UNRECOVERABLE_ERROR_PATTERNS = re.compile(
    r"not configured|non configur|permission|not allowed|non autoris|forbidden"
    r"|unauthor|rate limit|timeout|timed out|unreachable|injoignable"
    r"|connection|indisponible|unavailable",
    re.IGNORECASE,
)


def _is_recoverable(error: str) -> bool:
    """True when rewriting the tool arguments could plausibly succeed."""
    return not _UNRECOVERABLE_ERROR_PATTERNS.search(error or "")


def _learn_from_clarification_answer(
    pending: dict, answer: dict, conversation_id: str | None
) -> None:
    """Persist a user-confirmed alias so the whole platform improves.

    Called right after apply_clarification_answer matched the user's reply.
    Only geography and metric slots produce learnable aliases; other slots
    (period, measurement_type, …) are not spelling variants of a fixed
    entity and are ignored. Never raises — learning is best-effort.
    """
    try:
        slot = answer.get("slot")
        original = (pending or {}).get("alias_original") or ""
        if not original:
            return
        if slot == "geography":
            entities = answer.get("entities") or {}
            target_id = entities.get("org_unit_id")
            target_name = entities.get("org_unit_name") or entities.get("geography")
            if not target_id:
                return
            record_alias_confirmation(
                alias_type="geo",
                alias_text=original,
                target_id=str(target_id),
                target_name=str(target_name),
                conversation_id=conversation_id,
            )
        elif slot == "metric":
            entities = answer.get("entities") or {}
            target_id = entities.get("metric_id")
            target_name = entities.get("metric_name")
            if not target_id:
                return
            record_alias_confirmation(
                alias_type="metric",
                alias_text=original,
                target_id=str(target_id),
                target_name=str(target_name),
                conversation_id=conversation_id,
            )
    except Exception:
        pass


def _reject_from_clarification_answer(pending: dict) -> None:
    """Record negative feedback when the user's reply didn't match any option.

    This decrements the confirmation count of any learned alias that
    triggered this clarification. If the count drops to 0, the alias is
    removed — preventing a wrong mapping from persisting platform-wide.
    Never raises.
    """
    try:
        from app.agents.alias_learning import record_alias_rejection as _reject
        alias_original = (pending or {}).get("alias_original") or ""
        slot = (pending or {}).get("slot")
        if not alias_original or slot not in ("geography", "metric"):
            return
        alias_type = "geo" if slot == "geography" else "metric"
        _reject(alias_type, alias_original)
    except Exception:
        pass


def route_after_verification(state: AgentState) -> str:
    """Retry the planner on a correctable failure (bounded), otherwise answer."""
    error = state.get("error")
    if (
        error
        and _is_recoverable(error)
        and state.get("iteration", 0) < MAX_ITERATIONS
    ):
        return "planner"
    return "response_generation"


def response_generation(state: AgentState) -> dict:
    """Generate the final natural language response grounded in action results."""
    # Planner already answered directly (no tools needed)
    if state.get("response") and not state.get("results"):
        return {"status": "done"}

    clarification_results = [
        result.get("result") for result in state.get("results", [])
        if isinstance(result.get("result"), dict)
        and result["result"].get("status") == "needs_clarification"
    ]
    if clarification_results:
        messages = [item.get("message") for item in clarification_results if item.get("message")]
        response = " ".join(dict.fromkeys(messages))
        return {
            "response": response,
            "clarification": response,
            "status": "awaiting_clarification",
            "messages": [AIMessage(content=response)],
        }

    results_summary = json.dumps(
        _summarize_results(state["results"]), ensure_ascii=False, default=str
    )

    # Inject verified ground-truth facts when available (DHIS2 analysis).
    # When multiple analyses ran (e.g. Penta 1 + Penta 3), inject a separate
    # VERIFIED DATA block for EACH one so the LLM grounds ALL figures, not
    # just the first indicator's. Without this, the LLM may say "data not
    # available" for the second indicator even though it was fetched.
    response_contract = state.get("response_contract") or {}
    assumptions = (state.get("entities") or {}).get("_assumptions") or {}
    assumptions_block = (
        "\nASSUMPTIONS APPLIED (the user did not specify these — defaults were used):\n"
        + "\n".join(f"- {key}: {value}" for key, value in assumptions.items())
        + "\nYou MUST explicitly mention these assumptions in your answer "
        "(e.g. 'Période non précisée : les 12 derniers mois ont été utilisés.').\n"
        if assumptions else ""
    )
    contract_block = (
        "\nMANDATORY RESPONSE CONTRACT:\n"
        f"{json.dumps(response_contract, ensure_ascii=False, indent=2, default=str)}\n"
        "Every required field must be present or explicitly marked as unavailable. "
        "Never infer a numerator, denominator, data-quality score, or causal conclusion.\n"
        if response_contract else ""
    )
    facts_block = ""
    all_facts = state.get("all_verified_facts") or []
    if not all_facts and state.get("verified_facts"):
        all_facts = [state["verified_facts"]]

    for idx, facts in enumerate(all_facts):
        scope = facts.get("query_scope", {})
        metric_name = scope.get("metric_name", facts.get("metric_name", "N/A"))
        scope_info = ""
        if scope:
            scope_info = (
                f"\nQUERY SCOPE #{idx + 1} (indicator: {metric_name}):\n"
                f"- Indicator: {metric_name}\n"
                f"- Geographic unit: {scope.get('org_unit_name', 'N/A')} "
                f"(ID: {scope.get('org_unit_id', 'N/A')})\n"
                f"- Periods: {scope.get('periods', [])}\n"
                f"- Breakdown level: {scope.get('target_level', 'none (single unit)')}\n"
                "\nCRITICAL: Only use values from the cells that match this scope.\n"
                "If the scope is a single org_unit (no breakdown), do NOT use\n"
                "values from other org_units or national totals.\n"
            )
        facts_block += (
            f"\n{'=' * 60}\n"
            f"{scope_info}\n"
            f"VERIFIED DATA #{idx + 1} — {metric_name} "
            f"(ground truth — use ONLY these exact figures):\n"
            f"{json.dumps(_facts_for_prompt(facts), ensure_ascii=False, default=str)}\n"
            "You MUST present these figures in a Markdown table in your response.\n"
            "The table should include columns for: indicator, period, geographic scope, value.\n"
            "Each value in the table MUST be the verified cell value for that exact\n"
            "period and org_unit — do NOT mix values from different periods or areas,\n"
            "and do NOT mix values from different indicators.\n"
            "IMPORTANT: Each cell has a 'period_label' field (e.g. 'Avril 2026').\n"
            "Use the period_label value EXACTLY as provided — do NOT convert period\n"
            "codes yourself, as manual conversion often produces off-by-one errors.\n"
        )

    if facts_block:
        facts_block += (
            "\nIMPORTANT: There are MULTIPLE VERIFIED DATA blocks above (one per "
            "indicator). You MUST include data from EVERY block in your response. "
            "Do NOT omit any indicator. Do NOT say data is unavailable for an "
            "indicator if its VERIFIED DATA block is present above.\n"
            "After the table(s), provide a structured analytical summary (3-5 sentences):\n"
            "  - Total and key figures with thousands separators\n"
            "  - Trend direction if multiple periods are available\n"
            "  - Top and bottom geographic units if breakdown is available\n"
            "  - Notable patterns or anomalies\n"
            "  - Brief contextual interpretation for public health decision-making\n"
            "  - Include a provenance line: source, period, geography and indicator ID\n"
            "If VERIFIED DATA contains a derived threshold_proportion, begin with its exact "
            "value, numerator, denominator, operator and threshold. Do not recompute it.\n"
            "Report data-quality fields and limitations exactly as provided.\n"
        )

    # ─── Health domain context (from doc_sante) ───
    # Inject relevant DRC vaccination terminology, formulas, thresholds, and
    # campaign context so the response is grounded in operational reality.
    health_context = (state.get("entities") or {}).get("_health_context") or {}
    health_block = ""
    if health_context:
        health_parts: list[str] = []
        if health_context.get("terminology"):
            terms = health_context["terminology"]
            term_lines = [f"- {t['short_name']}: {t['full_name']} — {t.get('description', '')}" for t in terms]
            health_parts.append("DOMAIN TERMINOLOGY (use full names in your response):\n" + "\n".join(term_lines))
        if health_context.get("campaign_type"):
            ct = health_context["campaign_type"]
            health_parts.append(
                f"CAMPAIGN CONTEXT: {ct['name']} — cible: {ct['target_age']}, "
                f"vaccin: {ct['vaccine']}, stratégie: {ct['strategy']}, durée: {ct['duration']}"
            )
        if health_context.get("formulas"):
            for f in health_context["formulas"]:
                health_parts.append(f"FORMULA — {f['name']}: {f['formula']}")
        if health_context.get("lqas_80"):
            health_parts.append(f"LQAS 80%: {health_context['lqas_80']['pass_condition']}")
        if health_context.get("lqas_90"):
            health_parts.append(f"LQAS 90%: {health_context['lqas_90']['pass_condition']}")
        if health_context.get("revaccination"):
            health_parts.append(f"REVACCINATION: {health_context['revaccination']['threshold']}")
        if health_context.get("ecm_criteria"):
            health_parts.append(f"ECM CRITÈRES: {health_context['ecm_criteria']['description']}")
        if health_context.get("zero_dose"):
            health_parts.append(f"ZÉRO DOSE: {health_context['zero_dose']['description']}")
        if health_parts:
            health_block = "\nHEALTH DOMAIN CONTEXT (from DRC vaccination documents):\n" + "\n".join(health_parts) + "\n"

    system = SystemMessage(
        content=(
            "You are SIVAX, an AI Decision Assistant for a healthcare analytics platform "
            "(DHIS2, RDC). Based on the actions executed, generate a detailed natural "
            "language response for the user.\n"
            "Rules:\n"
            "- If a DHIS2 analysis was triggered, you MUST present the actual data figures "
            "in your response using a Markdown table. Include: indicator name, period, "
            "geographic scope, and the exact values from the VERIFIED DATA. After the table, "
            "provide a structured analytical summary (3-5 sentences) covering:\n"
            "  1. Total and key figures\n"
            "  2. Trend direction (increase/decrease/stable) if multiple periods\n"
            "  3. Top and bottom geographic units if breakdown is available\n"
            "  4. Notable patterns or anomalies\n"
            "  5. A brief contextual interpretation (what this means for public health)\n"
            "- IMPORTANT: The platform AUTOMATICALLY renders charts (bar, line, pie, KPI) "
            "in a dedicated visualization area. You do NOT need to and MUST NOT:\n"
            "  * Suggest using external tools like Excel or Google Sheets\n"
            "  * Draw ASCII art graphs or text-based charts\n"
            "  * Describe how the chart looks visually\n"
            "  The chart is already displayed separately from your text. "
            "Your text must contain ONLY the data table and analytical interpretation.\n"
            "- NEVER say 'I cannot generate charts' or 'I cannot create graphs'.\n"
            "- NEVER include ASCII art, text-based visualizations, or character-drawn graphs.\n"
            "- NEVER add closing pleasantries like 'Si vous avez besoin d'autres informations' "
            "or 'N'hésitez pas à demander' or 'Let me know if you need anything else'. "
            "End your response after the analytical interpretation.\n"
            "- If actions need approval, tell the user they need to confirm.\n"
            "- If actions failed, explain clearly what went wrong and suggest a fix.\n"
            "- NEVER invent figures — only reference data actually present in the results "
            "or VERIFIED DATA block.\n"
            "- Format numbers with thousands separators (e.g. 82 478 not 82478).\n"
            "- ALWAYS write periods in human-readable French, NEVER as raw "
            "YYYYMM codes. Use 'Mars 2025' instead of '202503', 'juillet 2025' "
            "instead of '202507'. In tables, the period column must show "
            "'Mars 2025', not '202503'.\n"
            "- Respond in the user's language (French by default).\n"
            "- Maintain continuity with the conversation history: reference previous "
            "questions or results when relevant, and use context to disambiguate "
            "pronouns or implicit references.\n"
            "- For diagnostic statements, use association language and never claim causality.\n"
            "- State unavailable numerator, denominator, completeness, or promptitude explicitly; "
            "never estimate them.\n"
            "- When the HEALTH DOMAIN CONTEXT is provided, use it to enrich your "
            "analytical interpretation with relevant operational context (campaign "
            "type, vaccine characteristics, thresholds, formulas). This makes the "
            "response more useful for public health decision-makers.\n"
            f"{assumptions_block}"
            f"{contract_block}\n"
            f"{facts_block}\n"
            f"{health_block}\n\n"
            f"Action results:\n{results_summary}"
        )
    )

    messages = [system] + _recent_history(state["messages"])
    response = _llm(temperature=0.3).invoke(messages)

    # Inject the LLM interpretation into the analysis_payload so the frontend
    # can render the interpretation div directly from the payload — no second
    # DHIS2 analysis call needed.
    analysis_payload = state.get("analysis_payload")
    if isinstance(analysis_payload, dict):
        analysis_payload["interpretation"] = response.content

    return {
        "response": response.content,
        "status": "done",
        "messages": [response],
        # Propagate analysis_payload for the frontend container
        "analysis_payload": analysis_payload,
    }


def _parse_markdown_table(text: str) -> list[dict]:
    """
    Parse Markdown tables from the response to extract (period, value) pairs.
    Returns a list of {"period": str, "value": float, "raw_text": str}.
    """
    rows: list[dict] = []
    lines = text.split("\n")
    # Find table rows (lines starting with |)
    table_lines = [l.strip() for l in lines if l.strip().startswith("|")]
    if len(table_lines) < 2:
        return rows

    # Parse header to find column indices
    header = [h.strip().lower() for h in table_lines[0].split("|") if h.strip()]
    period_idx = None
    value_idx = None
    for i, h in enumerate(header):
        if any(k in h for k in ["period", "période", "mois", "periode"]):
            period_idx = i
        if any(k in h for k in ["valeur", "value", "nombre", "cas", "total", "taux", "couverture"]):
            value_idx = i

    # If no explicit value column, assume last column is value
    if value_idx is None:
        value_idx = len(header) - 1
    if period_idx is None:
        period_idx = 0

    for line in table_lines[1:]:
        # Skip separator rows (|---|---|)
        if re.match(r"^\|[\s\-:|]+\|$", line):
            continue
        cells = [c.strip() for c in line.split("|") if c.strip()]
        if len(cells) <= max(period_idx, value_idx):
            continue
        period_raw = cells[period_idx]
        value_raw = cells[value_idx]
        # Extract period code (YYYYMM) from text like "Mars 2025 (202503)"
        period_match = re.search(r"(\d{6})", period_raw)
        period_code = period_match.group(1) if period_match else period_raw
        # Extract number from value cell
        numbers = _extract_numbers(value_raw)
        if numbers:
            rows.append({
                "period": period_code,
                "period_raw": period_raw,
                "value": numbers[0],
                "raw_text": line,
            })
    return rows


def _period_matches(response_period: str, verified_period: str) -> bool:
    """Check if a response period matches a verified period (fuzzy)."""
    if response_period == verified_period:
        return True
    # If response period is a month name (e.g. "Mars 2025") and verified is YYYYMM
    if len(verified_period) == 6 and verified_period.isdigit():
        year = verified_period[:4]
        month = int(verified_period[4:6])
        month_names = ["janvier", "février", "mars", "avril", "mai", "juin",
                       "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
        month_name = month_names[month - 1] if 1 <= month <= 12 else ""
        if month_name and month_name in response_period.lower() and year in response_period:
            return True
    return False


def fact_check(state: AgentState) -> dict:
    """
    Verify that every figure in the generated response matches the verified
    ground-truth data returned by the DHIS2 tool.

    v2: Cell-based verification — checks that each (period, value) pair in the
    response matches the correct verified cell, not just that the number exists
    somewhere in the dataset. Also verifies scope (org_unit) attribution.

    v3: Multi-indicator support — when multiple analyses ran (e.g. Penta 1 +
    Penta 3), verify against ALL verified facts, not just the first one.
    Without this, the second indicator's values would be flagged as
    hallucinated and stripped from the regenerated response.
    """
    all_facts = state.get("all_verified_facts") or []
    if not all_facts and state.get("verified_facts"):
        all_facts = [state["verified_facts"]]
    facts = all_facts[0] if all_facts else None
    response_text = state.get("response") or ""
    retries = state.get("fact_retries", 0)

    # Nothing to verify against, or already retried — pass through
    if not facts or not response_text or retries >= MAX_FACT_RETRIES:
        return {"fact_retries": retries}

    # Collect verified values from ALL analyses (multiple indicators)
    verified_values: set[float] = set()
    for f in all_facts:
        for v in f.get("values", []):
            verified_values.add(round(v, 2))

    if not verified_values:
        return {"fact_retries": retries}

    # ─── 2. Cell-based verification ────────────────────────
    # Parse the response's Markdown table and check each (period, value)
    # pair against the verified cells from every analysis.
    cell_mismatches: list[str] = []
    parsed_rows = _parse_markdown_table(response_text)
    if parsed_rows:
        for row in parsed_rows:
            row_period = row["period"]
            row_value = row["value"]
            matched = False
            for f in all_facts:
                cells = f.get("cells") or []
                for cell in cells:
                    cell_period = str(cell.get("period", ""))
                    cell_value = cell.get("value")
                    if cell_value is None:
                        continue
                    if _period_matches(row_period, cell_period):
                        if abs(row_value - float(cell_value)) <= max(abs(float(cell_value)) * 0.02, 0.5):
                            matched = True
                            break
                if matched:
                    break
            if not matched:
                cell_mismatches.append(
                    f"Période {row_period} : la valeur {row_value} "
                    f"ne correspond à aucune cellule vérifiée"
                )

    claimed = _extract_numbers(_strip_structural_tokens(response_text))
    # Filter out small integers that are structural (years, counts in prose)
    significant = [n for n in claimed if abs(n) >= 10]
    hallucinated = [
        n for n in significant
        if not any(
            abs(n - v) <= max(abs(v) * 0.02, 0.5)  # 2% tolerance, min 0.5
            for v in verified_values
        )
    ]

    # ─── 3. Decide if regeneration is needed ───────────────
    all_errors = (
        [f"Figures not in verified data: {hallucinated}"] if hallucinated else []
    )

    if not all_errors:
        return {"fact_retries": retries}

    # ─── 4. Regenerate with clean context ──────────────────
    # CRITICAL: Do NOT pass the full message history — it contains the
    # hallucinated response. Use only the original user message + correction.
    error_detail = "; ".join(all_errors[:5])  # limit to 5 errors
    correction = (
        f"Your previous response contained factual errors:\n{error_detail}\n\n"
        "Regenerate the response using ONLY the verified figures below. "
        "Each figure must be attributed to the correct period and geographic scope. "
        "Do NOT mix values from different periods or different geographic areas."
    )
    # Inject ALL verified data blocks (one per indicator) so the regenerated
    # response includes every indicator, not just the first one.
    all_facts_json = "\n---\n".join(
        f"VERIFIED DATA #{i + 1} — {f.get('query_scope', {}).get('metric_name', f.get('metric_name', 'N/A'))}:\n"
        f"{json.dumps(_facts_for_prompt(f), ensure_ascii=False, default=str)}"
        for i, f in enumerate(all_facts)
    )
    system = SystemMessage(
        content=(
            "You are SIVAX, an AI Decision Assistant. Regenerate your previous answer.\n"
            f"Correction: {correction}\n"
            f"{all_facts_json}\n"
            "Rules:\n"
            "- Each value in your table MUST match the verified cell for that exact period.\n"
            "- Do NOT use a national total when the question was about a specific province.\n"
            "- Do NOT use a value from a different period.\n"
            "- Include data from EVERY VERIFIED DATA block above. Do NOT omit any indicator.\n"
            "- Format numbers with thousands separators.\n"
            "- ALWAYS write periods in human-readable French (e.g. 'Mars 2025' "
            "not '202503'), especially in table columns.\n"
            "Respond in the user's language (French by default)."
        )
    )
    messages = [system] + _recent_history(state["messages"])
    response = _llm(temperature=0).invoke(messages)

    # Keep the analysis_payload interpretation in sync with the regenerated response
    analysis_payload = state.get("analysis_payload")
    if isinstance(analysis_payload, dict):
        analysis_payload["interpretation"] = response.content

    return {
        "response": response.content,
        "fact_retries": retries + 1,
        "messages": [response],
        "analysis_payload": analysis_payload,
    }


# ─── Graph ─────────────────────────────────────────────────

def build_agent_graph():
    """Build and compile the LangGraph agent."""
    workflow = StateGraph(AgentState)

    workflow.add_node("context_analysis", context_analysis)
    workflow.add_node("clarification", clarification)
    workflow.add_node("fast_navigation", fast_navigation)
    workflow.add_node("chat_responder", chat_responder)
    workflow.add_node("planner", planner)
    workflow.add_node("tool_execution", tool_execution)
    workflow.add_node("result_verification", result_verification)
    workflow.add_node("response_generation", response_generation)
    workflow.add_node("fact_check", fact_check)

    workflow.set_entry_point("context_analysis")

    # Conditional routing after context analysis
    workflow.add_conditional_edges(
        "context_analysis",
        route_after_analysis,
        {
            "clarification": "clarification",
            "fast_navigation": "fast_navigation",
            "chat_responder": "chat_responder",
            "planner": "planner",
        },
    )

    workflow.add_edge("clarification", END)
    workflow.add_edge("fast_navigation", END)

    # chat_responder → fact_check IF verified_facts are available from a
    # previous turn (e.g. user challenges a figure but intent was classified
    # CHAT). Otherwise → END directly.
    def route_after_chat(state: AgentState) -> str:
        if state.get("verified_facts") and state.get("response"):
            return "fact_check"
        return END

    workflow.add_conditional_edges(
        "chat_responder",
        route_after_chat,
        {END: END, "fact_check": "fact_check"},
    )

    # Planner may answer directly (no tools) or proceed to execution
    workflow.add_conditional_edges(
        "planner",
        route_after_planner,
        {
            END: END,
            "tool_execution": "tool_execution",
        },
    )

    workflow.add_edge("tool_execution", "result_verification")

    # Retry loop on failure, bounded by MAX_ITERATIONS
    workflow.add_conditional_edges(
        "result_verification",
        route_after_verification,
        {
            "planner": "planner",
            "response_generation": "response_generation",
        },
    )

    # Response passes through fact checking before END
    workflow.add_edge("response_generation", "fact_check")
    workflow.add_edge("fact_check", END)

    return workflow.compile()


# Singleton instance
agent_graph = build_agent_graph()
