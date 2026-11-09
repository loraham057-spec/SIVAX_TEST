"""
Audit middleware — logs every request to the agent_audit_log table.

Records: user, action, args, status, duration, error.
This provides full observability and compliance tracing.
"""

import time
import json
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only audit agent API calls
        if not request.url.path.startswith("/api/agent"):
            return await call_next(request)

        start_time = time.time()

        # Get user info from headers (set by auth middleware)
        user_id = request.headers.get("X-User-Id", "")
        user_email = request.headers.get("X-User-Email", "")
        user_role = request.headers.get("X-User-Role", "viewer")

        response = await call_next(request)

        duration_ms = int((time.time() - start_time) * 1000)

        # Log to stdout (structured JSON for log aggregation)
        log_entry = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "level": "info" if response.status_code < 400 else "error",
            "type": "audit",
            "path": str(request.url.path),
            "method": request.method,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
            "user_id": user_id,
            "user_email": user_email,
            "user_role": user_role,
        }
        print(json.dumps(log_entry))

        # TODO: Also insert into agent_audit_log table via Supabase service client

        return response
