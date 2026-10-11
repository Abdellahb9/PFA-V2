// Traces de diagnostic du RAG, coupées par défaut.
//
//   RAG_DEBUG=1 npm run eval:rag
//
// Montre ce que le modèle reçoit réellement : verdict de périmètre, requêtes de
// recherche et extraits classés, messages envoyés à chaque tour, cause d'un
// repli. Jamais actif en production sans la variable.

export function ragDebugEnabled(): boolean {
  return process.env.RAG_DEBUG === "1" || process.env.RAG_DEBUG === "true";
}

/** Coupe un texte long pour la trace, en signalant la coupe. */
export function clip(text: string, max = 300): string {
  const t = String(text ?? "").replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max)}… (+${t.length - max})`;
}

export function ragDebug(stage: string, data: unknown): void {
  if (!ragDebugEnabled()) return;
  console.debug(`[rag:${stage}]`, typeof data === "string" ? data : JSON.stringify(data, null, 1));
}
