// GET /api/bookings — staff. Offers booked by an intern, ordered by when the
// internship starts. A booking is an assignment (confirmed by default) plus the
// period the candidate asked for on their application.
//
// Query params:
//   status = confirmed | proposed | all      (default: confirmed)
//   from, to = YYYY-MM-DD                    (keep bookings OVERLAPPING the window)
//   include_undated = 1                      (also return bookings with no period)
import { admin } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail } from "./_shared/http";

export const config = { path: "/api/bookings" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const SELECT =
  "id, status, match_score, created_at, decided_by, " +
  "candidate:candidates(id, first_name, last_name, email), " +
  "offer:internship_offers(id, title, slots, department:departments(id, name)), " +
  "application:applications(id, start_date, end_date, duration_months)";

interface Row {
  id: number;
  status: string;
  match_score: number | null;
  created_at: string;
  decided_by: string | null;
  candidate: { id: number; first_name: string; last_name: string; email: string } | null;
  offer: {
    id: number;
    title: string;
    slots: number;
    department: { id: number; name: string } | null;
  } | null;
  application: {
    id: number;
    start_date: string | null;
    end_date: string | null;
    duration_months: number | null;
  } | null;
}

export default async (req: Request): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "confirmed";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const includeUndated = url.searchParams.get("include_undated") === "1";
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) {
    return fail("Dates invalides (format attendu : AAAA-MM-JJ)", 422);
  }

  const sb = admin();
  let q = sb.from("assignments").select(SELECT);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return fail(error.message, 500);

  const rows = (data ?? []) as unknown as Row[];

  // Two bookings overlap a window when each starts before the other ends.
  // Undated bookings can't be placed on the calendar, so a window excludes them
  // unless explicitly asked for.
  const inWindow = (r: Row) => {
    const start = r.application?.start_date ?? null;
    const end = r.application?.end_date ?? null;
    if (!start || !end) return includeUndated || (!from && !to);
    if (from && end < from) return false;
    if (to && start > to) return false;
    return true;
  };

  const bookings = rows
    .filter(inWindow)
    .map((r) => ({
      assignment_id: r.id,
      status: r.status,
      match_score: r.match_score,
      decided_by: r.decided_by,
      created_at: r.created_at,
      candidate_id: r.candidate?.id ?? null,
      // The page's headline: who occupies the slot.
      person_name: r.candidate
        ? `${r.candidate.first_name} ${r.candidate.last_name}`.trim()
        : "—",
      person_email: r.candidate?.email ?? null,
      offer_id: r.offer?.id ?? null,
      offer_title: r.offer?.title ?? "—",
      department_name: r.offer?.department?.name ?? null,
      application_id: r.application?.id ?? null,
      start_date: r.application?.start_date ?? null,
      end_date: r.application?.end_date ?? null,
      duration_months: r.application?.duration_months ?? null,
    }))
    // Chronological by period; undated bookings sink to the bottom.
    .sort((a, b) => {
      if (!a.start_date && !b.start_date) return a.offer_title.localeCompare(b.offer_title);
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return a.start_date.localeCompare(b.start_date);
    });

  return json(bookings);
};
