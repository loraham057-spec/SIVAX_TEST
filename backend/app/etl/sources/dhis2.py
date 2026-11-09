"""DHIS2 source extractor — fetches analytics data from SNIS RDC.

Mirrors the logic in src/lib/dhis2.ts (Next.js) but in Python.
Uses httpx for async HTTP with retry/backoff for resilience against
the notoriously unstable SNIS RDC server.

When the analytics API returns 0 rows (empty analytics tables),
falls back to the dataValueSets API and aggregates locally.
"""

from __future__ import annotations

import asyncio
import os
import re
import base64
from datetime import datetime
import logging
from typing import Any, Awaitable, Callable

import httpx

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────

def _base_url() -> str:
    return os.getenv("DHIS2_BASE_URL", "")

def _username() -> str:
    return os.getenv("DHIS2_USERNAME", "")

def _password() -> str:
    return os.getenv("DHIS2_PASSWORD", "")

def _root_ou() -> str:
    return os.getenv("DHIS2_ROOT_OU", "ymGeqzoPhN3")

ANALYTICS_TIMEOUT_SECONDS = float(os.getenv("ETL_DHIS2_TIMEOUT_SECONDS", "150"))
ANALYTICS_ATTEMPTS = int(os.getenv("ETL_DHIS2_ATTEMPTS", "4"))

# Curated national indicators (must match dim_indicators seed)
# These are DHIS2 indicator UIDs confirmed to have real data in SNIS RDC.
# Source: direct DHIS2 audit (see ANALYSE_AI_AGENT_DECISION_INTELLIGENCE.md §11)
# Updated: full PEV antigen audit via DHIS2 API search.
INDICATORS: list[dict[str, str]] = [
    # ─── Paludisme (existing) ───
    {"id": "rOt4BctnRqS", "label": "Cas de paludisme (présumés et confirmés)", "unit": "count", "icon_key": "activity", "domain": "malaria"},
    {"id": "l5Gjya9Udz7", "label": "Paludisme confirmé traité", "unit": "count", "icon_key": "syringe", "domain": "malaria"},
    {"id": "rPYLomUceL4", "label": "Paludisme confirmé (microscopie/TDR)", "unit": "count", "icon_key": "package", "domain": "malaria"},
    # ─── Maternal health (existing) ───
    {"id": "eVbOZqoI7JP", "label": "Accouchements assistés par personnel qualifié", "unit": "percent", "icon_key": "users", "domain": "maternal"},
    # ─── Vaccination — PEV coverage indicators (all antigens from DHIS2) ───
    {"id": "k26tJ22Ncpd", "label": "Taux de couverture vaccinale en Pentavalent 1", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "v9b9aYsA5PM", "label": "Taux de couverture vaccinale en Pentavalent 3", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "cWJXYKCXrLx", "label": "Taux de couverture vaccinale en BCG", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "tNZxs1kE6fy", "label": "Taux de couverture vaccinale en VAP 4", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "RZuHoUKI3fc", "label": "Taux de couverture en VAP 1", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "Dx7fV8rLg5F", "label": "Taux de couverture en PCV-13 (1)", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "biBItnhkMUe", "label": "Taux de couverture en PCV-13 (3)", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "k8womY2OabA", "label": "Taux de couverture en ROTA 1", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "HX6kfUl1auv", "label": "Taux de couverture en ROTA 3", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "PR35pwZEAny", "label": "Taux de couverture en VPO 3", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "F35ZsGcz2Lv", "label": "Taux de couverture en VPI 1", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "khtnBZ1Ispo", "label": "Taux de couverture en VPI 2", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "OKaDG2t6LtN", "label": "Taux de couverture en VAR 1", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "j2RPbYTGkAf", "label": "Taux de couverture en VAA", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "z4Iqy42FhNf", "label": "Taux de couverture en Td 2+", "unit": "percent", "icon_key": "syringe", "domain": "vaccination"},
    # ─── Vaccination — dropout / loss indicators ───
    {"id": "MULXtL8iom8", "label": "Taux d'abandons DTC-HepB-Hib1-DTC-Hep-Hib3", "unit": "percent", "icon_key": "trending-down", "domain": "vaccination"},
    {"id": "FhQ8Hd5rCHj", "label": "EPI - MR 1 to 2 dropout rate", "unit": "percent", "icon_key": "trending-down", "domain": "vaccination"},
    {"id": "YM7Tmn01ieL", "label": "Taux de perte des vaccins", "unit": "percent", "icon_key": "alert", "domain": "vaccination"},
    # ─── Vaccination — population indicators ───
    {"id": "nvPe9ZZiEaH", "label": "Taux d'enfants complètement vaccinés", "unit": "percent", "icon_key": "check-circle", "domain": "vaccination"},
    {"id": "RMHgIqfBG7N", "label": "Nombre d'enfants sous vaccinés (SV)", "unit": "count", "icon_key": "users", "domain": "vaccination"},
    # ─── Vaccination — doses administered (B 8.4 series, aggregated) ───
    {"id": "W25tOXS0rxS", "label": "BCG - doses administrées (agrégé)", "unit": "count", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "uNdFg1eymsa", "label": "DTC-HepB Hib 1 - doses administrées", "unit": "count", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "WWxqaHSeiwd", "label": "DTC-HepB Hib 3 - doses administrées", "unit": "count", "icon_key": "syringe", "domain": "vaccination"},
    {"id": "hF8wVIOJrT8", "label": "Enfants récupérés par les CAC-BCG", "unit": "count", "icon_key": "users", "domain": "vaccination"},
]

# Population / target data elements (annual periods). Synced so the "Cibles"
# page reads the snapshot instead of hitting DHIS2 live on every visit.
POPULATION_DATA_ELEMENTS: list[dict[str, str]] = [
    {"id": "WLSKVyA8LoY", "label": "Population totale", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "gDnbubwzuts", "label": "Naissances vivantes", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "gKPWbBQPARu", "label": "Cible vaccinale attendue", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "x11HLiggMXS", "label": "Femmes enceintes", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "VrwYlqEHl9S", "label": "Population cible Accouchement", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "IBGIRfSP2Jg", "label": "Population 0-11 mois dénombrée", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "dCBjhC2T98U", "label": "Population 0-12 mois dénombrée", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "xG7yuRfm4Xy", "label": "Population 0-5 ans", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "y9VVUAUMYQZ", "label": "Population 0-4 ans - Masculin", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "bg69hyC1ufp", "label": "Population 0-4 ans - Féminin", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "jG1u3p3LwzY", "label": "Population 5-9 ans - Féminin", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "wWUcvf2KNPc", "label": "Population 5-9 ans - Masculin", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "TjUCEbelXqi", "label": "Population 10-14 ans - Féminin", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "HERa1PYydgt", "label": "Population 10-14 ans - Masculin", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "vUS6lPL5gLb", "label": "Population 15-19 ans - Féminin", "unit": "count", "icon_key": "users", "domain": "population"},
    {"id": "TO1gFP0JTQh", "label": "Population 15-19 ans - Masculin", "unit": "count", "icon_key": "users", "domain": "population"},
]


# ─── Thematic pages (supply, data quality, management, surveillance, cold chain)

def _ind(id_: str, label: str, unit: str, domain: str) -> dict[str, str]:
    return {"id": id_, "label": label, "unit": unit, "icon_key": "activity", "domain": domain}


# SIGL ESS 2025 (DxDuYrrZSa7): vaccine stock is reported there since the 2025
# edition of the PEV form dropped section B 6.1. Each data element is
# disaggregated by an LMIS category option combo; values are stored as
# operands "<DE>.<COC>".
SIGL_VACCINES: dict[str, str] = {
    "l1bhrYUPsde": "BCG",
    "uAWIVDnGPGH": "Penta",
    "hqqlXMmY95c": "PCV-13",
    "MJrLCya7qzt": "Rota",
    "BCXcLiQNI8M": "VPO",
    "IisI6JudbS8": "VPI",
    "Hjlw6DpooIo": "VAR",
    "vrTdwvAQSUc": "VAA",
    "iFMn6ceqdIN": "Td",
    "RYaAzE1eqya": "VAP",
    "BfoCv6bUeBk": "HPV",
}
SIGL_COCS: dict[str, str] = {
    "kOWsLrtvrhn": "Stock disponible utilisable (SDU)",
    "t5L9ODSuYOG": "Consommation moyenne mensuelle (CMM)",
    "Lpu56KTyGvy": "Stock maximum",
    "XEN3ucCGa07": "Jours de rupture de stock",
    "dxDQKDcTn6Z": "Quantité administrée",
    # Wastage rate per antigen = (utilisée − administrée) ÷ utilisée, the
    # formula of the DHIS2 "LMIS <vaccin> (Taux de perte)" indicators and,
    # summed over all vaccines, of YM7Tmn01ieL.
    "pdKyvaYRqCj": "Quantité utilisée",
    "J8mw9rFkY4v": "Pertes",
}
STOCKOUT_COC = "XEN3ucCGa07"
CMM_COC = "t5L9ODSuYOG"
SIGL_OPERANDS: list[dict[str, str]] = [
    _ind(f"{de}.{coc}", f"{name} — {coc_label}", "count", "supply")
    for de, name in SIGL_VACCINES.items()
    for coc, coc_label in SIGL_COCS.items()
]

# Synthetic indicators computed by the ETL from facility-level (level 5) data:
# number of facilities with at least one day of stock-out in the month, and
# the denominator of the stock-out rate: facilities managing the antigen
# (consumption reported or stock-out declared). SIGL ESS reports received
# are not a valid denominator: SIGL also covers facilities that do not
# vaccinate (≈ 75 % of the reports in Kinshasa).
STOCKOUT_ANY = "STOCKOUT_FOSA.ANY"
STOCKOUT_BASE_ANY = "STOCKOUT_BASE.ANY"
STOCKOUT_INDICATORS: list[dict[str, str]] = [
    _ind(f"STOCKOUT_FOSA.{de}", f"FOSA en rupture de {name}", "count", "supply")
    for de, name in SIGL_VACCINES.items()
] + [_ind(STOCKOUT_ANY, "FOSA en rupture d'au moins un vaccin", "count", "supply")] + [
    _ind(f"STOCKOUT_BASE.{de}", f"FOSA gérant {name} (CMM ou rupture déclarée)", "count", "supply")
    for de, name in SIGL_VACCINES.items()
] + [_ind(STOCKOUT_BASE_ANY, "FOSA gérant au moins un vaccin (CMM ou rupture déclarée)", "count", "supply")]

# Data elements, dataset reporting rates and a few native indicators. Cheap
# to compute server-side, so they are requested in wider batches.
EXTRA_INDICATORS: list[dict[str, str]] = [
    # Data quality — native DHIS2 reporting rates
    _ind("E4BX1ea2iDJ.REPORTING_RATE", "Complétude rapport PEV (B 2025)", "percent", "dataquality"),
    _ind("E4BX1ea2iDJ.REPORTING_RATE_ON_TIME", "Promptitude rapport PEV (B 2025)", "percent", "dataquality"),
    _ind("ahT7ysZZ913.REPORTING_RATE", "Complétude rapport A (2025)", "percent", "dataquality"),
    _ind("ahT7ysZZ913.REPORTING_RATE_ON_TIME", "Promptitude rapport A (2025)", "percent", "dataquality"),
    _ind("DxDuYrrZSa7.REPORTING_RATE", "Complétude SIGL ESS", "percent", "dataquality"),
    _ind("DxDuYrrZSa7.REPORTING_RATE_ON_TIME", "Promptitude SIGL ESS", "percent", "dataquality"),
    _ind("DxDuYrrZSa7.ACTUAL_REPORTS", "Rapports SIGL ESS reçus", "count", "dataquality"),
    _ind("YCYOKxjY2vk.REPORTING_RATE", "Complétude eSurveillance hebdo", "percent", "dataquality"),
    _ind("YCYOKxjY2vk.REPORTING_RATE_ON_TIME", "Promptitude eSurveillance hebdo", "percent", "dataquality"),
    _ind("YYKXOc7xBUi", "DTC-HepB Hib 2 - doses administrées", "count", "vaccination"),
    # Management
    _ind("s5EUr8GznWY", "Séances de vaccination prévues", "count", "management"),
    _ind("lHB57kjRtUz", "Séances de vaccination réalisées", "count", "management"),
    _ind("BqD7WfEaOGL", "Supervisions programmées (BCZ)", "count", "management"),
    _ind("wPhEOPs1VSw", "Supervisions exécutées (BCZ)", "count", "management"),
    _ind("R5aQwR80b73", "Supervisions exécutées avec rétro-information", "count", "management"),
    _ind("P7YP5utRNC7", "Pourcentage des supervisions exécutées par l'ECZS", "percent", "management"),
    # Surveillance (weekly eSurveillance, aggregated to months)
    _ind("KWjTStRWD7G", "PFA - cas", "count", "surveillance"),
    _ind("SUHNj4sKNJu", "PFA - décès", "count", "surveillance"),
    _ind("qefGtS4yIRf", "Rougeole - cas", "count", "surveillance"),
    _ind("I9b3EuPa3vy", "Rougeole - décès", "count", "surveillance"),
    _ind("zDdJIzArBCt", "Fièvre jaune - cas", "count", "surveillance"),
    _ind("K0F71TaN8aB", "Fièvre jaune - décès", "count", "surveillance"),
    _ind("vfwGMNLW4Ud", "Tétanos néonatal - cas", "count", "surveillance"),
    _ind("gNzNzI3r8S0", "Tétanos néonatal - décès", "count", "surveillance"),
    _ind("Msq4aeFkV4o", "MAPI graves - cas", "count", "surveillance"),
    _ind("DRTMvzMD7wG", "MAPI légères - cas", "count", "surveillance"),
    # Cold chain
    _ind("gMJT9WyszD4", "Frigos (déclarés BCZ, F 2.4)", "count", "coldchain"),
    _ind("aVGXisHECwk", "Congélateurs (déclarés BCZ, F 2.4)", "count", "coldchain"),
    _ind("KeVd89m64zV", "% CS avec accumulateurs de froid (au moins 4)", "percent", "coldchain"),
]
EXTRA_BATCH_SIZE = 6

ALL_DEFINITIONS: list[dict[str, str]] = [
    *INDICATORS, *POPULATION_DATA_ELEMENTS, *SIGL_OPERANDS, *STOCKOUT_INDICATORS, *EXTRA_INDICATORS,
]
SIGL_BATCH_SIZE = 4  # data elements per request, all combos returned via dimension=co


def is_configured() -> bool:
    return bool(_base_url() and _username() and _password())


def _auth_header() -> str:
    token = base64.b64encode(f"{_username()}:{_password()}".encode()).decode()
    return f"Basic {token}"


def _incomplete_periods() -> list[str]:
    """Return current + previous month YYYYMM (still being reported)."""
    now = datetime.utcnow()
    cur = f"{now.year}{now.month:02d}"
    prev_date = datetime(now.year, now.month - 1, 1) if now.month > 1 else datetime(now.year - 1, 12, 1)
    prev = f"{prev_date.year}{prev_date.month:02d}"
    return [cur, prev]


def _last_months(n: int) -> list[str]:
    """The n months before the current one, as YYYYMM (most recent first)."""
    now = datetime.utcnow()
    months: list[str] = []
    for i in range(1, n + 1):
        y, m = now.year, now.month - i
        while m < 1:
            m += 12
            y -= 1
        months.append(f"{y}{m:02d}")
    return months


def _resolve_relative_periods(period: str = "LAST_12_MONTHS") -> list[str]:
    """Resolve DHIS2 relative period to list of YYYYMM strings."""
    n = {"LAST_24_MONTHS": 24, "LAST_12_MONTHS": 12, "LAST_6_MONTHS": 6, "LAST_3_MONTHS": 3}.get(period, 12)
    return _last_months(n)


# Sync scopes (see app/etl/cli.py):
#   incremental  Wednesday   3 last complete months, thematic pages without zones
#   weekly       Sunday      3 last complete months, everything incl. thematic zones
#   annual       monthly     yearly aggregates + population
#   history      manual      older months, one window per run (ETL_MONTHS / ETL_MONTHS_OFFSET)
#   thematic     manual      thematic pages only (backfill)
# "full" is kept as an alias of "weekly" for jobs deployed before the split.
SCOPE_ALIASES = {"full": "weekly"}


def normalize_scope(scope: str) -> str:
    return SCOPE_ALIASES.get(scope, scope)


def scope_periods(scope: str) -> list[str]:
    """Complete monthly periods covered by a sync scope.

    Months older than ~3 months barely change in DHIS2, so scheduled runs only
    refresh the 3 last complete months. Older history is loaded once with the
    `history` scope, one window per run so each run stays within the job's
    time limit: ETL_MONTHS (window size, default 6) months, skipping the
    ETL_MONTHS_OFFSET (default 3) most recent complete months.
    """
    scope = normalize_scope(scope)
    exclude = set(_incomplete_periods())
    if scope == "history":
        n = int(os.getenv("ETL_MONTHS", "6"))
        offset = int(os.getenv("ETL_MONTHS_OFFSET", "3"))
    else:
        n = int(os.getenv("ETL_MONTHS", "3"))
        offset = 0
    # Skip the two months still being reported, then take the window.
    complete = [p for p in _last_months(n + offset + 2) if p not in exclude]
    return complete[offset:offset + n]


def scope_years(scope: str) -> list[str]:
    now = datetime.utcnow()
    span = 4
    return [str(now.year - i) for i in range(span)]


async def fetch_org_unit_names(client: httpx.AsyncClient, ou_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch org unit names, levels and parents from DHIS2.

    Returns a dict: {ou_id: {"name": str, "level": int, "parent_id": str | None}}
    """
    if not ou_ids:
        return {}

    result: dict[str, dict[str, Any]] = {}
    # Fetch in batches of 50 to avoid URL length limits
    BATCH = 50
    for i in range(0, len(ou_ids), BATCH):
        batch = ou_ids[i:i + BATCH]
        ids_param = ",".join(batch)
        url = f"{_base_url()}/api/organisationUnits.json?filter=id:in:[{ids_param}]&fields=id,name,level,parent[id]&paging=false"
        try:
            resp = await client.get(url, headers={"Authorization": _auth_header()}, timeout=30.0)
            if resp.status_code == 200:
                data = resp.json()
                for ou in data.get("organisationUnits", []):
                    result[ou["id"]] = {
                        "name": ou.get("name", ou["id"]),
                        "level": ou.get("level", 2),
                        "parent_id": (ou.get("parent") or {}).get("id"),
                    }
        except Exception:
            pass  # Non-fatal — names will default to IDs

    return result


async def fetch_provinces(client: httpx.AsyncClient) -> list[str]:
    """UIDs of the level-2 org units (provinces)."""
    url = f"{_base_url()}/api/organisationUnits.json?filter=level:eq:2&fields=id&paging=false"
    resp = await client.get(url, headers={"Authorization": _auth_header(), "Accept": "application/json"}, timeout=60.0)
    resp.raise_for_status()
    return [ou["id"] for ou in resp.json().get("organisationUnits", [])]


async def fetch_zones_by_province(client: httpx.AsyncClient) -> dict[str, list[str]]:
    """Zones de santé (level 3) grouped by province."""
    url = f"{_base_url()}/api/organisationUnits.json?filter=level:eq:3&fields=id,parent[id]&paging=false"
    resp = await client.get(url, headers={"Authorization": _auth_header(), "Accept": "application/json"}, timeout=60.0)
    resp.raise_for_status()
    out: dict[str, list[str]] = {}
    for ou in resp.json().get("organisationUnits", []):
        parent = (ou.get("parent") or {}).get("id")
        if parent:
            out.setdefault(parent, []).append(ou["id"])
    return out


async def fetch_org_unit_tree(
    client: httpx.AsyncClient,
    max_level: int = 4,
) -> list[dict[str, Any]]:
    """Fetch the complete org unit hierarchy from DHIS2 (levels 1 to max_level).

    Returns a flat list of dicts:
      {id, name, level, parent_id}

    DHIS2 RDC hierarchy:
      Level 1: National (1)
      Level 2: Province (26)
      Level 3: Zone de santé (519)
      Level 4: Aire de santé (~10K)
      Level 5: Centre/Poste de santé (~25K) — excluded by default

    Fetches level by level to keep requests small and resilient.
    """
    all_units: list[dict[str, Any]] = []
    root = _root_ou()

    # Level 1: National (already known)
    all_units.append({
        "id": root,
        "name": "République Démocratique du Congo",
        "level": 1,
        "parent_id": None,
    })

    for level in range(2, max_level + 1):
        log_count = len(all_units)
        # Fetch all org units at this level with their parent
        page = 1
        page_size = 500
        while True:
            url = (
                f"{_base_url()}/api/organisationUnits.json"
                f"?filter=level:eq:{level}"
                f"&fields=id,name,level,parent[id,name]"
                f"&pageSize={page_size}&page={page}"
            )
            try:
                resp = await client.get(
                    url,
                    headers={"Authorization": _auth_header(), "Accept": "application/json"},
                    timeout=120.0,
                )
                resp.raise_for_status()
                data = resp.json()
                units = data.get("organisationUnits", [])
                if not units:
                    break
                for ou in units:
                    parent = ou.get("parent", {})
                    all_units.append({
                        "id": ou["id"],
                        "name": ou.get("name", ou["id"]),
                        "level": ou.get("level", level),
                        "parent_id": parent.get("id") if parent else None,
                    })
                # Check if there are more pages
                pager = data.get("pager", {})
                total_pages = pager.get("pageCount", 1)
                if page >= total_pages:
                    break
                page += 1
            except Exception:
                break  # Stop this level on error, continue to next

        print(f"  Level {level}: {len(all_units) - log_count} org units loaded (total: {len(all_units)})")

    return all_units


async def fetch_analytics(
    client: httpx.AsyncClient,
    dx: list[str],
    period: str = "LAST_12_MONTHS",
    ou: str | None = None,
    level: int | None = None,
    extra: str = "",
) -> dict[str, Any]:
    """Fetch analytics from DHIS2 with retry/backoff.

    If level is provided, fetches all org units at that level under the
    parent ou (e.g. level=2 fetches all provinces under the national root).
    `extra` is appended to the query string (e.g. "&dimension=co").
    """
    ou = ou or _root_ou()
    ou_param = f"{ou};LEVEL-{level}" if level else ou
    dx_param = ";".join(dx)
    path = (
        f"/api/analytics.json?dimension=dx:{dx_param}"
        f"&dimension=pe:{period}"
        f"&dimension=ou:{ou_param}"
        f"&displayProperty=NAME"
        f"&skipMeta=false"
        f"&skipRounding=true"
        f"{extra}"
    )
    url = f"{_base_url()}{path}"

    # SNIS RDC regularly needs well over a minute per analytics query and
    # drops connections under load; a nightly job can afford to wait and to
    # back off generously rather than lose the batch.
    attempts = ANALYTICS_ATTEMPTS
    for attempt in range(attempts):
        try:
            resp = await client.get(
                url,
                headers={"Authorization": _auth_header(), "Accept": "application/json"},
                timeout=ANALYTICS_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            if attempt < attempts - 1:
                await asyncio.sleep(min(5 * 2 ** attempt, 60))  # 5s, 10s, 20s, 40s
                continue
            raise RuntimeError(
                f"DHIS2 fetch failed after {attempts} attempts: {type(exc).__name__} {exc}".strip()
            ) from exc

    return {"rows": []}


async def _fetch_indicator_definition(client: httpx.AsyncClient, indicator_id: str) -> dict[str, Any]:
    """Fetch indicator definition and extract numerator/denominator data elements."""
    url = f"{_base_url()}/api/indicators/{indicator_id}.json?fields=id,name,numerator,denominator,indicatorType[id,name]"

    for attempt in range(3):
        try:
            resp = await client.get(
                url,
                headers={"Authorization": _auth_header(), "Accept": "application/json"},
                timeout=30.0,
            )
            resp.raise_for_status()
            raw = resp.json()
            break
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            raise

    def extract_des(formula: str) -> list[str]:
        matches = re.findall(r"#\{(\w+)\}", formula)
        return matches

    numerator = raw.get("numerator", "")
    denominator = raw.get("denominator", "")
    numerator_des = extract_des(numerator)
    denominator_des = extract_des(denominator)
    denominator_is_constant = len(denominator_des) == 0
    denominator_value = 1
    if denominator_is_constant:
        try:
            denominator_value = float(denominator.strip()) or 1
        except ValueError:
            denominator_value = 1

    return {
        "id": raw.get("id", indicator_id),
        "name": raw.get("name", indicator_id),
        "numerator_des": numerator_des,
        "denominator_des": denominator_des,
        "denominator_is_constant": denominator_is_constant,
        "denominator_value": denominator_value,
    }


async def _fetch_data_value_sets(
    client: httpx.AsyncClient,
    data_elements: list[str],
    period: str,
    org_unit: str,
    children: bool = True,
) -> list[dict[str, Any]]:
    """Fetch raw data values for given data elements, period, and org unit."""
    params: list[tuple[str, str]] = [("period", period), ("orgUnit", org_unit)]
    for de in data_elements:
        params.append(("dataElement", de))
    if children:
        params.append(("children", "true"))

    url = f"{_base_url()}/api/dataValueSets.json"

    for attempt in range(3):
        try:
            resp = await client.get(
                url,
                params=params,
                headers={"Authorization": _auth_header(), "Accept": "application/json"},
                timeout=60.0,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("dataValues", [])
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            if attempt < 2:
                await asyncio.sleep(2 ** attempt)
                continue
            return []


async def _extract_from_raw(client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Fallback: extract data via dataValueSets API and aggregate locally.

    Fetches indicator definitions, queries raw data values per period,
    and computes indicator values (numerator/denominator for percentages).
    """
    dx_ids = [ind["id"] for ind in INDICATORS]
    periods = _resolve_relative_periods("LAST_12_MONTHS")
    exclude = _incomplete_periods()

    # Fetch all indicator definitions in parallel
    defs = await asyncio.gather(
        *[_fetch_indicator_definition(client, dx) for dx in dx_ids],
        return_exceptions=True,
    )

    # Collect all unique data elements
    all_des: set[str] = set()
    valid_defs: list[dict[str, Any]] = []
    for i, d in enumerate(defs):
        if isinstance(d, Exception):
            valid_defs.append({
                "id": dx_ids[i],
                "name": dx_ids[i],
                "numerator_des": [dx_ids[i]],
                "denominator_des": [],
                "denominator_is_constant": True,
                "denominator_value": 1,
            })
        else:
            valid_defs.append(d)
            all_des.update(d["numerator_des"])
            all_des.update(d["denominator_des"])

    all_de_list = list(all_des)
    root_ou = _root_ou()

    # Fetch raw data for all periods (batch concurrency = 4)
    rows: list[dict[str, Any]] = []
    CONCURRENCY = 4

    for i in range(0, len(periods), CONCURRENCY):
        batch = periods[i:i + CONCURRENCY]
        results = await asyncio.gather(
            *[_fetch_data_value_sets(client, all_de_list, pe, root_ou, children=True) for pe in batch],
            return_exceptions=True,
        )

        for pe_idx, dvs in enumerate(results):
            pe = batch[pe_idx]
            if pe in exclude:
                continue
            if isinstance(dvs, Exception):
                continue

            # Build: data_element -> org_unit -> value
            de_org_values: dict[str, dict[str, float]] = {}
            for dv in dvs:
                try:
                    val = float(dv.get("value", 0))
                except (ValueError, TypeError):
                    continue
                de_id = dv.get("dataElement", "")
                ou_id = dv.get("orgUnit", "")
                if de_id not in de_org_values:
                    de_org_values[de_id] = {}
                de_org_values[de_id][ou_id] = de_org_values[de_id].get(ou_id, 0) + val

            # Compute indicator values per org unit
            for d in valid_defs:
                num_des = d["numerator_des"]
                den_des = d["denominator_des"]

                # Sum numerator per org unit
                num_by_ou: dict[str, float] = {}
                for de_id in num_des:
                    for ou_id, val in de_org_values.get(de_id, {}).items():
                        num_by_ou[ou_id] = num_by_ou.get(ou_id, 0) + val

                if not num_by_ou:
                    continue

                # Sum denominator per org unit (if not constant)
                den_by_ou: dict[str, float] = {}
                if not d["denominator_is_constant"] and den_des:
                    for de_id in den_des:
                        for ou_id, val in de_org_values.get(de_id, {}).items():
                            den_by_ou[ou_id] = den_by_ou.get(ou_id, 0) + val

                # Compute values
                for ou_id, num_val in num_by_ou.items():
                    if not d["denominator_is_constant"]:
                        den_val = den_by_ou.get(ou_id, 0)
                        if den_val == 0:
                            continue
                        value = (num_val / den_val) * 100
                    elif d["denominator_value"] != 1:
                        value = num_val * d["denominator_value"]
                    else:
                        value = num_val

                    rows.append({
                        "indicator_id": d["id"],
                        "period": pe,
                        "value": round(value, 2),
                        "org_unit": ou_id,
                    })

    return rows


# ─── Extraction ────────────────────────────────────────────

RowSink = Callable[[str, list[dict[str, Any]]], Awaitable[None]]

# SNIS RDC falls over under parallel load; keep a small number of requests in flight.
CONCURRENCY = int(os.getenv("ETL_DHIS2_CONCURRENCY", "2"))
# Indicators per analytics request (the server times out on wide queries).
BATCH_SIZE = 3


def _rows_from_analytics(analytics: dict[str, Any], default_pe: str | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in analytics.get("rows", []):
        if len(row) >= 4:
            dx, pe, ou, raw_value = row[0], row[1], row[2], row[3]
        elif len(row) == 3 and default_pe:
            dx, ou, raw_value = row[0], row[1], row[2]
            pe = default_pe
        else:
            continue
        if not (dx and pe and ou):
            continue
        try:
            value = float(raw_value)
        except (ValueError, TypeError):
            continue
        rows.append({"indicator_id": dx, "period": pe, "value": value, "org_unit": ou})
    return rows


def _rows_from_co_analytics(analytics: dict[str, Any], keep_cocs: set[str]) -> list[dict[str, Any]]:
    """Rows of a `dimension=co` query ([dx, co, pe, ou, value]) as operands."""
    rows: list[dict[str, Any]] = []
    for row in analytics.get("rows", []):
        if len(row) < 5:
            continue
        dx, co, pe, ou, raw_value = row[0], row[1], row[2], row[3], row[4]
        if co not in keep_cocs:
            continue
        try:
            value = float(raw_value)
        except (ValueError, TypeError):
            continue
        rows.append({"indicator_id": f"{dx}.{co}", "period": pe, "value": value, "org_unit": ou})
    return rows


async def _gather(
    client: httpx.AsyncClient,
    requests: list[tuple[list[str], str, str | None, int | None]],
    extra: str = "",
    parse: Callable[[dict[str, Any], str, str | None], list[Any]] | None = None,
) -> list[Any]:
    """Run (dx_batch, period, ou, level) analytics requests with bounded
    concurrency. A failing request is logged and skipped: one slow province
    must not sink the whole run."""
    sem = asyncio.Semaphore(CONCURRENCY)

    async def one(dx: list[str], period: str, ou: str | None, level: int | None) -> list[Any]:
        async with sem:
            try:
                analytics = await fetch_analytics(client, dx, period, ou=ou, level=level, extra=extra)
            except Exception as exc:  # noqa: BLE001
                logger.warning("ETL dhis2: skipped dx=%s pe=%s ou=%s level=%s — %s", dx[:4], period[:27], ou, level, exc)
                return []
            if parse:
                return parse(analytics, period, ou)
            return _rows_from_analytics(analytics, default_pe=period if ";" not in period else None)

    results = await asyncio.gather(*[one(*r) for r in _windowed(requests)])
    return [row for rows in results for row in rows]


# SNIS RDC's front proxy drops any request running longer than ~90 s; a
# 24-month query never fits. Monthly periods are split into windows small
# enough to answer in time (6 months ≈ 70 s on a busy server).
PERIOD_WINDOW = int(os.getenv("ETL_PERIOD_WINDOW", "6"))


def _windowed(
    requests: list[tuple[list[str], str, str | None, int | None]],
) -> list[tuple[list[str], str, str | None, int | None]]:
    out: list[tuple[list[str], str, str | None, int | None]] = []
    for dx, period, ou, level in requests:
        months = period.split(";")
        if len(months) <= PERIOD_WINDOW:
            out.append((dx, period, ou, level))
            continue
        for i in range(0, len(months), PERIOD_WINDOW):
            out.append((dx, ";".join(months[i:i + PERIOD_WINDOW]), ou, level))
    return out


async def _gather_analytics(
    client: httpx.AsyncClient,
    requests: list[tuple[list[str], str, str | None, int | None]],
) -> list[dict[str, Any]]:
    return await _gather(client, requests)


def thematic_targets(scope: str, root: str, provinces: list[str]) -> list[tuple[str, int | None]]:
    """(org unit, level) targets of the thematic stage.

    National + provinces on every run. The zone level (26 provinces × 8
    requests, ~93 % of the stage's rows) only in the Sunday `weekly` run and
    in manual backfills, to keep the mid-week run short and spare SNIS RDC.
    Facility stock-out counts (stage 6) stay daily at every level.
    """
    targets: list[tuple[str, int | None]] = [(root, None), (root, 2)]
    if normalize_scope(scope) in ("weekly", "thematic", "history"):
        targets += [(prov, 3) for prov in provinces]
    return targets


def _batches(ids: list[str], size: int = BATCH_SIZE) -> list[list[str]]:
    return [ids[i:i + size] for i in range(0, len(ids), size)]


def count_stockouts(
    responses: list[tuple[str, str, dict[str, Any]]],
    root: str,
    zones_by_province: dict[str, list[str]],
    provinces: list[str],
) -> list[dict[str, Any]]:
    """Facility-level stock-out days → number of facilities in stock-out.

    Input: (province, periods, analytics) for each *successful* request of
    `dx = <DE>.<STOCKOUT_COC>;<DE>.<CMM_COC>` at `<province>;LEVEL-5` with
    `hierarchyMeta=true`. Each facility with > 0 days of stock-out in a month
    counts once per antigen (and once for "any antigen") at its zone,
    province and the root. Each facility with a consumption (CMM) or a
    stock-out for an antigen counts in `STOCKOUT_BASE.<DE>` (and
    `STOCKOUT_BASE.ANY`): the facilities managing it, denominator of the rate.

    DHIS2 does not return zeros, so a missing row would be ambiguous ("no
    facility in stock-out" vs "request failed"). Explicit 0 rows are written
    for every zone/province actually covered, and the national row only for
    periods where every province was covered — otherwise it would be an
    undercount presented as a national figure. Units without a row are
    therefore unknown, and the dashboard shows "—" for them.
    """
    indicators = [
        *(f"STOCKOUT_FOSA.{de}" for de in SIGL_VACCINES), STOCKOUT_ANY,
        *(f"STOCKOUT_BASE.{de}" for de in SIGL_VACCINES), STOCKOUT_BASE_ANY,
    ]
    per_key: dict[tuple[str, str, str], set[str]] = {}
    covered: dict[str, set[str]] = {}  # period -> provinces covered
    for province, periods, analytics in responses:
        for pe in periods.split(";"):
            covered.setdefault(pe, set()).add(province)
        hierarchy: dict[str, str] = analytics.get("metaData", {}).get("ouHierarchy", {}) or {}
        for row in analytics.get("rows", []):
            if len(row) < 4:
                continue
            dx, pe, fosa, raw = row[0], row[1], row[2], row[3]
            try:
                if float(raw) <= 0:
                    continue
            except (ValueError, TypeError):
                continue
            de, _, coc = dx.partition(".")
            path = [p for p in hierarchy.get(fosa, "").split("/") if p]
            # path = [root, province, zone, aire] (ancestors only)
            ancestors = {root, province}
            if len(path) >= 3:
                ancestors.add(path[2])
            keys = [f"STOCKOUT_BASE.{de}", STOCKOUT_BASE_ANY]
            if coc == STOCKOUT_COC:
                keys += [f"STOCKOUT_FOSA.{de}", STOCKOUT_ANY]
            for ou in ancestors:
                for ind in keys:
                    per_key.setdefault((ind, pe, ou), set()).add(fosa)

    complete_periods = {pe for pe, provs in covered.items() if set(provinces) <= provs}
    counts = {k: float(len(v)) for k, v in per_key.items() if k[2] != root or k[1] in complete_periods}
    for pe, provs in covered.items():
        units = [u for prov in provs for u in (prov, *zones_by_province.get(prov, []))]
        if pe in complete_periods:
            units.append(root)
        for ou in units:
            for ind in indicators:
                counts.setdefault((ind, pe, ou), 0.0)
    return [
        {"indicator_id": ind, "period": pe, "value": value, "org_unit": ou}
        for (ind, pe, ou), value in counts.items()
    ]


async def extract(
    client: httpx.AsyncClient | None = None,
    scope: str = "incremental",
    sink: RowSink | None = None,
) -> list[dict[str, Any]]:
    """Extract DHIS2 analytics as normalized rows {indicator_id, period, value, org_unit}.

    Stages (each handed to `sink` as soon as it completes, so a run killed
    midway still leaves the earlier stages in Supabase):
      1. national + provinces, monthly, scope periods          (incremental, weekly, history)
      2. zones de santé (level 3), monthly, per province       (incremental, weekly, history)
      3. annual aggregates of the indicators, national + prov. (annual)
      4. population / target data elements (annual)            (annual)
      5. thematic pages (SIGL stock, reporting rates, management,
         surveillance, cold chain): national + provinces daily,
         zones only in weekly / history / thematic          (incremental, weekly, history, thematic)
      6. facilities in stock-out (level 5 → zone/province/national) (same as 5)

    When the analytics API returns nothing at all for stage 1, falls back to
    the dataValueSets API and aggregates locally.
    """
    if not is_configured():
        raise RuntimeError("DHIS2 not configured (DHIS2_BASE_URL / DHIS2_USERNAME / DHIS2_PASSWORD)")

    own_client = client is None
    client = client or httpx.AsyncClient()
    all_rows: list[dict[str, Any]] = []

    async def emit(stage: str, rows: list[dict[str, Any]]) -> None:
        logger.info("ETL dhis2: stage %s → %d rows", stage, len(rows))
        all_rows.extend(rows)
        if sink and rows:
            await sink(stage, rows)

    try:
        dx_ids = [ind["id"] for ind in INDICATORS]
        pop_ids = [de["id"] for de in POPULATION_DATA_ELEMENTS]
        periods = scope_periods(scope)
        pe_param = ";".join(periods)
        years = scope_years(scope)
        root = _root_ou()

        scope = normalize_scope(scope)
        monthly = scope in ("incremental", "weekly", "history")
        thematic = scope in ("incremental", "weekly", "history", "thematic")
        annual = scope == "annual"
        provinces = await fetch_provinces(client)

        if monthly:
            # ─── 1. National + provinces (monthly) ─────────
            stage1 = await _gather_analytics(client, [
                *[(b, pe_param, root, None) for b in _batches(dx_ids)],
                *[(b, pe_param, root, 2) for b in _batches(dx_ids)],
            ])
            if not stage1:
                raw_rows = await _extract_from_raw(client)
                await emit("raw-fallback", raw_rows)
                return all_rows
            await emit("national+provinces", stage1)

            # ─── 2. Zones de santé, province by province ───
            stage2 = await _gather_analytics(client, [
                (b, pe_param, prov, 3) for prov in provinces for b in _batches(dx_ids)
            ])
            await emit("zones", stage2)

        if thematic:
            # ─── 5. Thematic pages ─────────────────────────
            extra_ids = [i["id"] for i in EXTRA_INDICATORS]
            sigl_des = list(SIGL_VACCINES)
            keep = set(SIGL_COCS)
            targets = thematic_targets(scope, root, provinces)
            stage5 = await _gather(client, [
                (b, pe_param, ou, lvl) for ou, lvl in targets for b in _batches(extra_ids, EXTRA_BATCH_SIZE)
            ])
            stage5 += await _gather(
                client,
                [(b, pe_param, ou, lvl) for ou, lvl in targets for b in _batches(sigl_des, SIGL_BATCH_SIZE)],
                extra="&dimension=co",
                parse=lambda a, _pe, _ou: _rows_from_co_analytics(a, keep),
            )
            await emit("thematic", stage5)

            # ─── 6. Facilities in stock-out (level 5) ──────
            stockout_dx = [f"{de}.{coc}" for de in sigl_des for coc in (STOCKOUT_COC, CMM_COC)]
            responses = await _gather(
                client,
                [(stockout_dx, pe_param, prov, 5) for prov in provinces],
                extra="&hierarchyMeta=true",
                parse=lambda a, pe, ou: [(ou, pe, a)],
            )
            zones_by_province = await fetch_zones_by_province(client)
            await emit("stockout-fosa", count_stockouts(responses, root, zones_by_province, provinces))

        if not annual:
            return all_rows

        # ─── 3. Annual aggregates (national + provinces) ───
        stage3 = await _gather_analytics(client, [
            (b, year, root, lvl) for year in years for lvl in (None, 2) for b in _batches(dx_ids)
        ])
        await emit("annual", stage3)

        # ─── 4. Population & targets (annual) ──────────────
        stage4 = await _gather_analytics(client, [
            *[(pop_ids, year, root, lvl) for year in years for lvl in (None, 2)],
            *[(pop_ids, year, prov, 3) for year in years for prov in provinces],
        ])
        await emit("population", stage4)

        return all_rows
    finally:
        if own_client:
            await client.aclose()
