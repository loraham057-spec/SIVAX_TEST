"""ETL pipeline — orchestrates extract → transform → load for DHIS2.

This is the single entry point called by the scheduler and the manual
sync endpoint. Designed to be reusable: adding a new source means
adding a new extractor in sources/ and calling run_pipeline with it.

Rows are loaded stage by stage as the extractor produces them, so a run that
is killed by the job runner still leaves the completed stages in Supabase, and
the whole run is bounded by ETL_TIMEOUT_SECONDS (below the Container App Job
replica timeout, so the run is closed as `failed` instead of staying `running`).
"""

import asyncio
import logging
import os
from typing import Any

import httpx

from app.etl.sources import dhis2 as dhis2_source
from app.etl import transforms, loaders

logger = logging.getLogger(__name__)

# Five minutes under the Container App Job replica timeouts (120 min).
DEFAULT_TIMEOUT_SECONDS = {"incremental": 6900, "weekly": 6900, "full": 6900, "history": 6900, "thematic": 6900, "annual": 3300}


def _timeout_seconds(scope: str) -> float:
    return float(os.getenv("ETL_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS.get(scope, 3300)))


def _close_run(run_id: str, scope: str, status: str, rows_loaded: int, error: str | None = None) -> None:
    """Best effort: if Supabase is unreachable the run stays 'running' and is
    marked stale by the next acquire_run()."""
    try:
        loaders.log_run(source="dhis2", scope=scope, status=status, rows_loaded=rows_loaded, error=error, run_id=run_id)
    except Exception as exc:  # noqa: BLE001
        logger.error("ETL dhis2: could not close run %s — %s", run_id, exc)


async def run_dhis2_sync(scope: str = "incremental") -> dict[str, Any]:
    """Run a full DHIS2 ETL cycle.

    Args:
        scope: 'incremental' (Wednesday, 3 last complete months),
               'weekly' (Sunday, same window incl. thematic zones; 'full' is an alias),
               'annual' (monthly, yearly aggregates + population),
               'history' (manual, one window of older months) or
               'thematic' (manual, thematic pages only).

    Returns:
        Dict with status, rows_loaded, error.
    """
    run_id = loaders.acquire_run(source="dhis2", scope=scope)
    if run_id is None:
        logger.warning("ETL dhis2: a run is already in progress — skipping")
        return {"status": "skipped", "rows_loaded": 0, "error": "already running"}

    loaders.ensure_indicators(dhis2_source.ALL_DEFINITIONS)

    rows_loaded = 0
    org_unit_meta: dict[str, dict] = {}

    async def load_stage(stage: str, raw_rows: list[dict[str, Any]], client: httpx.AsyncClient) -> None:
        nonlocal rows_loaded
        new_ous = [ou for ou in {r["org_unit"] for r in raw_rows} if ou not in org_unit_meta]
        if new_ous:
            org_unit_meta.update(await dhis2_source.fetch_org_unit_names(client, new_ous))
        transformed = transforms.transform(raw_rows, source="dhis2")
        loaded = await asyncio.to_thread(loaders.load, transformed, org_unit_meta)
        rows_loaded += loaded
        logger.info("ETL dhis2: stage %s loaded %d rows (total %d)", stage, loaded, rows_loaded)
        _close_run(run_id, scope, "running", rows_loaded)

    try:
        async with httpx.AsyncClient() as client:
            async def sink(stage: str, raw_rows: list[dict[str, Any]]) -> None:
                await load_stage(stage, raw_rows, client)

            await asyncio.wait_for(
                dhis2_source.extract(client, scope=scope, sink=sink),
                timeout=_timeout_seconds(scope),
            )

        _close_run(run_id, scope, "success", rows_loaded)
        return {"status": "success", "rows_loaded": rows_loaded}

    except asyncio.TimeoutError:
        error = f"Timed out after {_timeout_seconds(scope):.0f}s ({rows_loaded} rows loaded before)"
        logger.error("ETL dhis2: %s", error)
        _close_run(run_id, scope, "failed", rows_loaded, error)
        return {"status": "failed", "error": error, "rows_loaded": rows_loaded}

    except Exception as exc:
        logger.error("ETL dhis2: failed — %s", exc)
        _close_run(run_id, scope, "failed", rows_loaded, str(exc))
        return {"status": "failed", "error": str(exc), "rows_loaded": rows_loaded}

    except (asyncio.CancelledError, KeyboardInterrupt):
        # The job runner is stopping us: close the run so the next one is not blocked.
        _close_run(run_id, scope, "failed", rows_loaded, "interrupted")
        raise
