// E-mail transactionnel. Un seul fournisseur aujourd'hui (Resend), appelé en
// `fetch` nu — comme `trigger-analysis.ts`, et sans ajouter de dépendance npm.
//
// Tout passe par `sendEmail()` : changer de fournisseur, c'est réécrire cette
// seule fonction, les appelants ne connaissent que { to, subject, html, text }.
//
// `sendEmail` ne lève JAMAIS. Un e-mail est un canal secondaire : son échec ne
// doit pas remonter dans un flux métier qui, lui, a déjà réussi.

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** Identifiant du message chez le fournisseur, utile pour tracer un envoi. */
  id?: string;
  error?: string;
}

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.MAIL_FROM ?? "";

  // Config absente : on le dit clairement et on n'envoie pas. Surtout pas de
  // clé dans le message d'erreur, il finit en base et dans les logs.
  if (!apiKey || !from) {
    const missing = [!apiKey && "RESEND_API_KEY", !from && "MAIL_FROM"]
      .filter(Boolean)
      .join(", ");
    console.warn(`[email] ${missing} absent(s) — envoi ignoré`);
    return { ok: false, error: `Configuration e-mail absente : ${missing}` };
  }

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `HTTP ${res.status} ${detail.slice(0, 300)}`.trim() };
    }

    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: body.id };
  } catch (e) {
    // Réseau coupé, délai dépassé, JSON illisible : tout finit ici.
    return { ok: false, error: e instanceof Error ? e.message : "Erreur d'envoi inconnue" };
  }
}

// --------------------------------------------------------------- Coordonnées

export interface OfficeInfo {
  name: string;
  address: string;
  contact: string;
}

/** Coordonnées du bureau, surchargeables sans redéploiement. Les valeurs par
 *  défaut sont des repères visibles, pas des adresses inventées. */
export function officeInfoFromEnv(): OfficeInfo {
  return {
    name: process.env.OFFICE_NAME ?? "[OFFICE_NAME — à renseigner]",
    address: process.env.OFFICE_ADDRESS ?? "[OFFICE_ADDRESS — à renseigner]",
    contact: process.env.OFFICE_CONTACT ?? "[OFFICE_CONTACT — à renseigner]",
  };
}

/** Phrase de délai, uniquement si DOCS_DEADLINE_DAYS est un entier positif. */
export function deadlineTextFromEnv(): string | null {
  const raw = process.env.DOCS_DEADLINE_DAYS;
  if (!raw) return null;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return null;
  return days === 1
    ? "Merci de les déposer dans un délai d'un jour à compter de la réception de ce message."
    : `Merci de les déposer dans un délai de ${Math.floor(days)} jours à compter de la réception de ce message.`;
}

// ------------------------------------------------------------- Mise en forme

/** Les titres d'offres et noms viennent de la base : ils peuvent contenir
 *  `&`, `<` ou `>` et casseraient le HTML du message. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SwitchApprovedInput {
  candidateName: string;
  newOfferTitle: string;
  departmentName: string | null;
  officeInfo: OfficeInfo;
  deadlineText: string | null;
}

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

/** Message annonçant l'échange approuvé et demandant le dépôt des documents.
 *  Mise en page sobre, sans image externe : les clients mail les bloquent. */
export function buildSwitchApprovedEmail(input: SwitchApprovedInput): BuiltEmail {
  const { candidateName, newOfferTitle, departmentName, officeInfo, deadlineText } = input;
  const subject = "Échange d'offre approuvé — dépôt de vos documents";
  const greeting = candidateName.trim() ? `Bonjour ${candidateName.trim()},` : "Bonjour,";
  const offerLine = departmentName
    ? `« ${newOfferTitle} » — ${departmentName}`
    : `« ${newOfferTitle} »`;

  const text = [
    greeting,
    "",
    "Votre demande d'échange d'offre de stage a été approuvée.",
    `Vous êtes désormais affecté(e) à l'offre suivante : ${offerLine}.`,
    "",
    "Prochaine étape : merci de déposer vos documents de stage au bureau.",
    "",
    `Bureau : ${officeInfo.name}`,
    `Adresse : ${officeInfo.address}`,
    `Contact : ${officeInfo.contact}`,
    ...(deadlineText ? ["", deadlineText] : []),
    "",
    "Cordialement,",
    "L'équipe des stages",
    "",
    "— Message automatique, merci de ne pas y répondre.",
  ].join("\n");

  const html = `<!-- Mise en page en tableau : c'est ce que les clients mail rendent le mieux. -->
<div style="margin:0;padding:24px;background:#f5f6f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2328;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;border:1px solid #e3e5e8;">
    <tr>
      <td style="padding:28px 28px 8px;">
        <p style="margin:0 0 16px;font-size:15px;">${esc(greeting)}</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
          Votre demande d'échange d'offre de stage a été <strong>approuvée</strong>.
          Vous êtes désormais affecté(e) à l'offre suivante :
        </p>
        <p style="margin:0 0 20px;padding:12px 14px;background:#f0f4f8;border-left:3px solid #76b900;font-size:15px;">
          ${esc(offerLine)}
        </p>
        <p style="margin:0 0 8px;font-size:15px;line-height:1.55;">
          <strong>Prochaine étape :</strong> merci de déposer vos documents de stage au bureau.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 20px;font-size:14px;line-height:1.6;">
          <tr><td style="padding-right:12px;color:#5b6470;">Bureau</td><td>${esc(officeInfo.name)}</td></tr>
          <tr><td style="padding-right:12px;color:#5b6470;">Adresse</td><td>${esc(officeInfo.address)}</td></tr>
          <tr><td style="padding-right:12px;color:#5b6470;">Contact</td><td>${esc(officeInfo.contact)}</td></tr>
        </table>
        ${
          deadlineText
            ? `<p style="margin:0 0 20px;font-size:14px;color:#8a5a00;background:#fff6e5;padding:10px 12px;border-radius:4px;">${esc(deadlineText)}</p>`
            : ""
        }
        <p style="margin:0 0 4px;font-size:15px;">Cordialement,</p>
        <p style="margin:0 0 24px;font-size:15px;">L'équipe des stages</p>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 28px 22px;border-top:1px solid #eceef0;font-size:12px;color:#8b939c;">
        Message automatique, merci de ne pas y répondre.
      </td>
    </tr>
  </table>
</div>`;

  return { subject, html, text };
}
