"""Shared cache and counter layer.

Every cache in this codebase used to be a module-level dict: the DHIS2 metadata
and analytics caches, the rate limiter's sliding window. That works for exactly
one replica. As soon as the service scales out, each replica keeps its own copy
— the cache hit rate collapses and, worse, the rate limiter silently multiplies
the effective quota by the number of replicas.

This module puts one interface in front of both storage strategies:

  · `RedisBackend`    — used when REDIS_URL is set. State is shared by every
                        replica, and survives a restart.
  · `MemoryBackend`   — the fallback. Same semantics, process-local scope.

Nothing else in the codebase needs to know which one is active, so moving to
Azure Cache for Redis is a deployment change, not a code change.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)


class CacheBackend:
    """Interface implemented by both backends."""

    async def get(self, key: str) -> Optional[Any]:
        raise NotImplementedError

    async def set(self, key: str, value: Any, ttl: int) -> None:
        raise NotImplementedError

    async def delete(self, key: str) -> None:
        raise NotImplementedError

    async def incr_window(self, key: str, window_seconds: int) -> int:
        """Increment a counter that expires after `window_seconds`.

        Returns the counter value after the increment — used by the rate
        limiter to decide whether the caller is over quota.
        """
        raise NotImplementedError

    async def close(self) -> None:
        return None


class MemoryBackend(CacheBackend):
    """Process-local cache. Correct for a single replica, and the safety net
    when Redis is unreachable."""

    def __init__(self, max_entries: int = 5000):
        self._data: dict[str, tuple[float, Any]] = {}
        self._max_entries = max_entries

    def _purge_if_needed(self) -> None:
        if len(self._data) < self._max_entries:
            return
        now = time.time()
        expired = [k for k, (exp, _) in self._data.items() if exp <= now]
        for key in expired:
            self._data.pop(key, None)
        # Still full of live entries: drop the soonest to expire so the map
        # cannot grow without bound.
        if len(self._data) >= self._max_entries:
            for key, _ in sorted(self._data.items(), key=lambda kv: kv[1][0])[: self._max_entries // 10]:
                self._data.pop(key, None)

    async def get(self, key: str) -> Optional[Any]:
        entry = self._data.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.time() > expires_at:
            self._data.pop(key, None)
            return None
        return value

    async def set(self, key: str, value: Any, ttl: int) -> None:
        self._purge_if_needed()
        self._data[key] = (time.time() + ttl, value)

    async def delete(self, key: str) -> None:
        self._data.pop(key, None)

    async def incr_window(self, key: str, window_seconds: int) -> int:
        entry = self._data.get(key)
        now = time.time()
        if entry is None or now > entry[0]:
            self._data[key] = (now + window_seconds, 1)
            return 1
        expires_at, count = entry
        count = int(count) + 1
        self._data[key] = (expires_at, count)
        return count


class RedisBackend(CacheBackend):
    """Shared cache. Any failure degrades to the in-memory backend rather than
    failing the request — a cache outage must not take the API down."""

    def __init__(self, client, fallback: MemoryBackend):
        self._client = client
        self._fallback = fallback

    async def get(self, key: str) -> Optional[Any]:
        try:
            raw = await self._client.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception as e:  # noqa: BLE001
            logger.warning("Redis GET failed for %s (%s) — falling back to memory", key, e)
            return await self._fallback.get(key)

    async def set(self, key: str, value: Any, ttl: int) -> None:
        try:
            await self._client.set(key, json.dumps(value, default=str), ex=ttl)
        except Exception as e:  # noqa: BLE001
            logger.warning("Redis SET failed for %s (%s) — falling back to memory", key, e)
            await self._fallback.set(key, value, ttl)

    async def delete(self, key: str) -> None:
        try:
            await self._client.delete(key)
        except Exception as e:  # noqa: BLE001
            logger.warning("Redis DEL failed for %s (%s)", key, e)
        await self._fallback.delete(key)

    async def incr_window(self, key: str, window_seconds: int) -> int:
        try:
            # INCR then EXPIRE on first hit: atomic enough for a fixed window,
            # and one round trip in a pipeline.
            pipe = self._client.pipeline()
            pipe.incr(key)
            pipe.expire(key, window_seconds, nx=True)
            result = await pipe.execute()
            return int(result[0])
        except Exception as e:  # noqa: BLE001
            logger.warning("Redis INCR failed for %s (%s) — falling back to memory", key, e)
            return await self._fallback.incr_window(key, window_seconds)

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:  # noqa: BLE001
            pass


_backend: CacheBackend | None = None
_backend_lock = asyncio.Lock()


async def get_cache() -> CacheBackend:
    global _backend
    if _backend is not None:
        return _backend

    async with _backend_lock:
        if _backend is not None:
            return _backend

        redis_url = os.getenv("REDIS_URL", "").strip()
        fallback = MemoryBackend()

        if not redis_url:
            logger.info("Cache: in-memory (REDIS_URL not set — single-replica mode)")
            _backend = fallback
            return _backend

        try:
            from redis.asyncio import from_url  # type: ignore[import-not-found]

            client = from_url(redis_url, decode_responses=True)
            await client.ping()
            logger.info("Cache: Redis (shared across replicas)")
            _backend = RedisBackend(client, fallback)
        except Exception as e:  # noqa: BLE001
            logger.warning("Cache: Redis unavailable (%s) — using in-memory", e)
            _backend = fallback

    return _backend


async def close_cache() -> None:
    global _backend
    if _backend is not None:
        await _backend.close()
    _backend = None
