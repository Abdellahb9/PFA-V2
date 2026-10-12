// Accès au stockage du RAG : une interface, une implémentation Supabase.
//
// Tout passe par les RPC de la migration 0019 (rag_*) : remplacement atomique,
// recherche hybride, vectorisation. L'interface permet de substituer un
// stockage en mémoire (tests, exemple de bout en bout) sans toucher au reste.
import { admin } from "../supabase";
import type { Chunk, DocType, KnowledgeDocument, SearchRow } from "./types";

export interface SearchParams {
  query: string;
  embedding: number[] | null;
  matchCount: number;
  docType: DocType | null;
  minFts: number;
  minCosine: number;
  rrfK: number;
}

export interface PendingChunk {
  id: number;
  content: string;
  heading: string | null;
}

export interface RagStore {
  /** Remplace atomiquement les extraits d'un document. Lève DocumentExistsError. */
  replaceDocument(
    name: string,
    docType: DocType,
    chunks: Chunk[],
    replace: boolean,
  ): Promise<{ documentId: number; chunks: number }>;
  pendingChunks(limit: number): Promise<PendingChunk[]>;
  setEmbeddings(items: { id: number; embedding: number[] }[]): Promise<number>;
  searchChunks(params: SearchParams): Promise<SearchRow[]>;
  listDocuments(): Promise<KnowledgeDocument[]>;
  deleteDocument(name: string): Promise<boolean>;
  countChunks(): Promise<number>;
}

/** Un document du même nom existe et le remplacement n'a pas été demandé. */
export class DocumentExistsError extends Error {
  constructor(readonly documentName: string) {
    super(
      `Un document nommé « ${documentName} » existe déjà. Renommez-le, ou renvoyez la ` +
        `requête avec replace=true pour le remplacer.`,
    );
    this.name = "DocumentExistsError";
  }
}

const num = (v: unknown) => Number(v ?? 0);

export const supabaseStore: RagStore = {
  async replaceDocument(name, docType, chunks, replace) {
    const { data, error } = await admin().rpc("rag_replace_document", {
      p_name: name,
      p_doc_type: docType,
      p_chunks: chunks,
      p_replace: replace,
    });
    if (error) {
      if (error.code === "23505") throw new DocumentExistsError(name);
      throw new Error(error.message);
    }
    const res = (data ?? {}) as { document_id?: number; chunks?: number };
    return { documentId: num(res.document_id), chunks: num(res.chunks) };
  },

  async pendingChunks(limit) {
    const { data, error } = await admin().rpc("rag_pending_chunks", { p_limit: limit });
    if (error) throw new Error(error.message);
    return ((data ?? []) as PendingChunk[]).map((r) => ({ ...r, id: num(r.id) }));
  },

  async setEmbeddings(items) {
    if (!items.length) return 0;
    const { data, error } = await admin().rpc("rag_set_embeddings", { p_items: items });
    if (error) throw new Error(error.message);
    return num(data);
  },

  async searchChunks(p) {
    const { data, error } = await admin().rpc("rag_search_chunks", {
      q: p.query,
      // pgvector lit la forme texte « [0.1,0.2,…] », soit exactement le JSON.
      q_embedding: p.embedding ? JSON.stringify(p.embedding) : null,
      match_count: p.matchCount,
      p_doc_type: p.docType,
      p_min_fts: p.minFts,
      p_min_cosine: p.minCosine,
      p_rrf_k: p.rrfK,
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      chunk_id: num(r.chunk_id),
      source_document: String(r.source_document),
      doc_type: (r.doc_type as DocType) ?? "other",
      chunk_index: num(r.chunk_index),
      page: r.page == null ? null : num(r.page),
      heading: (r.heading as string | null) ?? null,
      content: String(r.content ?? ""),
      fts_rank: num(r.fts_rank),
      cosine: r.cosine == null ? null : num(r.cosine),
      score: num(r.score),
    }));
  },

  async listDocuments() {
    const { data, error } = await admin().rpc("rag_list_documents");
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      source_document: String(r.source_document),
      chunks: num(r.chunks),
      doc_type: (r.doc_type as DocType) ?? "other",
      embedded: num(r.embedded),
    }));
  },

  async deleteDocument(name) {
    const { data, error } = await admin().rpc("rag_delete_document", { p_name: name });
    if (error) throw new Error(error.message);
    return data === true;
  },

  async countChunks() {
    const { count, error } = await admin()
      .from("rag_chunks")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
};

let current: RagStore = supabaseStore;

export function getStore(): RagStore {
  return current;
}

/** Substitue un stockage (tests, démonstration). Renvoie le précédent. */
export function setStore(store: RagStore): RagStore {
  const previous = current;
  current = store;
  return previous;
}
