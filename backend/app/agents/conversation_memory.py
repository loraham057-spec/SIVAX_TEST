"""
Conversation memory — persistent, multi-turn context for the AI agent.

This module implements a conversation memory system similar to Windsurf/Devin's
own context mechanism. It stores and retrieves structured memories per
conversation:

    - analysis:    results from DHIS2/Supabase analyses (indicator, geography, periods, values)
    - entity:      mentioned entities (indicators, provinces, health zones)
    - preference:  user preferences (language, default period, visualization type)
    - topic:       topics discussed in the conversation
    - clarification: questions asked and answers received

The memory is:
    1. Persisted in Supabase (table: agent_conversation_memory) for cross-session recall
    2. Cached in-memory per conversation for fast access within a session
    3. Retrieved intelligently — the most relevant memories are injected into the prompt

Integration flow:
    1. Router loads memory at the start of each request (by conversation_id)
    2. context_analysis node receives memory and uses it for anaphora resolution
    3. planner node receives a "conversation memory" block in its system prompt
    4. After a successful analysis, results are stored back into memory
    5. Frontend sends conversation_id so the backend can load the right memory
"""

from __future__ import annotations

import json
import time
from typing import Any, Optional

from app.core.config import settings

try:
    from supabase import create_client as _sb_create
    _SUPABASE = None

    def _get_sb():
        global _SUPABASE
        if _SUPABASE is None:
            url = settings.supabase_url
            key = settings.supabase_service_key
            if url and key:
                _SUPABASE = _sb_create(url, key)
        return _SUPABASE
except Exception:
    _SUPABASE = None

    def _get_sb():
        return None


# ─── In-memory fallback (when Supabase table is not available) ───
_in_memory: dict[str, list[dict[str, Any]]] = {}


class ConversationMemory:
    """
    Manages conversation memory for a single conversation.

    Usage:
        memory = ConversationMemory(conversation_id)
        memory.load()                          # Load from Supabase
        ctx = memory.get_relevant_context(msg) # Get relevant context for a message
        memory.store_analysis(facts)           # Store analysis results
        memory.save()                          # Persist to Supabase
    """

    def __init__(self, conversation_id: str | None = None, user_id: str | None = None):
        self.conversation_id = conversation_id or "default"
        self.user_id = user_id
        self._memories: list[dict[str, Any]] = []
        self._loaded = False

    # ─── Load / Save ──────────────────────────────────────

    def load(self) -> None:
        """Load all memories for this conversation from Supabase (or in-memory fallback)."""
        if self._loaded:
            return
        sb = _get_sb()
        if sb:
            try:
                result = sb.table("agent_conversation_memory") \
                    .select("*") \
                    .eq("conversation_id", self.conversation_id) \
                    .order("created_at", desc=False) \
                    .execute()
                self._memories = result.data or []
            except Exception:
                # Table might not exist yet — use in-memory fallback
                self._memories = _in_memory.get(self.conversation_id, [])
        else:
            self._memories = _in_memory.get(self.conversation_id, [])
        self._loaded = True

    def save(self) -> None:
        """Persist all pending memories to Supabase."""
        sb = _get_sb()
        if not sb:
            _in_memory[self.conversation_id] = self._memories
            return
        try:
            for m in self._memories:
                if m.get("_pending"):
                    m.pop("_pending")
                    # Upsert: check if exists
                    existing = sb.table("agent_conversation_memory") \
                        .select("id") \
                        .eq("conversation_id", self.conversation_id) \
                        .eq("memory_type", m["memory_type"]) \
                        .eq("key", m["key"]) \
                        .maybe_single() \
                        .execute()
                    if existing.data:
                        sb.table("agent_conversation_memory") \
                            .update({
                                "value": m["value"],
                                "salience": m.get("salience", 0.5),
                                "updated_at": "now()",
                            }) \
                            .eq("id", existing.data["id"]) \
                            .execute()
                    else:
                        sb.table("agent_conversation_memory") \
                            .insert({
                                "conversation_id": self.conversation_id,
                                "user_id": self.user_id,
                                "memory_type": m["memory_type"],
                                "key": m["key"],
                                "value": m["value"],
                                "salience": m.get("salience", 0.5),
                            }) \
                            .execute()
        except Exception:
            # Fallback to in-memory
            _in_memory[self.conversation_id] = self._memories

    # ─── Store methods ────────────────────────────────────

    def store_analysis(self, verified_facts: dict) -> None:
        """Store the results of a DHIS2/Supabase analysis."""
        metric = verified_facts.get("metric", {})
        scope = verified_facts.get("query_scope", {})
        contract = verified_facts.get("response_contract") or {}
        value = {
            "version": "2.0",
            "metric_id": metric.get("id", ""),
            "metric_name": metric.get("name", ""),
            "org_unit_id": scope.get("org_unit_id", ""),
            "org_unit_name": scope.get("org_unit_name", ""),
            "periods": scope.get("periods", []),
            "target_org_unit_level": scope.get("target_level"),
            "antigens": scope.get("antigens", []),
            "qid": contract.get("qid"),
            "business_intent": contract.get("analysis_intent"),
            "measurement_type": contract.get("measurement_type"),
            "total": verified_facts.get("total"),
            "trend": verified_facts.get("trend"),
            "derived": verified_facts.get("derived"),
            "data_quality": verified_facts.get("data_quality"),
            "cells": verified_facts.get("cells", [])[:20],  # cap for storage
            "timestamp": time.time(),
        }
        self._upsert("analysis", "last_analysis", value, salience=0.9)
        # Also store as a named analysis (by metric+geo)
        analysis_key = f"analysis_{value['metric_id']}_{value['org_unit_id']}"
        self._upsert("analysis", analysis_key, value, salience=0.7)
        # Store mentioned entities
        if value["metric_name"]:
            self._upsert("entity", f"indicator_{value['metric_id']}", {
                "id": value["metric_id"],
                "name": value["metric_name"],
                "type": "indicator",
            }, salience=0.8)
        if value["org_unit_name"] and value["org_unit_id"]:
            self._upsert("entity", f"org_unit_{value['org_unit_id']}", {
                "id": value["org_unit_id"],
                "name": value["org_unit_name"],
                "type": "org_unit",
            }, salience=0.8)

    def store_entity(self, entity_type: str, entity_id: str, name: str, **extra) -> None:
        """Store a mentioned entity (indicator, province, zone, etc.)."""
        value = {"id": entity_id, "name": name, "type": entity_type, **extra}
        self._upsert("entity", f"{entity_type}_{entity_id}", value, salience=0.6)

    def store_preference(self, key: str, value: Any) -> None:
        """Store a user preference (language, default visualization, etc.)."""
        self._upsert("preference", key, {"value": value}, salience=0.5)

    def store_topic(self, topic: str, details: dict | None = None) -> None:
        """Store a topic discussed in the conversation."""
        self._upsert("topic", topic, details or {"topic": topic}, salience=0.4)

    def store_clarification(self, question: str, answer: str) -> None:
        """Store a clarification exchange."""
        self._upsert("clarification", question, {
            "question": question,
            "answer": answer,
            "timestamp": time.time(),
        }, salience=0.3)

    # ─── Pending clarification (structured, one at a time) ─

    def set_pending_clarification(self, request: dict) -> None:
        """Persist the structured clarification the agent just asked, so the
        next turn can interpret the user's reply as an answer to it."""
        self._upsert("clarification", "pending", {
            **request,
            "asked_at": time.time(),
        }, salience=0.9)

    def get_pending_clarification(self) -> dict | None:
        """Get the pending clarification request, if any."""
        for m in reversed(self._memories):
            if m["memory_type"] == "clarification" and m["key"] == "pending":
                value = m["value"] or {}
                return value if value.get("slot") else None
        return None

    def clear_pending_clarification(self) -> None:
        """Mark the pending clarification as resolved/abandoned."""
        self._upsert("clarification", "pending", {}, salience=0.1)

    def _upsert(self, memory_type: str, key: str, value: dict, salience: float = 0.5) -> None:
        """Add or update a memory in the local cache."""
        # Check if memory already exists
        for m in self._memories:
            if m["memory_type"] == memory_type and m["key"] == key:
                m["value"] = value
                m["salience"] = salience
                m["_pending"] = True
                return
        self._memories.append({
            "conversation_id": self.conversation_id,
            "memory_type": memory_type,
            "key": key,
            "value": value,
            "salience": salience,
            "_pending": True,
        })

    # ─── Retrieve methods ─────────────────────────────────

    def get_last_analysis(self) -> dict | None:
        """Get the most recent analysis context."""
        for m in reversed(self._memories):
            if m["memory_type"] == "analysis" and m["key"] == "last_analysis":
                return m["value"]
        return None

    def get_entities(self, entity_type: str | None = None) -> list[dict]:
        """Get all mentioned entities, optionally filtered by type."""
        results = []
        for m in self._memories:
            if m["memory_type"] == "entity":
                if entity_type is None or m["value"].get("type") == entity_type:
                    results.append(m["value"])
        return results

    def get_preferences(self) -> dict[str, Any]:
        """Get all user preferences."""
        results = {}
        for m in self._memories:
            if m["memory_type"] == "preference":
                results[m["key"]] = m["value"].get("value")
        return results

    def get_all_analyses(self) -> list[dict]:
        """Get all stored analyses (not just the last one)."""
        results = []
        for m in self._memories:
            if m["memory_type"] == "analysis" and m["key"] != "last_analysis":
                results.append(m["value"])
        return results

    def get_relevant_context(self, current_message: str) -> str:
        """
        Build a conversation memory summary for the agent prompt.

        This is the key method — it produces a human-readable summary of
        everything the agent should know from the conversation history,
        prioritized by salience and relevance to the current message.
        """
        if not self._memories:
            return ""

        sections: list[str] = []

        # ─── Last analysis (highest priority) ─────
        last = self.get_last_analysis()
        if last and last.get("metric_name"):
            sections.append(
                f"LAST ANALYSIS:\n"
                f"  Indicator: {last['metric_name']} (ID: {last.get('metric_id', 'N/A')})\n"
                f"  Geography: {last.get('org_unit_name', 'N/A')} "
                f"(ID: {last.get('org_unit_id', 'N/A')})\n"
                f"  Periods: {last.get('periods', [])}\n"
                f"  Total: {last.get('total', 'N/A')}\n"
                f"  Trend: {last.get('trend', 'N/A')}"
            )

        # ─── All mentioned indicators ─────────────
        indicators = self.get_entities("indicator")
        if len(indicators) > 1:
            ind_list = "; ".join(f"{i['name']} ({i['id']})" for i in indicators)
            sections.append(f"MENTIONED INDICATORS: {ind_list}")

        # ─── All mentioned geographic areas ───────
        org_units = self.get_entities("org_unit")
        if len(org_units) > 1:
            ou_list = "; ".join(f"{o['name']} ({o['id']})" for o in org_units)
            sections.append(f"MENTIONED AREAS: {ou_list}")

        # ─── Previous analyses (not just last) ─────
        all_analyses = self.get_all_analyses()
        if all_analyses:
            prev_parts = []
            for a in all_analyses[-3:]:  # last 3 analyses
                prev_parts.append(
                    f"  - {a.get('metric_name', '?')} / "
                    f"{a.get('org_unit_name', '?')} / "
                    f"{a.get('periods', [])}"
                )
            sections.append("PREVIOUS ANALYSES:\n" + "\n".join(prev_parts))

        # ─── User preferences ─────────────────────
        prefs = self.get_preferences()
        if prefs:
            pref_parts = [f"{k}: {v}" for k, v in prefs.items()]
            sections.append(f"PREFERENCES: {', '.join(pref_parts)}")

        if not sections:
            return ""

        return (
            "CONVERSATION MEMORY (from previous turns in this conversation):\n"
            "Use this context to resolve references like 'ce nombre', 'cette province', "
            "'et pour...', 'compare avec...'. When the user references a previous result, "
            "use the SAME indicator and geography from the LAST ANALYSIS.\n\n"
            + "\n\n".join(sections)
        )

    def to_dict(self) -> dict:
        """Serialize for inclusion in agent state."""
        return {
            "conversation_id": self.conversation_id,
            "memories": [
                {k: v for k, v in m.items() if k != "_pending"}
                for m in self._memories
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ConversationMemory":
        """Deserialize from agent state."""
        mem = cls(conversation_id=data.get("conversation_id", "default"))
        mem._memories = data.get("memories", [])
        mem._loaded = True
        return mem
