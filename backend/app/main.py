"""
FastAPI backend — AI Decision Assistant orchestration layer.

This backend sits between Next.js and the tool services (Power BI, ML,
database, documents, notifications). It runs the LangGraph agent that
translates user intent into validated, structured actions.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env.local from project root (parent of backend/)
_env_path = Path(__file__).resolve().parents[2] / ".env.local"
if _env_path.exists():
    load_dotenv(_env_path)
# Also load backend/.env if it exists
_env_backend = Path(__file__).resolve().parents[1] / ".env"
if _env_backend.exists():
    load_dotenv(_env_backend)

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from app.routers import agent, health, tools, etl
from app.middleware.audit import AuditMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.etl.scheduler import start_scheduler, stop_scheduler
from app.tools.dhis2 import close_client as close_dhis2_client
from app.core.cache import get_cache, close_cache


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Resolve the cache backend at startup so a Redis misconfiguration shows up
    # in the boot logs instead of on the first user request.
    await get_cache()
    start_scheduler()
    yield
    stop_scheduler()
    await close_dhis2_client()
    await close_cache()


app = FastAPI(
    title="SIVAX — Assistant décisionnel du PEV",
    version="1.0.0",
    description="Couche d’orchestration de l’assistant IA et des analyses du programme de vaccination SIVAX.",
    lifespan=lifespan,
)

# ─── Middleware ────────────────────────────────────────────
# Agent responses and ETL status payloads are verbose JSON; compressing them
# above 1 KB cuts the origin → Front Door leg, which is not compressed today.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuditMiddleware)
app.add_middleware(RateLimitMiddleware, max_requests=30, window_seconds=60)

# ─── Routers ───────────────────────────────────────────────
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(agent.router, prefix="/api/agent", tags=["agent"])
app.include_router(tools.router, prefix="/api/tools", tags=["tools"])
app.include_router(etl.router, prefix="/api/etl", tags=["etl"])
