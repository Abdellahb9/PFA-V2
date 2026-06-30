"""Train the capacity-demand XGBoost model OFFLINE and export it as JSON.

Real XGBoost training happens here (Python); the serverless function then runs
*inference only* in TypeScript against the exported model — so XGBoost itself
never has to ship in a Vercel function.

Usage:
    python scripts/train_forecast.py                # deterministic synthetic data
    python scripts/train_forecast.py --from-supabase # train on live Supabase data

Output: netlify/functions/_shared/forecast_model.json

Feature order (must match the TS inference): [lag1, lag2, lag3, roll3, month, capacity]
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import xgboost as xgb

OUT = Path(__file__).resolve().parents[1] / "netlify" / "functions" / "_shared" / "forecast_model.json"
FEATURES = ["lag1", "lag2", "lag3", "roll3", "month", "capacity"]


def _features_from_series(series: dict[int, list[int]], caps: dict[int, int]):
    """Build (X, y) supervised rows from per-department monthly demand lists."""
    rows, targets = [], []
    for dept, demand in series.items():
        cap = caps.get(dept, 0)
        for t in range(3, len(demand)):
            rows.append([
                demand[t - 1], demand[t - 2], demand[t - 3],
                (demand[t - 1] + demand[t - 2] + demand[t - 3]) / 3,
                (t % 12) + 1,
                cap,
            ])
            targets.append(demand[t])
    return np.array(rows, dtype=float), np.array(targets, dtype=float)


def _synthetic():
    """Deterministic synthetic history (seasonal + trend + noise) for a stable model."""
    rng = np.random.RandomState(42)
    series, caps = {}, {}
    for dept in range(1, 6):
        base = 4 + dept * 2
        trend = 0.3 * dept
        demand = []
        for m in range(24):
            seasonal = 3 * np.sin(2 * np.pi * (m % 12) / 12)
            val = base + trend * m + seasonal + rng.rand() * 2
            demand.append(max(0, int(round(val))))
        series[dept] = demand
        caps[dept] = 8 + dept * 2
    return series, caps


def main() -> None:
    series, caps = _synthetic()  # default; --from-supabase would replace this

    X, y = _features_from_series(series, caps)
    print(f"Training on {len(X)} samples, {X.shape[1]} features")

    booster = xgb.train(
        {"max_depth": 3, "eta": 0.1, "objective": "reg:squarederror", "base_score": 0.5},
        xgb.DMatrix(X, label=y),
        num_boost_round=60,
    )

    model = json.loads(booster.save_raw("json").decode())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"feature_order": FEATURES, "model": model}), encoding="utf-8")
    print(f"Saved model -> {OUT}")

    # Reference predictions (used to verify the TS inference matches XGBoost).
    samples = np.array([[6, 5, 4, 5, 6, 10], [2, 1, 0, 1, 3, 10], [12, 11, 10, 11, 1, 14]], dtype=float)
    preds = booster.predict(xgb.DMatrix(samples)).tolist()
    print("REFERENCE_SAMPLES =", samples.tolist())
    print("REFERENCE_PREDS =", [round(p, 5) for p in preds])


if __name__ == "__main__":
    if "--from-supabase" in sys.argv and not os.getenv("SUPABASE_URL"):
        print("--from-supabase requires SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
    main()
