"""Unit tests for the capacity-planning forecaster (no DB)."""
from __future__ import annotations

import pytest

from app.services.planning.forecast import (
    FEATURES,
    build_training_frame,
    fallback_forecast,
    month_keys,
    recommend_slots,
)


def test_fallback_forecast():
    assert fallback_forecast([]) == 0
    assert fallback_forecast([7]) == 7
    assert fallback_forecast([5, 5, 5, 5]) == 5
    assert fallback_forecast([2, 4, 6, 8, 10]) >= 8       # rising trend
    assert fallback_forecast([10, 5, 0, 0]) >= 0          # never negative


def test_month_keys_shape():
    keys = month_keys(12)
    assert len(keys) == 12
    assert all(len(k) == 7 and k[4] == "-" for k in keys)
    assert keys == sorted(keys)  # oldest first


def test_recommend_slots_targets_pressure_and_capacity():
    # 4 applicants per slot target -> 20 demand => 5 slots, capped at capacity.
    assert recommend_slots(20, 10) == 5
    assert recommend_slots(20, 3) == 3      # capped by capacity
    assert recommend_slots(0, 10) == 1      # at least one


def test_build_training_frame_shape():
    months = [f"2024-{m:02d}" for m in range(1, 13)]
    series = {1: {months[i]: i + 1 for i in range(12)}, 2: {m: 5 for m in months}}
    frame = build_training_frame(series, {1: 10, 2: 8}, months)
    # 12 months -> 9 supervised rows (t in 3..11) per department.
    assert len(frame) == 2 * 9
    assert set(FEATURES + ["target"]).issubset(set(frame.columns))


def test_xgboost_trains_and_predicts():
    pytest.importorskip("xgboost")
    from app.services.planning.forecast import predict_next, train_model

    months = [f"2024-{m:02d}" for m in range(1, 13)]
    series = {1: {months[i]: i + 1 for i in range(12)}, 2: {m: 5 for m in months}}
    caps = {1: 10, 2: 10}
    frame = build_training_frame(series, caps, months)

    model = train_model(frame)
    preds = predict_next(model, series, caps, months)

    assert set(preds) == {1, 2}
    assert all(v >= 0 for v in preds.values())
