// GET /api/my-switch-requests — les demandes d'échange du candidat connecté,
// plus son affectation actuelle (ce qui détermine s'il peut en déposer une).
// Strictement limité à l'appelant : aucune donnée d'un autre candidat.
import { admin } from "./_shared/supabase";
import { requireUser } from "./_shared/auth";
import { json, fail } from "./_shared/http";
import { readPlacement } from "./_shared/offer-switch";

export const config = { path: "/api/my-switch-requests" };

const SELECT =
  "id, status, admin_note, reviewed_at, created_at, " +
  "current_offer:internship_offers!offer_switch_requests_current_offer_id_fkey(title), " +
  "requested_offer:internship_offers!offer_switch_requests_requested_offer_id_fkey(title)";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return fail("Méthode non autorisée", 405);
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const sb = admin();

  const filters = [`user_id.eq.${user.id}`];
  if (user.email) filters.push(`email.eq.${user.email}`);
  const { data: cands } = await sb.from("candidates").select("id").or(filters.join(","));
  const ids = (cands ?? []).map((c: { id: number }) => c.id);
  if (!ids.length) return json({ placement: null, requests: [] });

  const [placementRes, requestsRes] = await Promise.all([
    sb
      .from("assignments")
      .select("application_id, offer_id, offer:internship_offers(title)")
      .in("candidate_id", ids)
      .eq("status", "confirmed")
      .limit(1),
    sb
      .from("offer_switch_requests")
      .select(SELECT)
      .in("candidate_id", ids)
      .order("created_at", { ascending: false }),
  ]);
  if (requestsRes.error) return fail(requestsRes.error.message, 500);

  const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const requests = (requestsRes.data ?? []).map((r: Record<string, any>) => ({
    id: r.id,
    status: r.status,
    admin_note: r.admin_note,
    reviewed_at: r.reviewed_at,
    created_at: r.created_at,
    current_offer_title: one<Record<string, any>>(r.current_offer)?.title ?? "—",
    requested_offer_title: one<Record<string, any>>(r.requested_offer)?.title ?? "—",
  }));

  return json({ placement: readPlacement(placementRes.data ?? []), requests });
};
