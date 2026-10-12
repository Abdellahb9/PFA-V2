// Vectorisation via l'API Google Gemini (gemini-embedding-2, 768 dimensions).
//
// Groq, qui sert le modèle de conversation, ne propose aucun modèle
// d'embeddings. Gemini est multilingue (français, anglais, arabe) et accepte
// des textes longs. Appel en `fetch` brut : aucune dépendance de plus dans le
// bundle de l'API.
//
// Recherche ASYMÉTRIQUE : gemini-embedding-2 n'a pas de paramètre task_type, la
// tâche est portée par un préfixe du texte — « task: search result | query: … »
// pour une question, « title: … | text: … » pour un extrait. Les deux côtés
// doivent suivre ce format, sans quoi questions et extraits ne se rapprochent
// plus correctement.
//
// Sans GEMINI_API_KEY, rien ne casse : `embeddingsEnabled()` vaut false, les
// extraits restent en attente de vectorisation et la recherche reste purement
// plein-texte.
import {
  EMBED_BATCH,
  EMBED_DIM,
  EMBED_MODEL,
  EMBED_RETRIES,
  EMBED_TIMEOUT_MS,
  EMBED_URL,
  QUERY_EMBED_TIMEOUT_MS,
} from "./config";

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

async function requestBatch(inputs: string[], timeoutMs: number, retries: number): Promise<number[][]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const res = await fetch(EMBED_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY ?? "",
        },
        body: JSON.stringify({
          requests: inputs.map((text) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text }] },
            output_dimensionality: EMBED_DIM,
          })),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // Jamais la clé dans le message : seulement le statut et le début du corps.
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        const err = new EmbeddingError(`Gemini embeddings HTTP ${res.status}: ${detail}`, res.status);
        if (!retryable(res.status)) throw err;
        lastError = err;
        continue;
      }
      const body = (await res.json()) as { embeddings?: { values?: number[] }[] };
      const rows = body.embeddings ?? [];
      if (rows.length !== inputs.length) {
        // Un lot incomplet décalerait chaque vecteur sur le mauvais extrait.
        throw new EmbeddingError(`expected ${inputs.length} embeddings, got ${rows.length}`);
      }
      for (const r of rows) {
        if (!Array.isArray(r.values) || r.values.length !== EMBED_DIM) {
          throw new EmbeddingError(`unexpected embedding dimension ${r.values?.length}`);
        }
      }
      return rows.map((r) => r.values!);
    } catch (err) {
      if (err instanceof EmbeddingError && !(err.status && retryable(err.status))) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new EmbeddingError(String(lastError));
}

/** Vecteurs de plusieurs extraits (déjà mis en forme par embeddingInput), dans l'ordre. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!embeddingsEnabled()) throw new EmbeddingError("GEMINI_API_KEY is not configured");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    // Une entrée vide fait rejeter tout le lot par l'API.
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => t.trim() || "-");
    out.push(...(await requestBatch(batch, EMBED_TIMEOUT_MS, EMBED_RETRIES)));
  }
  return out;
}

/** Texte vectorisé pour une question (côté requête de la recherche asymétrique). */
export function queryInput(text: string): string {
  return `task: search result | query: ${text.trim()}`;
}

/**
 * Vecteur d'une question, ou `null` : sans clé, sur panne ou au-delà d'un délai
 * court, l'appelant bascule en plein-texte au lieu de faire attendre l'utilisateur.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  if (!embeddingsEnabled() || !text.trim()) return null;
  try {
    // Aucun réessai : la question attend, le plein-texte suffit en secours.
    const [vec] = await requestBatch([queryInput(text)], QUERY_EMBED_TIMEOUT_MS, 0);
    return vec ?? null;
  } catch (err) {
    console.warn("[rag] query embedding unavailable, falling back to full-text:", err);
    return null;
  }
}

/**
 * Texte vectorisé pour un extrait (côté document) : l'intertitre — « Nom ›
 * Section » — sert de titre et donne le contexte du passage.
 */
export function embeddingInput(content: string, heading: string | null): string {
  return `title: ${heading?.trim() || "none"} | text: ${content}`;
}
