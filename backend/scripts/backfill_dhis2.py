"""Backfill DHIS2 historical data into Supabase.

Processes 1 indicator × 1 year at a time to avoid SNIS RDC timeouts.
Fetches both national (root OU) and province (LEVEL-2) data.
Transforms and loads into fact_indicator_values via the existing ETL pipeline.

Usage:
    python -m scripts.backfill_dhis2                    # all indicators, 2020-2026
    python -m scripts.backfill_dhis2 --start 2022       # 2022-2026
    python -m scripts.backfill_dhis2 --indicators v9b9aYsA5PM,k26tJ22Ncpd
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from typing import Any

import httpx

sys.path.insert(0, ".")

from dotenv import load_dotenv
load_dotenv("../.env")

from app.etl.sources import dhis2 as dhis2_source
from app.etl import transforms, loaders

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("backfill")

INDICATORS = dhis2_source.INDICATORS
ROOT_OU = dhis2_source._root_ou()


async def fetch_one(
    client: httpx.AsyncClient,
    dx_id: str,
    periods: list[str],
    level: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch one indicator for a set of periods at a given level."""
    pe_param = ";".join(periods)
    try:
        result = await dhis2_source.fetch_analytics(
            client, [dx_id], pe_param, level=level
        )
        rows = result.get("rows", [])
        out = []
        for row in rows:
            dx, pe, ou, raw_value = row[0], row[1], row[2], row[3]
            try:
                value = float(raw_value)
            except (ValueError, TypeError):
                continue
            out.append({
                "indicator_id": dx,
                "period": pe,
                "value": value,
                "org_unit": ou or ROOT_OU,
            })
        return out
    except Exception as e:
        log.warning(f"  Fetch failed (level={level}): {str(e)[:80]}")
        return []


async def backfill_indicator_year(
    client: httpx.AsyncClient,
    dx_id: str,
    label: str,
    year: str,
) -> int:
    """Backfill one indicator for one year. Returns rows loaded."""
    periods = [f"{year}{m:02d}" for m in range(1, 13)]

    # National level
    national_rows = await fetch_one(client, dx_id, periods, level=None)

    # Province level
    province_rows = await fetch_one(client, dx_id, periods, level=2)

    all_rows = national_rows + province_rows

    if not all_rows:
        log.info(f"  {label} [{year}]: 0 rows (no data)")
        return 0

    # Transform
    transformed = transforms.transform(all_rows, source="dhis2")

    # Fetch org unit names for any new OUs
    ou_ids = list({r.get("org_unit", "") for r in all_rows if r.get("org_unit")})
    org_unit_meta = await dhis2_source.fetch_org_unit_names(client, ou_ids)

    # Load
    loaded = loaders.load(transformed, org_unit_meta=org_unit_meta)

    log.info(
        f"  {label} [{year}]: {len(all_rows)} fetched → {loaded} loaded "
        f"(national={len(national_rows)}, provinces={len(province_rows)})"
    )
    return loaded


async def main(start_year: str, end_year: str, indicator_filter: list[str] | None):
    indicators = INDICATORS
    if indicator_filter:
        indicators = [i for i in INDICATORS if i["id"] in indicator_filter]
        if not indicators:
            log.error(f"No indicators matched filter: {indicator_filter}")
            return

    years = [str(y) for y in range(int(start_year), int(end_year) + 1)]

    log.info("=" * 70)
    log.info(f"Backfill DHIS2 → Supabase")
    log.info(f"  Indicators: {len(indicators)}")
    log.info(f"  Years: {years[0]} → {years[-1]} ({len(years)} years)")
    log.info(f"  Total batches: {len(indicators) * len(years)}")
    log.info("=" * 70)

    total_loaded = 0
    total_errors = 0
    start_time = time.time()

    async with httpx.AsyncClient(timeout=120) as client:
        for year in years:
            year_loaded = 0
            log.info(f"\n{'─' * 50}")
            log.info(f"Année {year}")
            log.info(f"{'─' * 50}")

            for ind in indicators:
                dx_id = ind["id"]
                label = ind["label"]

                try:
                    loaded = await backfill_indicator_year(
                        client, dx_id, label, year
                    )
                    year_loaded += loaded
                except Exception as e:
                    log.error(f"  {label} [{year}]: ERROR — {str(e)[:100]}")
                    total_errors += 1

                # Small pause between indicators to be gentle on the server
                await asyncio.sleep(1)

            total_loaded += year_loaded
            log.info(f"  → Total {year}: {year_loaded} rows loaded")

    elapsed = time.time() - start_time
    log.info("\n" + "=" * 70)
    log.info(f"Backfill terminé en {elapsed:.0f}s")
    log.info(f"  Total rows loaded: {total_loaded}")
    log.info(f"  Total errors: {total_errors}")
    log.info("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill DHIS2 historical data")
    parser.add_argument("--start", default="2020", help="Start year (default 2020)")
    parser.add_argument("--end", default="2026", help="End year (default 2026)")
    parser.add_argument("--indicators", default=None,
                        help="Comma-separated indicator IDs (default: all)")
    args = parser.parse_args()

    ind_filter = args.indicators.split(",") if args.indicators else None

    asyncio.run(main(args.start, args.end, ind_filter))
