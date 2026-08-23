// Demandes d'échange d'offre.
//   POST   /api/offer-switch-requests             candidat  — déposer une demande
//   GET    /api/offer-switch-requests             staff     — lister (filtre ?status=)
//   POST   /api/offer-switch-requests/:id/:action staff     — approve | reject
import type { Context } from "@netlify/functions";
import { z } from "zod";
import { admin, BUCKET } from "./_shared/supabase";
import { requireStaff, requireUser } from "./_shared/auth";
import { json, fail, readBody } from "./_shared/http";
import { loadCandidateProfiles, loadOfferProfiles } from "./_shared/db";
import { compositeScore } from "./_shared/scoring";
import { checkTargetOffer, readPlacement, rpcErrorMessage } from "./_shared/offer-switch";
import { notifySwitchApproved } from "./_shared/switch-email";

export const config = {
  path: ["/api/offer-switch-requests", "/api/offer-switch-requests/:id/:action"],
};

const createSchema = z.object({
  requested_offer_id: z.number().int().positive(),
  proof_image_path: z.string().min(1).max(400),
});

/** Les candidats rattachés au compte appelant (par lien explicite ou par email). */
async function candidateIdsForUser(userId: string, email: string | null): Promise<number[]> {
  const filters = [`user_id.eq.${userId}`];
  if (email) filters.push(`email.eq.${email}`);
  const { data } = await admin().from("candidates").select("id").or(filters.join(","));
  return (data ?? []).map((c: { id: number }) => c.id);
}

/** Nombre d'affectations confirmées sur une offre — l'occupation est dérivée,
 *  `internship_offers.slots` n'est jamais décrémenté. */
async function confirmedOn(offerId: number): Promise<number> {
  const { count } = await admin()
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("offer_id", offerId)
    .eq("status", "confirmed");
  return count ?? 0;
}

// ------------------------------------------------------------------ POST
async function createRequest(req: Request, userId: string, email: string | null) {
  const parsed = createSchema.safeParse(await readBody(req));
  if (!parsed.success) return fail("Données invalides", 422);
  const { requested_offer_id, proof_image_path } = parsed.data;

  // La preuve doit provenir de notre propre endpoint d'upload.
  if (!proof_image_path.startsWith("switch-proofs/")) {
    return fail("Chemin de preuve invalide", 422);
  }

  const sb = admin();
  const candidateIds = await candidateIdsForUser(userId, email);
  if (!candidateIds.length) return fail("Aucun profil candidat rattaché à ce compte", 404);

  // L'offre actuelle vient de l'affectation CONFIRMÉE, pas de la candidature.
  const { data: rows, error } = await sb
    .from("assignments")
    .select("application_id, offer_id, candidate_id, offer:internship_offers(title)")
    .in("candidate_id", candidateIds)
    .eq("status", "confirmed")
    .limit(1);
  if (error) return fail(error.message, 500);

  const placement = readPlacement(rows ?? []);
  if (!placement) {
    return fail(
      "Vous n'avez pas encore d'affectation confirmée : il n'y a pas d'offre à échanger.",
      409,
    );
  }
  if (placement.offerId === requested_offer_id) {
    return fail("L'offre demandée est déjà la vôtre.", 422);
  }

  // Vérifie que l'objet a bien été téléversé avant d'enregistrer la demande.
  const { data: meta } = await sb.storage
    .from(BUCKET)
    .list("switch-proofs", { search: proof_image_path.replace(/^switch-proofs\//, "") });
  if (!(meta ?? []).some((m) => `switch-proofs/${m.name}` === proof_image_path)) {
    return fail("Image de preuve introuvable", 400);
  }

  const { data: target } = await sb
    .from("internship_offers")
    .select("id, title, slots, status")
    .eq("id", requested_offer_id)
    .maybeSingle();
  const check = checkTargetOffer(
    target ? { ...target, confirmed: await confirmedOn(target.id) } : null,
  );
  if (!check.ok) return fail(check.detail, check.status);

  // Le candidat retenu est celui qui porte l'affectation confirmée, pas le
  // premier de la liste : un compte peut être rattaché à plusieurs profils.
  const candidateId = Number((rows ?? [])[0]?.candidate_id);
  const { data: created, error: insErr } = await sb
    .from("offer_switch_requests")
    .insert({
      candidate_id: candidateId,
      application_id: placement.applicationId,
      current_offer_id: placement.offerId,
      requested_offer_id,
      proof_image_path,
    })
    .select()
    .single();
  if (insErr) {
    // L'index unique partiel interdit deux demandes en attente.
    if (insErr.code === "23505") {
      return fail("Vous avez déjà une demande en attente.", 409);
    }
    return fail(insErr.message, 500);
  }

  // Notifie le personnel (une notification par compte admin/recruteur).
  const { data: staff } = await sb
    .from("profiles")
    .select("id")
    .in("role", ["admin", "recruiter"])
    .eq("is_active", true);
  if (staff?.length) {
    await sb.from("notifications").insert(
      staff.map((s: { id: string }) => ({
        user_id: s.id,
        type: "offer_switch_requested",
        title: "Nouvelle demande d'échange d'offre",
        body: `Un candidat demande à passer de « ${placement.offerTitle} » à une autre offre.`,
      })),
    );
  }

  return json(created, 201);
}

// ------------------------------------------------------------------- GET
const LIST_SELECT =
  "id, status, admin_note, proof_image_path, reviewed_by, reviewed_at, created_at, " +
  "candidate:candidates(id, first_name, last_name, email), " +
  "current_offer:internship_offers!offer_switch_requests_current_offer_id_fkey(id, title), " +
  "requested_offer:internship_offers!offer_switch_requests_requested_offer_id_fkey(id, title, slots)";

async function listRequests(req: Request) {
  const sb = admin();
  const status = new URL(req.url).searchParams.get("status");
  let q = sb.from("offer_switch_requests").select(LIST_SELECT).order("created_at", { ascending: false });
  if (status && status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return fail(error.message, 500);

  const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const rows = await Promise.all(
    (data ?? []).map(async (r: Record<string, any>) => {
      const cand = one<Record<string, any>>(r.candidate);
      const cur = one<Record<string, any>>(r.current_offer);
      const req2 = one<Record<string, any>>(r.requested_offer);
      // URL signée : le bucket est privé, l'image n'est jamais publique.
      const { data: signed } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(r.proof_image_path, 3600);
      return {
        id: r.id,
        status: r.status,
        admin_note: r.admin_note,
        reviewed_by: r.reviewed_by,
        reviewed_at: r.reviewed_at,
        created_at: r.created_at,
        candidate_id: cand?.id ?? null,
        candidate_name: cand ? `${cand.first_name} ${cand.last_name}`.trim() : "—",
        candidate_email: cand?.email ?? null,
        current_offer_id: cur?.id ?? null,
        current_offer_title: cur?.title ?? "—",
        requested_offer_id: req2?.id ?? null,
        requested_offer_title: req2?.title ?? "—",
        proof_url: signed?.signedUrl ?? null,
      };
    }),
  );
  return json(rows);
}

// ------------------------------------------------------- POST /:id/:action
async function review(req: Request, id: string, action: string, reviewer: string) {
  const sb = admin();
  const body = await readBody(req);
  const note = body.admin_note != null ? String(body.admin_note).slice(0, 2000) : null;

  const { data: request } = await sb
    .from("offer_switch_requests")
    .select("id, status, application_id, candidate_id, requested_offer_id")
    .eq("id", id)
    .maybeSingle();
  if (!request) return fail("Demande introuvable", 404);
  if (request.status !== "pending") return fail("Cette demande a déjà été traitée.", 409);

  if (action === "reject") {
    const { data: updated, error } = await sb
      .from("offer_switch_requests")
      .update({ status: "rejected", admin_note: note, reviewed_by: reviewer, reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) return fail(error.message, 500);

    const { data: cand } = await sb
      .from("candidates")
      .select("user_id")
      .eq("id", request.candidate_id)
      .maybeSingle();
    if (cand?.user_id) {
      await sb.from("notifications").insert({
        user_id: cand.user_id,
        type: "offer_switch_rejected",
        title: "Votre demande d'échange a été refusée",
        body: note || "Aucun motif précisé.",
      });
    }
    return json(updated);
  }

  if (action !== "approve") return fail("Action inconnue", 400);

  // Pré-contrôle en TypeScript : message clair. La RPC revérifie sous verrou,
  // c'est elle qui protège de deux approbations simultanées.
  const { data: target } = await sb
    .from("internship_offers")
    .select("id, title, slots, status, department:departments(name)")
    .eq("id", request.requested_offer_id)
    .maybeSingle();
  const check = checkTargetOffer(
    target ? { ...target, confirmed: await confirmedOn(target.id) } : null,
  );
  if (!check.ok) return fail(check.detail, check.status);

  // Le score porterait sinon sur l'ancienne offre : on le recalcule avec le même
  // moteur que l'affectation initiale (scoring inchangé, simple lecture).
  let newScore = 0;
  let newBreakdown: unknown = null;
  try {
    const [candidates, offers] = await Promise.all([loadCandidateProfiles(), loadOfferProfiles()]);
    const cand = candidates.find((c) => c.applicationId === request.application_id);
    const offer = offers.find((o) => o.offerId === request.requested_offer_id);
    if (cand && offer) {
      const { score, breakdown } = compositeScore(cand, offer);
      newScore = score;
      newBreakdown = breakdown;
    }
  } catch (err) {
    console.error("recalcul du score impossible, on garde le détail existant:", err);
  }

  const { data: approved, error } = await sb.rpc("approve_offer_switch", {
    p_request_id: id,
    p_reviewer: reviewer,
    p_new_score: newScore,
    p_new_breakdown: newBreakdown,
  });
  if (error) {
    const mapped = rpcErrorMessage(error.message);
    return fail(mapped.detail, mapped.status);
  }

  // L'échange est commité. L'e-mail est un canal supplémentaire (la
  // notification in-app reste posée par la RPC) : on l'attend pour pouvoir
  // enregistrer email_sent_at, mais il ne peut ni échouer ni annuler quoi que
  // ce soit — notifySwitchApproved avale tout.
  const row = (approved ?? {}) as Record<string, unknown>;
  const dept = Array.isArray(target?.department) ? target?.department[0] : target?.department;
  await notifySwitchApproved({
    requestId: String(row.id ?? id),
    candidateId: Number(row.candidate_id ?? request.candidate_id),
    status: String(row.status ?? "approved"),
    emailSentAt: (row.email_sent_at as string | null) ?? null,
    newOfferTitle: target?.title ?? "votre nouvelle offre",
    departmentName: (dept as { name?: string } | null)?.name ?? null,
  });

  return json(approved);
}

// ----------------------------------------------------------------- router
export default async (req: Request, context: Context): Promise<Response> => {
  const id = context.params?.id;
  const action = context.params?.action;

  if (req.method === "POST" && !id) {
    const user = await requireUser(req);
    if (user instanceof Response) return user;
    return createRequest(req, user.id, user.email);
  }

  // Tout le reste est réservé au personnel.
  const staff = await requireStaff(req);
  if (staff instanceof Response) return staff;

  if (req.method === "GET" && !id) return listRequests(req);
  if (req.method === "POST" && id && action) {
    return review(req, id, action, staff.email ?? staff.id);
  }
  return fail("Méthode non autorisée", 405);
};
