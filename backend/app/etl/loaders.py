"""Loader — upserts transformed rows into Supabase (fact_indicator_values).

Uses the supabase-py client with the service_role key for admin access.
Upsert is idempotent thanks to the unique(source, indicator_id, org_unit_id, period) constraint.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from supabase import create_client, Client

from app.core.config import settings


logger = logging.getLogger(__name__)

_client_singleton: Client | None = None

WRITE_ATTEMPTS = 4

# A run still "running" after this long was killed (replica timeout, OOM…):
# it is marked failed so it stops blocking the next one.
STALE_RUN_AFTER = timedelta(hours=3)


def _get_client() -> Client:
    """Module-level client — creating one per call re-negotiates TLS and
    rebuilds the auth headers on every ETL batch."""
    global _client_singleton
    if _client_singleton is None:
        _client_singleton = create_client(
            settings.supabase_url,
            settings.supabase_service_key,
        )
    return _client_singleton


def _with_retry(write: Callable[[Client], Any], what: str) -> Any:
    """Run a Supabase write, retrying transient transport errors (HTTP/2
    stream resets, dropped connections) with a fresh client. Upserts are
    idempotent, so replaying a batch is safe."""
    global _client_singleton
    for attempt in range(WRITE_ATTEMPTS):
        try:
            return write(_get_client())
        except Exception as exc:  # noqa: BLE001
            if attempt == WRITE_ATTEMPTS - 1:
                raise
            logger.warning("Supabase %s failed (attempt %d/%d): %s — retrying", what, attempt + 1, WRITE_ATTEMPTS, exc)
            _client_singleton = None
            time.sleep(2 * 2 ** attempt)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_indicators(indicators: list[dict[str, str]]) -> None:
    """Make sure every indicator/data element referenced by the facts exists in
    dim_indicators (foreign key). Existing rows keep their curated labels."""
    if not indicators:
        return
    client = _get_client()
    ids = [i["id"] for i in indicators]
    existing = client.table("dim_indicators").select("id").in_("id", ids).execute()
    known = {r["id"] for r in (existing.data or [])}
    missing = [
        {
            "id": i["id"],
            "label": i["label"],
            "unit": i.get("unit", "count"),
            "icon_key": i.get("icon_key", "activity"),
            "domain": i.get("domain", "vaccination"),
        }
        for i in indicators
        if i["id"] not in known
    ]
    if missing:
        client.table("dim_indicators").insert(missing).execute()


def load(rows: list[dict[str, Any]], org_unit_meta: dict[str, dict] | None = None) -> int:
    """Upsert rows into fact_indicator_values. Returns number of rows loaded.

    Args:
        rows: transformed rows from the ETL pipeline
        org_unit_meta: optional dict {ou_id: {"name": str, "level": int, "parent_id": str}}
                       from DHIS2, used to create the org units the facts reference.
    """
    if not rows:
        return 0

    client = _get_client()
    org_unit_meta = org_unit_meta or {}

    # Ensure every org unit referenced by the facts has a row in dim_org_units,
    # WITHOUT touching the ones already there: the real names and levels are
    # loaded from /api/organisationUnits.json and must not be overwritten with
    # a placeholder on each sync (FIX-09).
    org_unit_ids = list({row["org_unit_id"] for row in rows})
    if org_unit_ids:
        known: set[str] = set()
        for i in range(0, len(org_unit_ids), 500):
            chunk = org_unit_ids[i : i + 500]
            existing = (
                client.table("dim_org_units")
                .select("id")
                .in_("id", chunk)
                .execute()
            )
            known.update(r["id"] for r in (existing.data or []))

        missing = [ou_id for ou_id in org_unit_ids if ou_id not in known]
        if missing:
            resolvable = known | set(missing)
            new_rows = []
            for ou_id in missing:
                meta = org_unit_meta.get(ou_id, {})
                parent_id = meta.get("parent_id")
                new_rows.append({
                    "id": ou_id,
                    "name": meta.get("name", ou_id),
                    "level": meta.get("level"),
                    "parent_id": parent_id if parent_id in resolvable else None,
                })
            # Parents first so the self-referencing FK is satisfied.
            new_rows.sort(key=lambda r: r["level"] or 99)
            for i in range(0, len(new_rows), 500):
                chunk_rows = new_rows[i : i + 500]
                _with_retry(
                    lambda c, rows=chunk_rows: c.table("dim_org_units").upsert(rows, on_conflict="id", ignore_duplicates=True).execute(),
                    "dim_org_units insert",
                )

    # Upsert fact rows in batches of 500 to avoid payload limits
    batch_size = 500
    total = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        _with_retry(
            lambda c, b=batch: c.table("fact_indicator_values").upsert(
                b,
                on_conflict="source,indicator_id,org_unit_id,period",
            ).execute(),
            "fact upsert",
        )
        total += len(batch)

    return total


def acquire_run(source: str, scope: str) -> str | None:
    """Create the etl_runs record for a new run, or return None when another
    run of the same source is still in progress.

    Runs stuck in 'running' for longer than STALE_RUN_AFTER are marked failed
    first: a killed job must not block the schedule forever.
    """
    client = _get_client()
    stale_before = (datetime.now(timezone.utc) - STALE_RUN_AFTER).isoformat()
    client.table("etl_runs").update({
        "status": "failed",
        "error": f"Marked stale: still running after {STALE_RUN_AFTER}",
        "finished_at": _now_iso(),
    }).eq("source", source).eq("status", "running").lt("started_at", stale_before).execute()

    active = (
        client.table("etl_runs")
        .select("id")
        .eq("source", source)
        .eq("status", "running")
        .limit(1)
        .execute()
    )
    if active.data:
        return None
    return log_run(source=source, scope=scope, status="running")


def log_run(source: str, scope: str, status: str, rows_loaded: int = 0, error: str | None = None, run_id: str | None = None) -> str:
    """Create or update an etl_runs record. Returns the run id."""
    client = _get_client()

    if run_id:
        client.table("etl_runs").update({
            "status": status,
            "rows_loaded": rows_loaded,
            "error": error,
            "finished_at": _now_iso() if status in ("success", "failed") else None,
        }).eq("id", run_id).execute()
        return run_id
    else:
        result = client.table("etl_runs").insert({
            "source": source,
            "scope": scope,
            "status": status,
        }).execute()
        return result.data[0]["id"] if result.data else ""


def get_latest_snapshot(
    source: str = "dhis2",
    since_period: str | None = None,
    limit: int = 5000,
) -> list[dict[str, Any]]:
    """Fetch the latest values per indicator from fact_indicator_values.

    Bounded by construction: an unfiltered read grows with the table (≈450k
    rows/year once zone-de-santé grain lands) while callers only ever render
    the most recent periods.
    """
    client = _get_client()
    query = client.table("fact_indicator_values").select(
        "indicator_id, org_unit_id, period, value"
    ).eq("source", source)
    if since_period:
        query = query.gte("period", since_period)
    result = query.order("period", desc=True).limit(limit).execute()
    return result.data if result.data else []
