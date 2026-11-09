"""ETL entry point for out-of-process execution.

Runs one sync and exits, so the pipeline can be scheduled by the platform
(Container App Job with a cron trigger, Kubernetes CronJob, or plain cron)
instead of by an APScheduler thread living inside the web service. That is what
makes the sync fire exactly once regardless of how many web replicas run.

    python -m app.etl.cli --scope incremental   # Wednesday
    python -m app.etl.cli --scope weekly        # Sunday
    python -m app.etl.cli --scope annual        # 1st of the month
    ETL_MONTHS=6 ETL_MONTHS_OFFSET=3 python -m app.etl.cli --scope history

Exit code is 0 on success, 1 on failure, so the job runner can retry and alert.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

# Mirror main.py: the job runs without the FastAPI app, so it loads its own env.
_env_root = Path(__file__).resolve().parents[3] / ".env.local"
if _env_root.exists():
    load_dotenv(_env_root)
_env_backend = Path(__file__).resolve().parents[2] / ".env"
if _env_backend.exists():
    load_dotenv(_env_backend)

from app.etl.pipeline import run_dhis2_sync  # noqa: E402
from app.tools.dhis2 import close_client  # noqa: E402
from app.core.cache import close_cache  # noqa: E402


async def _main(scope: str) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )
    logger = logging.getLogger("etl.cli")
    logger.info("ETL sync starting (scope=%s)", scope)

    try:
        result = await run_dhis2_sync(scope=scope)
    finally:
        await close_client()
        await close_cache()

    if result.get("status") == "success":
        logger.info("ETL sync succeeded — %d rows loaded", result.get("rows_loaded", 0))
        return 0
    if result.get("status") == "skipped":
        logger.warning("ETL sync skipped — %s", result.get("error"))
        return 0

    logger.error("ETL sync failed — %s", result.get("error"))
    return 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the DHIS2 ETL sync once and exit.")
    parser.add_argument(
        "--scope",
        choices=["incremental", "weekly", "full", "annual", "history", "thematic"],
        default="incremental",
        help=(
            "incremental = Wednesday, 3 last complete months (thematic pages without zones); "
            "weekly = Sunday, same window incl. thematic zones ('full' is an alias); "
            "annual = monthly, yearly aggregates + population; "
            "history = manual backfill of older months (ETL_MONTHS, ETL_MONTHS_OFFSET); "
            "thematic = manual, thematic pages only"
        ),
    )
    args = parser.parse_args()
    sys.exit(asyncio.run(_main(args.scope)))


if __name__ == "__main__":
    main()
