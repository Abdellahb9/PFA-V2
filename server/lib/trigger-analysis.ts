// Déclenchement « sans attendre » d'une route de tâche de fond (/api/<fn>).
//
// La requête part vers la même origine ; waitUntil garde l'invocation Vercel
// en vie jusqu'à ce qu'elle soit effectivement envoyée — sans lui, la fonction
// peut être gelée dès la réponse au client et le déclenchement se perd.
import { waitUntil } from "@vercel/functions";

export function triggerBackground(fn: string, body: unknown, req: Request): void {
  const url = `${new URL(req.url).origin}/api/${fn}`;
  const promise = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
  try {
    waitUntil(promise);
  } catch {
    /* hors de Vercel (tests, scripts) : la promesse suit son cours */
  }
}

/** Analyse du CV d'une candidature (routes/analyze-cv.ts). */
export function triggerAnalysis(applicationId: number, req: Request): void {
  triggerBackground("analyze-cv", { application_id: applicationId }, req);
}

/** Vectorisation des extraits documentaires en attente (routes/rag-embed.ts). */
export function triggerEmbedding(req: Request): void {
  triggerBackground("rag-embed", {}, req);
}
