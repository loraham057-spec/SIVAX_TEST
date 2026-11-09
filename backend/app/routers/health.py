"""Health and readiness endpoints.

Two endpoints, two questions, deliberately kept apart:

  /api/health — liveness. "Is this process alive?" It checks nothing external.
                A database or Redis blip must not get every replica killed and
                restarted; that turns a dependency hiccup into an outage.

  /api/ready  — readiness. "Can this replica serve a request right now?" It
                does check dependencies, so a replica that cannot serve is
                pulled out of rotation instead of returning errors.
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Response

from app.core.cache import get_cache
from app.core.config import settings

router = APIRouter()

CHECK_TIMEOUT_SECONDS = 2.0


@router.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "tbi-pfizer-ai-backend",
        "version": "1.0.0",
    }


async def _timed(coro) -> dict:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(coro, timeout=CHECK_TIMEOUT_SECONDS)
        return {"state": "ok", "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except asyncio.TimeoutError:
        return {
            "state": "unavailable",
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "detail": f"timeout after {CHECK_TIMEOUT_SECONDS}s",
        }
    except Exception as e:  # noqa: BLE001
        return {
            "state": "unavailable",
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "detail": str(e),
        }


async def _probe_cache() -> None:
    cache = await get_cache()
    key = "readiness:probe"
    await cache.set(key, "1", 10)
    await cache.get(key)


@router.get("/ready")
async def readiness_check(response: Response):
    checks: dict[str, dict] = {}

    # The cache layer always answers — it falls back to memory when Redis is
    # absent — so this verifies the layer works, not that Redis is reachable.
    checks["cache"] = await _timed(_probe_cache())

    # Configuration is a hard requirement: without an LLM key the agent cannot
    # answer anything, and a replica in that state should not take traffic.
    checks["llm_configured"] = {
        "state": "ok" if settings.openai_api_key else "unavailable",
        "detail": None if settings.openai_api_key else "OPENAI_API_KEY is not set",
    }

    checks["dhis2_configured"] = {
        "state": "ok" if settings.dhis2_base_url else "not-configured",
    }

    hard_failures = [
        name for name, c in checks.items()
        if name in ("cache", "llm_configured") and c["state"] != "ok"
    ]

    ready = not hard_failures
    response.status_code = 200 if ready else 503
    response.headers["Cache-Control"] = "no-store"

    return {"ready": ready, "checks": checks}
