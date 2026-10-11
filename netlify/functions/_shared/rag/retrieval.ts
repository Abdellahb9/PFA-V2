// Recherche documentaire hybride : plein-texte + vecteurs, fusion RRF en SQL.
//
// Ordre des opérations, et pourquoi :
//   1. vecteur de la question (null sans clé ou sur panne → plein-texte seul) ;
//   2. RPC rag_search_chunks : les top_k extraits les mieux classés ;
//   3. FUSION des extraits voisins d'un même document en un seul passage.
//      Autrefois le voisin était jeté comme « doublon » — or deux extraits
//      voisins ne partagent que le chevauchement (≤ CHUNK_OVERLAP) : le voisin
//      jeté emportait ~85 % de texte neuf, souvent la suite de la réponse.
//
// top_k compte des EXTRAITS, pas des passages : le volume de texte remis au
// modèle reste celui pour lequel MAX_TOOL_RESULT_CHARS est dimensionné.
import { CHUNK_OVERLAP, DEFAULT_TOP_K, MAX_TOP_K, MIN_COSINE, MIN_FTS_RANK, RRF_K } from "./config";
import { clip, ragDebug } from "./debug";
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

/** Recolle deux extraits consécutifs en retirant le chevauchement qu'ils partagent. */
function joinOverlap(a: string, b: string): string {
  for (let k = Math.min(a.length, b.length, CHUNK_OVERLAP + 50); k > 0; k--) {
    if (a.endsWith(b.slice(0, k))) return a + b.slice(k);
  }
  return `${a}\n${b}`;
}

/**
 * Fusionne les extraits voisins d'un même document (index consécutifs) en un
 * passage continu. Les passages restent dans l'ordre de leur meilleur extrait ;
 * chacun prend la page, l'intertitre et l'index de son PREMIER extrait dans le
 * document, et la meilleure pertinence du groupe.
 */
export function mergeAdjacent(items: ChunkSource[]): ChunkSource[] {
  const groups: ChunkSource[][] = [];
  for (const c of items) {
    // Même page seulement : la citation « (doc, p. N) » doit rester exacte, et
    // deux extraits de pages différentes ne se chevauchent pas (découpe par page).
    const near = groups.filter(
      (g) =>
        g[0].source_document === c.source_document &&
        g[0].page === c.page &&
        g.some((p) => Math.abs(p.chunk_index - c.chunk_index) <= 1),
    );
    if (near.some((g) => g.some((p) => p.chunk_index === c.chunk_index))) continue; // même extrait, déjà là
    if (!near.length) {
      groups.push([c]);
      continue;
    }
    // L'extrait peut relier deux groupes (5 puis 7, puis 6) : on les réunit.
    const [first, ...rest] = near;
    first.push(c);
    for (const g of rest) {
      first.push(...g);
      groups.splice(groups.indexOf(g), 1);
    }
  }
  return groups.map((g) => {
    const parts = [...g].sort((x, y) => x.chunk_index - y.chunk_index);
    return {
      ...parts[0],
      text: parts.slice(1).reduce((acc, p) => joinOverlap(acc, p.text), parts[0].text),
      similarity: Math.max(...parts.map((p) => p.similarity)),
    };
  });
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
    matchCount: k,
    docType,
    minFts: MIN_FTS_RANK,
    minCosine: MIN_COSINE,
    rrfK: RRF_K,
  });

  // La RPC trie déjà par score RRF ; on ne réordonne pas.
  const out = mergeAdjacent(rows.map(toSource));
  ragDebug("retrieval", {
    query: q,
    doc_type: docType,
    vector: embedding != null,
    rows: rows.map((r) => ({
      doc: r.source_document,
      chunk: r.chunk_index,
      page: r.page,
      heading: r.heading,
      fts: round4(r.fts_rank),
      cos: r.cosine == null ? null : round4(r.cosine),
      rrf: round4(r.score),
      text: clip(r.content, 120),
    })),
    kept: out.map((c) => `${c.source_document}#${c.chunk_index}`),
  });
  return out;
}
