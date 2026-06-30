import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { predictXGB, type XGBModel } from "./xgb-predict";

const model: XGBModel = JSON.parse(
  readFileSync(new URL("./forecast_model.json", import.meta.url), "utf-8"),
);

// Reference predictions from XGBoost itself (scripts/train_forecast.py output).
const CASES: Array<[number[], number]> = [
  [[6, 5, 4, 5, 6, 10], 8.05453],
  [[2, 1, 0, 1, 3, 10], 8.63638],
  [[12, 11, 10, 11, 1, 14], 13.19331],
];

describe("predictXGB matches the trained XGBoost model", () => {
  it.each(CASES)("predicts %j ≈ %f", (x, expected) => {
    expect(predictXGB(model, x)).toBeCloseTo(expected, 3);
  });

  it("uses the expected feature order", () => {
    expect(model.feature_order).toEqual(["lag1", "lag2", "lag3", "roll3", "month", "capacity"]);
  });
});
