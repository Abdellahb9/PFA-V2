import { describe, it, expect } from "vitest";
import { forecastDemand } from "./capacity-forecast";

describe("forecastDemand", () => {
  it("handles empty and single-point series", () => {
    expect(forecastDemand([])).toBe(0);
    expect(forecastDemand([7])).toBe(7);
  });

  it("weights recent months and follows an upward trend", () => {
    expect(forecastDemand([2, 4, 6, 8, 10])).toBeGreaterThanOrEqual(8);
  });

  it("never returns a negative forecast on a falling series", () => {
    expect(forecastDemand([10, 5, 0, 0])).toBeGreaterThanOrEqual(0);
  });

  it("keeps a stable series near its level", () => {
    expect(forecastDemand([5, 5, 5, 5])).toBe(5);
  });
});
