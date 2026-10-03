// Recherche documentaire : ce qui part vers le stockage et ce qui en revient.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_COSINE, MIN_FTS_RANK, POOL_FACTOR, RRF_K } from "../config";
import { dedupeAdjacent, relevance, retrieveDocChunks } from "../retrieval";
import { setStore, type RagStore } from "../store";
import type { SearchRow } from "../types";

const { embedQuery } = vi.hoisted(() => ({ embedQuery: vi.fn() }));
vi.mock("../embeddings", () => ({ embedQuery }));

const row = (doc: string, index: number, fts: number, cosine: number | null = null): SearchRow => ({
  chunk_id: index,
  source_document: doc,
  doc_type: "policy",
  chunk_index: index,
  page: index + 1,
  heading: `Article ${index}`,
  content: `Texte ${index}`,
  fts_rank: fts,
  cosine,
  score: 1 / (60 + index),
});

const searchChunks = vi.fn<RagStore["searchChunks"]>();
let previous: RagStore;

beforeEach(() => {
  searchChunks.mockReset();
  embedQuery.mockReset();
  previous = setStore({ searchChunks } as unknown as RagStore);
});
afterEach(() => {
  setStore(previous);
});

describe("retrieveDocChunks", () => {
  it("demande un vivier élargi et passe les planchers à la RPC", async () => {
    embedQuery.mockResolvedValue([0.1, 0.2]);
    searchChunks.mockResolvedValue([]);
    await retrieveDocChunks("durée du stage", 4, "policy");
    expect(searchChunks).toHaveBeenCalledWith({
      query: "durée du stage",
      embedding: [0.1, 0.2],
      matchCount: 4 * POOL_FACTOR,
      docType: "policy",
      minFts: MIN_FTS_RANK,
      minCosine: MIN_COSINE,
      rrfK: RRF_K,
    });
  });

  it("bascule en plein-texte quand la question ne peut pas être vectorisée", async () => {
    embedQuery.mockResolvedValue(null);
    searchChunks.mockResolvedValue([row("a.pdf", 0, 0.3)]);
    const out = await retrieveDocChunks("durée");
    expect(searchChunks.mock.calls[0][0].embedding).toBeNull();
    expect(out).toHaveLength(1);
  });

  it("déduplique AVANT de couper à top_k : 5 demandés, 5 rendus", async () => {
    embedQuery.mockResolvedValue(null);
    // 0 et 1 sont voisins, 3 et 4 aussi : sans vivier, on n'en rendrait que 3.
    searchChunks.mockResolvedValue(
      [0, 1, 3, 4, 6, 8, 10, 12].map((i) => row("a.pdf", i, 0.5 - i / 100)),
    );
    const out = await retrieveDocChunks("stage", 5);
    expect(out.map((c) => c.chunk_index)).toEqual([0, 3, 6, 8, 10]);
  });

  it("garde le même index s'il vient d'un autre document", () => {
    const out = dedupeAdjacent([row("a.pdf", 2, 0.4), row("b.pdf", 2, 0.3)]);
    expect(out).toHaveLength(2);
  });

  it("publie page, intertitre, type et une pertinence ABSOLUE", async () => {
    embedQuery.mockResolvedValue(null);
    searchChunks.mockResolvedValue([row("a.pdf", 1, 0.12)]);
    const [c] = await retrieveDocChunks("stage");
    expect(c).toEqual({
      type: "doc_chunk",
      source_document: "a.pdf",
      chunk_index: 1,
      text: "Texte 1",
      similarity: 0.12, // pas 1.0 : jamais normalisée sur le meilleur résultat
      doc_type: "policy",
      page: 2,
      heading: "Article 1",
    });
  });

  it("n'interroge rien pour une question vide", async () => {
    expect(await retrieveDocChunks("   ")).toEqual([]);
    expect(searchChunks).not.toHaveBeenCalled();
  });

  it("borne top_k", async () => {
    embedQuery.mockResolvedValue(null);
    searchChunks.mockResolvedValue([]);
    await retrieveDocChunks("x", 500);
    expect(searchChunks.mock.calls[0][0].matchCount).toBe(20 * POOL_FACTOR);
  });
});

describe("relevance", () => {
  it("recale le cosinus au-dessus du plancher", () => {
    expect(relevance(0, MIN_COSINE)).toBe(0);
    expect(relevance(0, 1)).toBe(1);
    expect(relevance(0, 0.5)).toBe(0); // sous le plancher : aucun crédit
  });

  it("prend le meilleur des deux signaux", () => {
    expect(relevance(0.4, MIN_COSINE + (1 - MIN_COSINE) / 2)).toBe(0.5);
    expect(relevance(0.7, null)).toBe(0.7);
  });
});
