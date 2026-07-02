"""Celery application instance and beat schedule."""

from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "phosboucraa",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.tasks.cv_analysis",
        "app.tasks.matching_tasks",
        "app.tasks.notifications",
        "app.tasks.rag_ingestion",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Africa/Casablanca",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,  # hard limit: 10 min per task
    task_soft_time_limit=540,
    worker_max_tasks_per_child=50,
)

# Periodic jobs (Celery beat).
celery_app.conf.beat_schedule = {
    # Re-run the global assignment optimisation every night at 02:00.
    "nightly-auto-matching": {
        "task": "app.tasks.matching_tasks.run_global_matching",
        "schedule": crontab(hour=2, minute=0),
        "kwargs": {"persist": True},
    },
}
