"""APScheduler integration — runs the DHIS2 ETL twice a week.

Wednesday 03:00 UTC: incremental (last 3 complete months).
Sunday 04:00 UTC: weekly (same window, incl. thematic zones).
1st of the month 08:00 UTC: annual (yearly aggregates + population).

The scheduler is started in the FastAPI lifespan and stopped on shutdown.
It can also be triggered manually via POST /api/etl/sync.

⚠️ In-process scheduling only holds for a single replica. With N replicas, N
schedulers fire the same sync at 03:00 and multiply the load on an SNIS RDC
instance whose instability is the reason the ETL exists in the first place.
Set ETL_SCHEDULER_ENABLED=false on the web service and run the sync from a
dedicated cron job instead:

    python -m app.etl.cli --scope incremental

which is exactly what the Container App Job / Kubernetes CronJob invokes.
"""

import logging
import os
from datetime import datetime

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.etl.pipeline import run_dhis2_sync

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def scheduler_enabled() -> bool:
    """In-process scheduling is opt-out, so existing single-replica
    deployments keep working unchanged."""
    return os.getenv("ETL_SCHEDULER_ENABLED", "true").strip().lower() not in (
        "false", "0", "no", "off",
    )


def _scheduled_sync(scope: str = "incremental"):
    """Sync callback (runs in a thread — APScheduler handles async)."""
    import asyncio
    logger.info("Scheduled ETL sync (%s) starting at %s", scope, datetime.utcnow().isoformat())
    asyncio.run(run_dhis2_sync(scope=scope))


def start_scheduler():
    """Register and start the ETL scheduler."""
    if not scheduler_enabled():
        logger.info(
            "ETL scheduler disabled (ETL_SCHEDULER_ENABLED=false) — "
            "the sync is expected to run as an external cron job"
        )
        return

    if scheduler.running:
        return

    # Same rhythm as the Container App Jobs / CronJobs.
    scheduler.add_job(
        _scheduled_sync,
        CronTrigger(day_of_week="wed", hour=3, minute=0),
        args=["incremental"],
        id="dhis2_incremental_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _scheduled_sync,
        CronTrigger(day_of_week="sun", hour=4, minute=0),
        args=["weekly"],
        id="dhis2_weekly_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.add_job(
        _scheduled_sync,
        CronTrigger(day=1, hour=8, minute=0),
        args=["annual"],
        id="dhis2_annual_sync",
        replace_existing=True,
        misfire_grace_time=3600,
    )

    scheduler.start()
    logger.info("ETL scheduler started — incremental Wed 03:00, weekly Sun 04:00, annual 1st 08:00 UTC")


def stop_scheduler():
    """Gracefully stop the scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("ETL scheduler stopped")
