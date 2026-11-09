"""Application configuration — loaded from environment variables.

Uses a lazy proxy so that env vars are read AFTER load_dotenv() runs in main.py.
"""

from __future__ import annotations

import os
from typing import Optional
from pydantic import BaseModel


class Settings(BaseModel):
    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-6-luna"
    # Small model for nodes whose output the user never reads (intent
    # classification, clarification drafting, fact-check regeneration).
    openai_model_fast: str = "gpt-6-luna"

    # Supabase
    supabase_url: str = ""
    supabase_service_key: str = ""

    # Power BI
    powerbi_tenant_id: str = ""
    powerbi_client_id: str = ""
    powerbi_client_secret: str = ""

    # DHIS2
    dhis2_base_url: str = ""
    dhis2_username: str = ""
    dhis2_password: str = ""
    dhis2_root_ou: str = "ymGeqzoPhN3"

    # Auth
    jwt_secret: str = ""

    # Rate limiting
    rate_limit_max: int = 30
    rate_limit_window: int = 60

    # CORS
    frontend_url: str = "http://localhost:3000"


def _load() -> Settings:
    """Build Settings from current env vars (call after load_dotenv)."""
    return Settings(
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openai_model=os.getenv("OPENAI_MODEL", "gpt-6-luna"),
        openai_model_fast=os.getenv("OPENAI_MODEL_FAST", "gpt-6-luna"),
        supabase_url=os.getenv("NEXT_PUBLIC_SUPABASE_URL", ""),
        supabase_service_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
        powerbi_tenant_id=os.getenv("POWERBI_TENANT_ID", ""),
        powerbi_client_id=os.getenv("POWERBI_CLIENT_ID", ""),
        powerbi_client_secret=os.getenv("POWERBI_CLIENT_SECRET", ""),
        dhis2_base_url=os.getenv("DHIS2_BASE_URL", "").rstrip("/"),
        dhis2_username=os.getenv("DHIS2_USERNAME", ""),
        dhis2_password=os.getenv("DHIS2_PASSWORD", ""),
        dhis2_root_ou=os.getenv("DHIS2_ROOT_OU", "ymGeqzoPhN3"),
        jwt_secret=os.getenv("SUPABASE_JWT_SECRET", ""),
        rate_limit_max=int(os.getenv("RATE_LIMIT_MAX", "30")),
        rate_limit_window=int(os.getenv("RATE_LIMIT_WINDOW", "60")),
        frontend_url=os.getenv("FRONTEND_URL", "http://localhost:3000"),
    )


class _SettingsProxy:
    """Lazy proxy that loads Settings on first attribute access."""
    def __init__(self):
        self._inner: Optional[Settings] = None

    def _get(self) -> Settings:
        if self._inner is None:
            self._inner = _load()
        return self._inner

    def __getattr__(self, name: str):
        return getattr(self._get(), name)


settings = _SettingsProxy()
