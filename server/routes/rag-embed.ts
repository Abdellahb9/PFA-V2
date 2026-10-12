// Tâche de fond (bornée par maxDuration, vercel.json) : vectorise les extraits documentaires en
// attente. Déclenchée après chaque dépôt par /api/assistant/documents.
//
// Idempotente et sans argument : elle ne traite que les extraits sans vecteur.
// Un appel externe ne peut donc rien faire d'autre que finir un travail dû —
// c'est aussi le moyen de rattraper un lot après une panne de l'API Mistral ou
// l'ajout tardif de MISTRAL_API_KEY.
import { embedPending, embeddingsEnabled } from "../lib/rag";

export default async (): Promise<Response> => {
  if (!embeddingsEnabled()) {
    return new Response(JSON.stringify({ status: "disabled", embedded: 0 }), { status: 200 });
  }
  try {
    const embedded = await embedPending();
    console.info(`[rag-embed] ${embedded} chunk(s) embedded`);
    return new Response(JSON.stringify({ status: "ok", embedded }), { status: 200 });
  } catch (err) {
    // Les extraits non traités restent en attente : le prochain dépôt les reprendra.
    console.error("[rag-embed] embedding failed:", err);
    return new Response(JSON.stringify({ status: "error" }), { status: 500 });
  }
};
