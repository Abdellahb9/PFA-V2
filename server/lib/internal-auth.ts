// Routes internes (/api/analyze-cv, /api/rag-embed) : appelées par l'API
// elle-même (triggerBackground) ou par Vercel Cron, jamais par un navigateur.
//
// Avec CRON_SECRET défini, elles exigent « Authorization: Bearer <secret> » —
// l'en-tête que Vercel Cron envoie de lui-même, et que triggerBackground
// ajoute. Sans CRON_SECRET (développement), elles restent ouvertes, avec un
// avertissement dans les logs.
let warned = false;

export function internalAuthHeader(): Record<string, string> {
  const secret = process.env.CRON_SECRET;
  return secret ? { authorization: `Bearer ${secret}` } : {};
}

/** null si l'appel est autorisé, sinon la réponse 401 à renvoyer. */
export function rejectUnlessInternal(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (!warned) {
      console.warn("CRON_SECRET absent : les routes internes ne sont pas protégées");
      warned = true;
    }
    return null;
  }
  if (req.headers.get("authorization") === `Bearer ${secret}`) return null;
  return new Response(JSON.stringify({ detail: "Non autorisé" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
