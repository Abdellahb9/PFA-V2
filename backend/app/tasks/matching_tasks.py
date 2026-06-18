"""Celery task: run the global Hungarian assignment optimisation."""
from __future__ import annotations

import logging

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.services.matching.service import run_matching

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.matching_tasks.run_global_matching")
def run_global_matching(
    weights: dict | None = None,
    persist: bool = True,
    min_score: float = 0.0,
    triggered_by: str | None = "scheduler",
) -> dict:
    """Run (and optionally persist) the global assignment optimisation."""
    db = SessionLocal()
    try:
        result = run_matching(
            db,
            weights=weights,
            persist=persist,
            min_score=min_score,
            triggered_by=triggered_by,
        )
        logger.info(
            "Matching run complete: %s assignments, avg score %.3f",
            result["assignments_count"],
            result["average_score"],
        )
        return {
            "matching_run_id": result["matching_run_id"],
            "assignments_count": result["assignments_count"],
            "average_score": result["average_score"],
        }
    finally:
        db.close()
