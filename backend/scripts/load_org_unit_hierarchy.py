"""Load the complete DHIS2 org unit hierarchy into Supabase.

Fetches levels 1-4 (national → provinces → zones de santé → aires de santé)
from DHIS2 and upserts into dim_org_units with parent_id relationships.

After loading, calls Supabase functions to populate denormalized
province_id, zone_id, and path columns.

Usage:
    python -m scripts.load_org_unit_hierarchy              # levels 1-4
    python -m scripts.load_org_unit_hierarchy --max-level 3  # levels 1-3 only
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time

import httpx

sys.path.insert(0, ".")

from dotenv import load_dotenv
load_dotenv("../.env")

from app.etl.sources import dhis2 as dhis2_source
from app.etl import loaders

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("hierarchy")


async def main(max_level: int):
    log.info("=" * 70)
    log.info(f"Loading DHIS2 org unit hierarchy (levels 1-{max_level})")
    log.info("=" * 70)

    start = time.time()

    async with httpx.AsyncClient(timeout=180) as client:
        units = await dhis2_source.fetch_org_unit_tree(client, max_level=max_level)

    log.info(f"Fetched {len(units)} org units from DHIS2")

    # Load into Supabase
    loaded = loaders.load_org_unit_hierarchy(units)
    log.info(f"Loaded {loaded} org units into dim_org_units")

    # Populate denormalized columns via Supabase RPC
    from app.core.config import settings
    from supabase import create_client
    sb = create_client(settings.supabase_url, settings.supabase_service_key)

    log.info("Populating province_id / zone_id denormalized columns...")
    try:
        result = sb.rpc("populate_hierarchy_ids", {}).execute()
        log.info(f"  Updated: {result.data}")
    except Exception as e:
        log.warning(f"  populate_hierarchy_ids failed: {str(e)[:100]}")

    log.info("Populating path column...")
    try:
        result = sb.rpc("populate_org_unit_paths", {}).execute()
        log.info(f"  Updated: {result.data}")
    except Exception as e:
        log.warning(f"  populate_org_unit_paths failed: {str(e)[:100]}")

    # Verify
    for level in range(1, max_level + 1):
        r = sb.table("dim_org_units").select("*", count="exact").eq("level", level).limit(1).execute()
        log.info(f"  Level {level}: {r.count} org units")

    elapsed = time.time() - start
    log.info(f"\nDone in {elapsed:.0f}s — {loaded} org units loaded")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load DHIS2 org unit hierarchy")
    parser.add_argument("--max-level", type=int, default=4,
                        help="Max level to load (default 4 = aires de santé)")
    args = parser.parse_args()
    asyncio.run(main(args.max_level))
