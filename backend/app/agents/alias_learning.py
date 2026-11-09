"""
Learned aliases — shared, self-improving spelling knowledge for the agent.

When a user's spelling of a geography ("Lwalaba") or indicator name
("pentavallent") doesn't match any known entity, the agent asks a structured
clarification. Once the user confirms the intended target, the mapping
(alias → DHIS2 entity) is persisted in Supabase (table: agent_learned_aliases)
and shared across ALL users and conversations: the next time anyone writes the
same (mis)spelling, the agent resolves it directly instead of asking again.

Safeguards against pollution:
    - Aliases are learned ONLY from explicit user confirmations (a clarification
      answer), never from silent fuzzy guesses.
    - Learned aliases never override curated exact names (PROVINCE_MAP, exact
      org unit / indicator names) — those are checked first by the resolvers.
    - Aliases shorter than 3 characters are never stored.
    - A short-lived in-process cache avoids one Supabase round-trip per request.
"""

from __future__ import annotations

import re
import time
import unicodedata
from typing import Any

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


TABLE = "agent_learned_aliases"
CACHE_TTL = 600  # seconds
# Confidence tiers for learned aliases:
#   1 confirmation  → proposed as pre-selected option (still asks)
#   ≥2 confirmations → auto-applied silently (trusted)
AUTO_APPLY_MIN_CONFIRMATIONS = 2
PROPOSE_MIN_CONFIRMATIONS = 1
# Aliases not confirmed in this many days have their counter decayed.
DECAY_DAYS = 90

# ─── In-memory fallback (when Supabase is unavailable) ─────
_in_memory_store: dict[tuple[str, str], dict[str, Any]] = {}

# alias_type -> (loaded_at, {alias_normalized: row})
_cache: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}


def normalize_alias(text: str) -> str:
    """Lowercase, strip accents, keep alphanumerics, collapse whitespace."""
    nf = unicodedata.normalize("NFD", text or "")
    no_accents = "".join(c for c in nf if unicodedata.category(c) != "Mn")
    return " ".join(re.sub(r"[^a-z0-9\s]", " ", no_accents.lower()).split())


def _load_aliases(alias_type: str) -> dict[str, dict[str, Any]]:
    """Load all aliases of a type, with a TTL cache."""
    cached = _cache.get(alias_type)
    if cached and time.time() - cached[0] < CACHE_TTL:
        return cached[1]
    rows: dict[str, dict[str, Any]] = {
        key[1]: dict(value) for key, value in _in_memory_store.items() if key[0] == alias_type
    }
    sb = _get_sb()
    if sb:
        try:
            result = sb.table(TABLE).select("*").eq("alias_type", alias_type).execute()
            rows = {r["alias_normalized"]: r for r in (result.data or [])}
        except Exception:
            pass  # table missing or Supabase down — keep in-memory fallback
    _cache[alias_type] = (time.time(), rows)
    return rows


def invalidate_cache(alias_type: str | None = None) -> None:
    if alias_type:
        _cache.pop(alias_type, None)
    else:
        _cache.clear()


def get_learned_alias(alias_type: str, text: str) -> dict[str, Any] | None:
    """Return a TRUSTED learned alias (≥2 confirmations) for auto-application.

    Returns {"target_id", "target_name", "target_level", "confirmations"} or None.
    Aliases with only 1 confirmation are NOT returned here — they are
    proposed as pre-selected options via get_proposed_alias() instead.
    """
    norm = normalize_alias(text)
    if len(norm) < 3:
        return None
    row = _load_aliases(alias_type).get(norm)
    if row and row.get("confirmations", 0) >= AUTO_APPLY_MIN_CONFIRMATIONS:
        return row
    return None


def get_proposed_alias(alias_type: str, text: str) -> dict[str, Any] | None:
    """Return a learned alias with only 1 confirmation (propose, don't auto-apply).

    Used to pre-select an option in a clarification question when a previous
    user confirmed this spelling, but it hasn't been confirmed enough times
    to be trusted platform-wide.
    """
    norm = normalize_alias(text)
    if len(norm) < 3:
        return None
    row = _load_aliases(alias_type).get(norm)
    if row and PROPOSE_MIN_CONFIRMATIONS <= row.get("confirmations", 0) < AUTO_APPLY_MIN_CONFIRMATIONS:
        return row
    return None


def record_alias_confirmation(
    alias_type: str,
    alias_text: str,
    target_id: str,
    target_name: str,
    target_level: int | None = None,
    conversation_id: str | None = None,
) -> None:
    """Persist a user-confirmed alias mapping (upsert, confirmations += 1).

    Called ONLY when the user explicitly picked the target in a clarification
    answer. Never raises — learning is best-effort.
    """
    norm = normalize_alias(alias_text)
    if len(norm) < 3 or not target_id:
        return
    # Nothing to learn when the alias already equals the target name
    if norm == normalize_alias(target_name):
        return

    sb = _get_sb()
    if sb:
        try:
            existing = (
                sb.table(TABLE)
                .select("id,confirmations")
                .eq("alias_type", alias_type)
                .eq("alias_normalized", norm)
                .maybe_single()
                .execute()
            )
            if existing and existing.data:
                sb.table(TABLE).update({
                    "target_id": target_id,
                    "target_name": target_name,
                    "target_level": target_level,
                    "confirmations": existing.data.get("confirmations", 0) + 1,
                    "last_confirmed_at": "now()",
                }).eq("id", existing.data["id"]).execute()
            else:
                sb.table(TABLE).insert({
                    "alias_type": alias_type,
                    "alias_normalized": norm,
                    "target_id": target_id,
                    "target_name": target_name,
                    "target_level": target_level,
                    "created_by_conversation": conversation_id,
                }).execute()
            invalidate_cache(alias_type)
            return
        except Exception:
            pass  # fall through to in-memory

    key = (alias_type, norm)
    row = _in_memory_store.get(key)
    if row:
        row.update({
            "target_id": target_id,
            "target_name": target_name,
            "target_level": target_level,
            "confirmations": row.get("confirmations", 0) + 1,
        })
    else:
        _in_memory_store[key] = {
            "alias_type": alias_type,
            "alias_normalized": norm,
            "target_id": target_id,
            "target_name": target_name,
            "target_level": target_level,
            "confirmations": 1,
        }
    invalidate_cache(alias_type)


def record_alias_rejection(
    alias_type: str,
    alias_text: str,
    target_id: str | None = None,
) -> None:
    """Decrement confirmations for an alias (negative feedback).

    Called when a user's reply to a clarification doesn't match ANY proposed
    option — a signal that the alias mapping (or the clarification itself)
    was wrong. If confirmations drop to 0, the alias is removed entirely.
    Never raises.
    """
    norm = normalize_alias(alias_text)
    if len(norm) < 3:
        return

    sb = _get_sb()
    if sb:
        try:
            existing = (
                sb.table(TABLE)
                .select("id,confirmations,target_id")
                .eq("alias_type", alias_type)
                .eq("alias_normalized", norm)
                .maybe_single()
                .execute()
            )
            if not existing or not existing.data:
                return
            current = existing.data.get("confirmations", 0)
            if target_id and existing.data.get("target_id") != target_id:
                return  # rejection targets a different mapping — ignore
            new_count = current - 1
            if new_count <= 0:
                sb.table(TABLE).delete().eq("id", existing.data["id"]).execute()
            else:
                sb.table(TABLE).update({
                    "confirmations": new_count,
                    "last_confirmed_at": "now()",
                }).eq("id", existing.data["id"]).execute()
            invalidate_cache(alias_type)
            return
        except Exception:
            pass

    key = (alias_type, norm)
    row = _in_memory_store.get(key)
    if row:
        if target_id and row.get("target_id") != target_id:
            return
        row["confirmations"] = row.get("confirmations", 0) - 1
        if row["confirmations"] <= 0:
            del _in_memory_store[key]
        invalidate_cache(alias_type)
