"""Rate limit middleware — prevents abuse of the AI agent API.

Uses a fixed window per client, stored in the shared cache layer. The previous
implementation kept the window in a process-local dict, which meant the
effective quota was silently multiplied by the number of replicas — three
replicas turned a 30 req/min limit into 90. Backing it with the shared cache
makes the limit hold across the whole deployment as soon as REDIS_URL is set.
"""

import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.cache import get_cache


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_requests: int = 30, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds

    def _client_key(self, request: Request) -> str:
        # Behind Front Door / a reverse proxy, request.client.host is the proxy.
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(self, request: Request, call_next):
        # Only rate-limit agent API calls
        if not request.url.path.startswith("/api/agent"):
            return await call_next(request)

        client = self._client_key(request)
        window = int(time.time() // self.window_seconds)
        key = f"ratelimit:agent:{client}:{window}"

        cache = await get_cache()
        count = await cache.incr_window(key, self.window_seconds)

        if count > self.max_requests:
            retry_after = self.window_seconds - int(time.time() % self.window_seconds)
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Rate limit exceeded",
                    "detail": f"Maximum {self.max_requests} requests per {self.window_seconds}s",
                },
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(self.max_requests),
                    "X-RateLimit-Remaining": "0",
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.max_requests)
        response.headers["X-RateLimit-Remaining"] = str(max(0, self.max_requests - count))
        return response
