// GET /api/matching-runs — list past matching runs (admin).
import { admin } from "../lib/supabase";
import { requireStaff } from "../lib/auth";
import { json, fail } from "../lib/http";

export default async (req: Request): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);
  const { data, error } = await admin()
    .from("matching_runs")
    .select("*")
    .order("created_at", { ascending: false });
  return error ? fail(error.message, 500) : json(data);
};
