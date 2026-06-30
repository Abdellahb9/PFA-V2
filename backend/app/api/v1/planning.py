"""Predictive capacity-planning endpoint (admin): XGBoost demand forecast."""
from __future__ import annotations

from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.services.planning.forecast import forecast_departments

router = APIRouter(tags=["planning"])


# Two paths to the same handler: /planning/forecast (grouped) and
# /capacity-forecast (so the shared frontend hook works against this backend too).
@router.get("/planning/forecast")
@router.get("/capacity-forecast")
def get_capacity_forecast(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Forecast internship demand and suggest slot allocation per department.

    Advisory only — capacity/slots stay manual; the result is not wired into the
    Hungarian assignment run.
    """
    return forecast_departments(db)
