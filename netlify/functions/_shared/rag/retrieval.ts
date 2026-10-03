// Recherche documentaire hybride : plein-texte + vecteurs, fusion RRF en SQL.
//
// Ordre des opérations, et pourquoi :
//   1. vecteur de la question (null sans clé ou sur panne → plein-texte seul) ;
//   2. RPC rag_search_chunks sur un VIVIER de top_k × POOL_FACTOR extraits ;
//   3. déduplication des extraits voisins — AVANT la coupe : dédupliquer après
//      le LIMIT rendait 3 extraits pour 5 demandés ;
//   4. coupe à top_k.
import {
  DEFAULT_TOP_K,
  MAX_TOP_K,
  MIN_COSINE,
  MIN_FTS_RANK,
  POOL_FACTOR,
  RRF_K,
} from "./config";
import { embedQuery } from "./embeddings";
import { getStore } from "./store";
import type { ChunkSource, DocType, SearchRow } from "./types";

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Pertinence affichée, ABSOLUE et comparable d'une requête à l'autre :
 * le meilleur des deux signaux, le cosinus étant recalé de [MIN_COSINE, 1]
 * vers [0, 1] (mistral-embed tasse ses scores vers le haut : un cosinus brut de
 * 0,7 afficherait « 70 % » pour un passage sans rapport).
 */
export function relevance(ftsRank: number, cosine: number | null): number {
  const vec = cosine == null ? 0 : Math.max(0, (cosine - MIN_COSINE) / (1 - MIN_COSINE));
  return round4(Math.min(1, Math.max(ftsRank, vec)));
}

/**
 * Deux extraits voisins d'un même document se chevauchent : les garder tous les
 * deux consomme des places de contexte pour répéter le même passage. On
 * conserve le premier rencontré, c'est-à-dire le mieux classé.
 */
export function dedupeAdjacent<T extends { source_document: string; chunk_index: number }>(
  items: T[],
): T[] {
  const kept: T[] = [];
  for (const c of items) {
    const redundant = kept.some(
      (k) => k.source_document === c.source_document && Math.abs(k.chunk_index - c.chunk_index) <= 1,
    );
    if (!redundant) kept.push(c);
  }
  return kept;
}

function toSource(r: SearchRow): ChunkSource {
  return {
    type: "doc_chunk",
    source_document: r.source_document,
    chunk_index: r.chunk_index,
    text: r.content,
    similarity: relevance(r.fts_rank, r.cosine),
    doc_type: r.doc_type,
    page: r.page,
    heading: r.heading,
  };
}

export async function retrieveDocChunks(
  query: string,
  topK = DEFAULT_TOP_K,
  docType: DocType | null = null,
): Promise<ChunkSource[]> {
  const k = Math.min(MAX_TOP_K, Math.max(1, Math.trunc(topK) || DEFAULT_TOP_K));
  const q = (query ?? "").trim();
  if (!q) return [];

  const embedding = await embedQuery(q);
  const rows = await getStore().searchChunks({
    query: q,
    embedding,
    matchCount: k * POOL_FACTOR,
    docType,
    minFts: MIN_FTS_RANK,
    minCosine: MIN_COSINE,
    rrfK: RRF_K,
  });

  // La RPC trie déjà par score RRF ; on ne réordonne pas.
  return dedupeAdjacent(rows.map(toSource)).slice(0, k);
}
