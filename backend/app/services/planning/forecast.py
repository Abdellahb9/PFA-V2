"""Predictive capacity planning with XGBoost.

Trains a gradient-boosted regressor on monthly application history (lag +
seasonality + capacity features) to forecast next-month internship demand per
department, and proposes a slot allocation toward a target applicants-per-slot
ratio. Advisory only — department ``capacity`` / offer ``slots`` stay manual.

Cold start: with too little history XGBoost overfits, so the service degrades to
a weighted moving-average fallback and flags it. The SQLAlchemy/model imports are
done lazily inside :func:`forecast_departments` so the pure forecasting helpers
(and their tests) don't require the full backend stack.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pandas as pd

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

MONTHS = 12
TARGET_PRESSURE = 4  # desired applicants per opened slot
COLD_START_MIN = 5  # min applications (12m) before we forecast a department
MIN_TRAIN_ROWS = 12  # min (dept, month) samples before XGBoost is trained
FEATURES = ["lag1", "lag2", "lag3", "roll3", "month", "capacity"]


# --------------------------------------------------------------------------- #
# Pure helpers (no DB / no heavy deps beyond pandas) — unit-tested directly.
# --------------------------------------------------------------------------- #
def month_keys(count: int, *, now: datetime | None = None) -> list[str]:
    """The last ``count`` month keys ("YYYY-MM"), oldest first, ending this month."""
    now = now or datetime.now(UTC)
    base = now.year * 12 + (now.month - 1)
    return [f"{(base - i) // 12:04d}-{((base - i) % 12) + 1:02d}" for i in range(count - 1, -1, -1)]


def fallback_forecast(demand: list[int]) -> int:
    """Weighted moving average of the last 3 months + a dampened linear trend."""
    n = len(demand)
    if n == 0:
        return 0
    if n == 1:
        return demand[0]
    recent = demand[-3:]
    weights = [0.2, 0.3, 0.5] if len(recent) == 3 else [0.4, 0.6]
    wavg = sum(v * w for v, w in zip(recent, weights, strict=False))
    slope = (recent[-1] - recent[0]) / max(1, len(recent) - 1)
    return max(0, round(wavg + slope * 0.5))


def build_training_frame(
    series: dict[int, dict[str, int]], caps: dict[int, int], months: list[str]
) -> pd.DataFrame:
    """One supervised row per (department, month) with lag + seasonality features."""
    records: list[dict] = []
    for dept_id, monthmap in series.items():
        demand = [monthmap.get(k, 0) for k in months]
        cap = caps.get(dept_id, 0)
        for t in range(3, len(demand)):
            records.append(
                {
                    "lag1": demand[t - 1],
                    "lag2": demand[t - 2],
                    "lag3": demand[t - 3],
                    "roll3": (demand[t - 1] + demand[t - 2] + demand[t - 3]) / 3,
                    "month": int(months[t].split("-")[1]),
                    "capacity": cap,
                    "target": demand[t],
                }
            )
    return pd.DataFrame.from_records(records, columns=[*FEATURES, "target"])


def train_model(frame: pd.DataFrame):
    """Fit a small XGBoost regressor (import is lazy so tests can skip it)."""
    import xgboost as xgb

    model = xgb.XGBRegressor(
        n_estimators=80,
        max_depth=3,
        learning_rate=0.1,
        subsample=0.9,
        random_state=42,
        objective="reg:squarederror",
    )
    model.fit(frame[FEATURES], frame["target"])
    return model


def predict_next(model, series, caps, months) -> dict[int, int]:
    """Forecast next month's demand per department with the trained model."""
    next_month = (int(months[-1].split("-")[1]) % 12) + 1
    out: dict[int, int] = {}
    for dept_id, monthmap in series.items():
        demand = [monthmap.get(k, 0) for k in months]
        feat = pd.DataFrame(
            [
                {
                    "lag1": demand[-1],
                    "lag2": demand[-2],
                    "lag3": demand[-3],
                    "roll3": (demand[-1] + demand[-2] + demand[-3]) / 3,
                    "month": next_month,
                    "capacity": caps.get(dept_id, 0),
                }
            ]
        )[FEATURES]
        out[dept_id] = max(0, round(float(model.predict(feat)[0])))
    return out


def recommend_slots(forecast: int, capacity: int) -> int:
    """Slots to open to keep ~TARGET_PRESSURE applicants per slot, within capacity."""
    cap = capacity if capacity and capacity > 0 else 999
    return min(cap, max(1, round(forecast / TARGET_PRESSURE)))


# --------------------------------------------------------------------------- #
# Orchestrator (DB-backed).
# --------------------------------------------------------------------------- #
def forecast_departments(db: Session) -> dict:
    """Load history, train/predict (or fall back), and assemble the response."""
    from sqlalchemy import select

    from app.models.application import Application
    from app.models.department import Department
    from app.models.offer import InternshipOffer, OfferStatus

    months = month_keys(MONTHS)
    oldest = f"{months[0]}-01"

    # Monthly application counts per department (bucketed in Python).
    rows = db.execute(
        select(InternshipOffer.department_id, Application.created_at)
        .join(InternshipOffer, Application.offer_id == InternshipOffer.id)
        .where(Application.created_at >= oldest)
    ).all()
    series: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for dept_id, created in rows:
        if created is None:
            continue
        series[dept_id][created.strftime("%Y-%m")] += 1

    # Current open slots per department.
    slot_rows = db.execute(
        select(InternshipOffer.department_id, InternshipOffer.slots).where(
            InternshipOffer.status == OfferStatus.OPEN
        )
    ).all()
    current_slots: dict[int, int] = defaultdict(int)
    for dept_id, slots in slot_rows:
        current_slots[dept_id] += slots or 0

    departments = db.execute(select(Department.id, Department.name, Department.capacity)).all()
    caps = {d.id: d.capacity for d in departments}

    # Train XGBoost when we have enough samples, else fall back gracefully.
    frame = build_training_frame(dict(series), caps, months)
    use_xgb = len(frame) >= MIN_TRAIN_ROWS
    preds: dict[int, int] = {}
    model_name = "fallback"
    if use_xgb:
        try:
            model = train_model(frame)
            preds = predict_next(model, dict(series), caps, months)
            model_name = "xgboost"
        except Exception as exc:  # pragma: no cover - xgboost runtime issue
            logger.warning("XGBoost forecast failed (%s); using fallback", exc)
            use_xgb = False

    out_departments = []
    for d in departments:
        monthmap = series.get(d.id, {})
        monthly = [monthmap.get(k, 0) for k in months]
        total = sum(monthly)
        cold = total < COLD_START_MIN
        slots = current_slots.get(d.id, 0)

        if cold:
            forecast = 0
            recommended = slots
        else:
            forecast = preds.get(d.id) if use_xgb else fallback_forecast(monthly)
            recommended = recommend_slots(forecast, d.capacity)

        out_departments.append(
            {
                "department_id": d.id,
                "department": d.name,
                "capacity": d.capacity,
                "current_slots": slots,
                "total_applications_12m": total,
                "monthly": monthly,
                "forecast_demand": forecast,
                "recommended_slots": recommended,
                "cold_start": cold,
            }
        )

    out_departments.sort(key=lambda r: r["forecast_demand"], reverse=True)
    return {
        "model": model_name,
        "target_pressure": TARGET_PRESSURE,
        "cold_start_global": (
            all(r["cold_start"] for r in out_departments) if out_departments else True
        ),
        "departments": out_departments,
    }
