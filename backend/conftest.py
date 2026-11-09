"""Pytest configuration — load environment variables before tests.

The backend reads Supabase/DHIS2/OpenAI credentials from .env at the
project root. Without this conftest, integration tests that touch
Supabase silently skip because the env vars are empty.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root (parent of backend/)
_env_root = Path(__file__).resolve().parents[1] / ".env"
if _env_root.exists():
    load_dotenv(_env_root, override=False)

# Also load .env.local if it exists (overrides .env)
_env_local = Path(__file__).resolve().parents[1] / ".env.local"
if _env_local.exists():
    load_dotenv(_env_local, override=True)
