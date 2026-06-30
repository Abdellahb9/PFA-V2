// GET /api/capacity-forecast — per-department internship-demand forecast + a
// suggested slot allocation. Inference runs a REAL XGBoost model (trained
// offline by scripts/train_forecast.py, exported to JSON) in pure TS — so
// XGBoost itself never ships in the serverless function. Falls back to a
// weighted moving average if the model can't be evaluated. The model PROPOSES;
// capacity/slots stay manual. Degrades gracefully (cold_start) on thin history.
import { requireStaff } from "./_shared/auth";
import { admin } from "./_shared/supabase";
import { json, fail } from "./_shared/http";
import { predictXGB, type XGBModel } from "./_shared/xgb-predict";
import forecastModelJson from "./_shared/forecast_model.json";

const MODEL = forecastModelJson as unknown as XGBModel;

export const config = { path: "/api/capacity-forecast" };

// Target healthy ratio of applicants per opened slot (configurable).
const TARGET_PRESSURE = Number(process.env.CAPACITY_TARGET_PRESSURE ?? 4);
// Below this many historical applications a department is "cold start".
const COLD_START_MIN = Number(process.env.CAPACITY_COLD_START_MIN ?? 5);
const MONTHS = 12;

/** Weighted moving average of the last 3 months + a dampened linear trend. */
export function forecastDemand(monthly: number[]): number {
  const n = monthly.length;
  if (n === 0) return 0;
  if (n === 1) return monthly[0];
  const recent = monthly.slice(-3);
  const weights = recent.length === 3 ? [0.2, 0.3, 0.5] : [0.4, 0.6];
  const wavg = recent.reduce((s, v, i) => s + v * weights[i], 0);
  const slope = (recent[recent.length - 1] - recent[0]) / Math.max(1, recent.length - 1);
  return Math.max(0, Math.round(wavg + slope * 0.5));
}

function lastMonthKeys(count: number): string[] {
  const keys: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = count - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export default async (req: Request): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);

  const sb = admin();
  const since = new Date();
  since.setMonth(since.getMonth() - MONTHS);

  const [{ data: departments }, { data: openOffers }, { data: apps }] = await Promise.all([
    sb.from("departments").select("id, name, capacity"),
    sb.from("offers").select("department_id, slots").eq("status", "open"),
    sb
      .from("applications")
      .select("created_at, offer:offers(department_id)")
      .gte("created_at", since.toISOString()),
  ]);

  // Current open slots per department.
  const slotsByDept = new Map<number, number>();
  for (const o of openOffers ?? []) {
    slotsByDept.set(o.department_id, (slotsByDept.get(o.department_id) ?? 0) + (o.slots ?? 0));
  }

  // Monthly application counts per department.
  const months = lastMonthKeys(MONTHS);
  const series = new Map<number, Map<string, number>>();
  for (const a of apps ?? []) {
    const deptId = (a as { offer?: { department_id?: number } | null }).offer?.department_id;
    if (!deptId || !a.created_at) continue; // skip general (no offer) applications
    const key = String(a.created_at).slice(0, 7);
    if (!series.has(deptId)) series.set(deptId, new Map());
    const m = series.get(deptId)!;
    m.set(key, (m.get(key) ?? 0) + 1);
  }

  // Next calendar month (1..12) for the seasonality feature.
  const nextMonth = (Number(months[months.length - 1].split("-")[1]) % 12) + 1;
  let usedFallback = false;

  // XGBoost inference for one department; falls back to the moving average.
  const predictDept = (monthly: number[], capacity: number): number => {
    const n = monthly.length;
    const [l1, l2, l3] = [monthly[n - 1], monthly[n - 2], monthly[n - 3]];
    try {
      // Feature order must match scripts/train_forecast.py.
      const x = [l1, l2, l3, (l1 + l2 + l3) / 3, nextMonth, capacity];
      return Math.max(0, Math.round(predictXGB(MODEL, x)));
    } catch {
      usedFallback = true;
      return forecastDemand(monthly);
    }
  };

  const rows = (departments ?? []).map((d) => {
    const monthMap = series.get(d.id) ?? new Map<string, number>();
    const monthly = months.map((k) => monthMap.get(k) ?? 0);
    const total = monthly.reduce((s, v) => s + v, 0);
    const currentSlots = slotsByDept.get(d.id) ?? 0;
    const coldStart = total < COLD_START_MIN;

    const forecast = coldStart ? 0 : predictDept(monthly, d.capacity ?? 0);
    const recommended = coldStart
      ? currentSlots // not enough history → suggest no change
      : Math.min(d.capacity ?? 999, Math.max(1, Math.round(forecast / TARGET_PRESSURE)));

    return {
      department_id: d.id,
      department: d.name,
      capacity: d.capacity ?? 0,
      current_slots: currentSlots,
      total_applications_12m: total,
      monthly,
      forecast_demand: forecast,
      recommended_slots: recommended,
      cold_start: coldStart,
    };
  });

  return json({
    model: usedFallback ? "heuristic" : "xgboost",
    target_pressure: TARGET_PRESSURE,
    cold_start_global: rows.every((r) => r.cold_start),
    departments: rows.sort((a, b) => b.forecast_demand - a.forecast_demand),
  });
};
