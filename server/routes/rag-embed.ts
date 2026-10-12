// Tâche de fond (bornée par maxDuration, vercel.json) : vectorise les extraits
// en attente. Déclenchée après chaque dépôt de document, et chaque jour par
// Vercel Cron (vercel.json) pour rattraper un lot après une panne de l'API
// Mistral ou l'ajout tardif de MISTRAL_API_KEY.
//
// Idempotente et sans argument : elle ne traite que les extraits sans vecteur.
import { rejectUnlessInternal } from "../lib/internal-auth";
import { embedPending, embeddingsEnabled } from "../lib/rag";

export default async (req: Request): Promise<Response> => {
  const denied = rejectUnlessInternal(req);
  if (denied) return denied;
  if (!embeddingsEnabled()) {
    return new Response(JSON.stringify({ status: "disabled", embedded: 0 }), { status: 200 });
  }
  try {
    const embedded = await embedPending();
    console.info(`[rag-embed] ${embedded} chunk(s) embedded`);
    return new Response(JSON.stringify({ status: "ok", embedded }), { status: 200 });
  } catch (err) {
    // Les extraits non traités restent en attente : le prochain passage les reprendra.
    console.error("[rag-embed] embedding failed:", err);
    return new Response(JSON.stringify({ status: "error" }), { status: 500 });
  }
};
