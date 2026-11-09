"""ETL router — manual sync trigger and status endpoints.

POST /api/etl/sync   → trigger a DHIS2 sync (admin only)
GET  /api/etl/status → latest ETL runs
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from app.etl.pipeline import run_dhis2_sync
from app.etl import loaders

logger = logging.getLogger(__name__)
router = APIRouter()


class SyncRequest(BaseModel):
    source: str = "dhis2"
    scope: str = "incremental"  # 'incremental' | 'weekly' | 'annual' | 'history' | 'thematic'


class SyncResponse(BaseModel):
    status: str
    rows_loaded: int
    error: Optional[str] = None


@router.post("/sync", response_model=SyncResponse)
async def sync(req: SyncRequest, request: Request):
    """Trigger an ETL sync manually (admin only)."""
    # TODO: enforce admin role via JWT once auth middleware is wired
    if req.source != "dhis2":
        raise HTTPException(status_code=400, detail=f"Unsupported source: {req.source}")

    result = await run_dhis2_sync(scope=req.scope)
    return SyncResponse(
        status=result["status"],
        rows_loaded=result.get("rows_loaded", 0),
        error=result.get("error"),
    )


@router.get("/status")
async def etl_status():
    """Return the latest ETL runs for observability."""
    client = loaders._get_client()
    result = client.table("etl_runs").select("*").order("started_at", desc=True).limit(20).execute()
    return {"runs": result.data if result.data else []}
