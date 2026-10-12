// Envoi de l'e-mail au stagiaire après un échange d'offre approuvé.
//
// Appelé APRÈS le commit de la RPC : l'échange est déjà acquis. Cette fonction
// ne lève donc jamais et ne renvoie rien — quoi qu'il arrive ici, l'approbation
// reste un succès. Les échecs sont tracés dans `email_error`.
//
// Idempotence : on n'envoie que si `email_sent_at` est NULL. La marque est
// posée avec un `.is("email_sent_at", null)` supplémentaire, si bien que deux
// exécutions concurrentes n'écrivent qu'une fois.
import { admin } from "./supabase";
import {
  buildSwitchApprovedEmail,
  deadlineTextFromEnv,
  officeInfoFromEnv,
  sendEmail,
} from "./email";

export interface SwitchEmailContext {
  requestId: string;
  candidateId: number;
  status: string;
  emailSentAt: string | null;
  newOfferTitle: string;
  departmentName: string | null;
}

const MAX_ERROR_LEN = 500;

export async function notifySwitchApproved(ctx: SwitchEmailContext): Promise<void> {
  try {
    // Deux verrous : un échange refusé ne notifie pas, un déjà notifié non plus.
    if (ctx.status !== "approved" || ctx.emailSentAt) return;

    const sb = admin();
    const { data: cand } = await sb
      .from("candidates")
      .select("first_name, last_name, email")
      .eq("id", ctx.candidateId)
      .maybeSingle();

    // `candidates.email` est `not null` en base, mais la ligne peut avoir
    // disparu entre l'approbation et ici.
    const to = (cand?.email ?? "").trim();
    if (!to) {
      console.warn(`[email] échange ${ctx.requestId} — aucune adresse candidat, envoi ignoré`);
      await markError(ctx.requestId, "Adresse e-mail du candidat introuvable");
      return;
    }

    const built = buildSwitchApprovedEmail({
      candidateName: `${cand?.first_name ?? ""} ${cand?.last_name ?? ""}`.trim(),
      newOfferTitle: ctx.newOfferTitle,
      departmentName: ctx.departmentName,
      officeInfo: officeInfoFromEnv(),
      deadlineText: deadlineTextFromEnv(),
    });

    const result = await sendEmail({ to, ...built });

    if (result.ok) {
      await sb
        .from("offer_switch_requests")
        .update({ email_sent_at: new Date().toISOString(), email_error: null })
        .eq("id", ctx.requestId)
        .is("email_sent_at", null);
      console.log(`[email] échange ${ctx.requestId} — envoyé (id fournisseur ${result.id ?? "?"})`);
      return;
    }

    console.error(`[email] échange ${ctx.requestId} — échec : ${result.error}`);
    await markError(ctx.requestId, result.error ?? "Erreur inconnue");
  } catch (e) {
    // Dernier filet : rien de ce qui se passe ici ne doit remonter à l'appelant.
    console.error(`[email] échange ${ctx.requestId} — exception :`, e);
  }
}

async function markError(requestId: string, error: string): Promise<void> {
  await admin()
    .from("offer_switch_requests")
    .update({ email_error: error.slice(0, MAX_ERROR_LEN) })
    .eq("id", requestId);
}
