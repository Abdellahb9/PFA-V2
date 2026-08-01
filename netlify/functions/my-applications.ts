// GET /api/my-applications — the signed-in candidate's own applications + the
// status timeline. Strictly scoped to the caller (never exposes others' data
// or internal scores).
import { admin } from "./_shared/supabase";
import { requireUser } from "./_shared/auth";
import { json, fail } from "./_shared/http";

export const config = { path: "/api/my-applications" };

const SELECT =
  "id, status, created_at, start_date, end_date, duration_months, " +
  "offer:internship_offers(title, department:departments(name)), " +
  "application_events(status, note, created_at)";

function serialize(a: any) {
  const events = [...(a.application_events ?? [])].sort(
    (x: any, y: any) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime(),
  );
  return {
    id: a.id,
    status: a.status,
    created_at: a.created_at,
    offer_title: a.offer?.title ?? null,
    department_name: a.offer?.department?.name ?? null,
    start_date: a.start_date ?? null,
    end_date: a.end_date ?? null,
    duration_months: a.duration_months ?? null,
    events: events.map((e: any) => ({ status: e.status, note: e.note, created_at: e.created_at })),
  };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const sb = admin();

  // Candidate rows belonging to this account (by link or by email).
  const filters = [`user_id.eq.${user.id}`];
  if (user.email) filters.push(`email.eq.${user.email}`);
  const { data: cands } = await sb.from("candidates").select("id").or(filters.join(","));
  const ids = (cands ?? []).map((c: any) => c.id);
  if (!ids.length) return json([]);

  const { data, error } = await sb
    .from("applications")
    .select(SELECT)
    .in("candidate_id", ids)
    .order("created_at", { ascending: false });
  if (error) return fail(error.message, 500);
  return json((data ?? []).map(serialize));
};
