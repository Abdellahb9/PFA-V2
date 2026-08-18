// /api/assignments  ·  /api/assignments/:id   (admin: list + confirm/reject)
import type { Context } from "@netlify/functions";
import { admin } from "./_shared/supabase";
import { requireStaff } from "./_shared/auth";
import { json, fail, readBody } from "./_shared/http";
import { loadCandidateProfiles, loadOfferProfiles } from "./_shared/db";
import { compositeScore } from "./_shared/scoring";

export const config = { path: ["/api/assignments", "/api/assignments/:id"] };

export default async (req: Request, context: Context): Promise<Response> => {
  const user = await requireStaff(req);
  if (user instanceof Response) return user;
  const sb = admin();
  const id = context.params.id ? Number(context.params.id) : null;

  if (req.method === "GET" && !id) {
    const status = new URL(req.url).searchParams.get("status");
    let q = sb.from("assignments").select("*").order("match_score", { ascending: false });
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    return error ? fail(error.message, 500) : json(data);
  }

  // Manual assignment: assign an application to a chosen offer (from the per-offer
  // ranking or the matching preview). The score is recomputed server-side (the
  // client score is not trusted).
  //
  // `status` permet de créer ET décider en un seul appel. C'est ce dont a besoin
  // l'écran d'affectation : ses propositions n'existent pas encore en base quand
  // l'optimisation tourne en aperçu, et il n'a donc aucun id d'affectation à
  // fournir. Le couple (candidature, offre) est la seule clé qu'il connaisse.
  if (req.method === "POST" && !id) {
    const b = await readBody(req);
    const applicationId = Number(b.application_id);
    const offerId = Number(b.offer_id);
    if (!applicationId || !offerId) return fail("Paramètres manquants", 422);
    const decision = b.status != null ? String(b.status) : null;
    if (decision != null && !["confirmed", "rejected", "proposed"].includes(decision)) {
      return fail("Statut invalide", 422);
    }

    const [candidates, offers] = await Promise.all([
      loadCandidateProfiles(),
      loadOfferProfiles(),
    ]);
    const cand = candidates.find((c) => c.applicationId === applicationId);
    const offer = offers.find((o) => o.offerId === offerId);
    if (!cand || !offer) return fail("Candidat ou offre introuvable", 404);

    const { score, breakdown } = compositeScore(cand, offer);

    const { data: existing } = await sb
      .from("assignments")
      .select("id, status")
      .eq("application_id", applicationId)
      .maybeSingle();
    if (existing?.status === "confirmed") {
      return fail("Cette candidature est déjà confirmée ailleurs.", 409);
    }
    if (existing) await sb.from("assignments").delete().eq("id", existing.id);

    const { data, error } = await sb
      .from("assignments")
      .insert({
        application_id: applicationId,
        candidate_id: cand.candidateId,
        offer_id: offerId,
        match_score: score,
        score_breakdown: breakdown,
        status: decision ?? "proposed",
        decided_by: user.email,
      })
      .select()
      .single();
    if (error) return fail(error.message, 500);

    // Le statut de la candidature suit la décision, comme dans PATCH.
    await sb
      .from("applications")
      .update({
        match_score: score,
        status: decision === "confirmed" ? "assigned" : "under_review",
      })
      .eq("id", applicationId);
    return json(data, 201);
  }

  if (req.method === "PATCH" && id) {
    const url = new URL(req.url);
    const body = await readBody(req);
    const status = (body.status ?? url.searchParams.get("status")) as string;
    if (!["confirmed", "rejected", "proposed"].includes(status)) return fail("Statut invalide", 422);

    const { data: a, error } = await sb
      .from("assignments")
      .update({ status, decided_by: user.email })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return fail(error.message, 500);
    if (!a) return fail("Affectation introuvable", 404);

    if (status === "confirmed") {
      await sb.from("applications").update({ status: "assigned" }).eq("id", a.application_id);
    } else if (status === "rejected") {
      await sb.from("applications").update({ status: "under_review" }).eq("id", a.application_id);
    }
    return json(a);
  }

  return fail("Méthode non autorisée", 405);
};
