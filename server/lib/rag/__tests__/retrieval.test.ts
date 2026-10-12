// Recherche documentaire : ce qui part vers le stockage et ce qui en revient.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_COSINE, MIN_FTS_RANK, RRF_K } from "../config";
import { mergeAdjacent, relevance, retrieveDocChunks } from "../retrieval";
import { setStore, type RagStore } from "../store";
import type { ChunkSource, SearchRow } from "../types";

const { embedQuery } = vi.hoisted(() => ({ embedQuery: vi.fn() }));
vi.mock("../embeddings", () => ({ embedQuery }));

const row = (doc: string, index: number, fts: number, cosine: number | null = null, page = 1): SearchRow => ({
  chunk_id: index,
  source_document: doc,
  doc_type: "other",
  chunk_index: index,
  page,
  heading: `Article ${index}`,
  content: `Texte ${index}`,
  fts_rank: fts,
  cosine,
  score: 1 / (60 + index),
  title: null,
  candidate_id: null,
});

/** La forme publiée à l'agent et à l'interface (pertinence = rang plein-texte ici). */
const source = (r: SearchRow): ChunkSource => ({
  type: "doc_chunk",
  source_document: r.source_document,
  chunk_index: r.chunk_index,
  text: r.content,
  similarity: r.fts_rank,
  doc_type: r.doc_type,
  page: r.page,
  heading: r.heading,
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
  it("demande top_k extraits et passe les planchers à la RPC", async () => {
    embedQuery.mockResolvedValue([0.1, 0.2]);
    searchChunks.mockResolvedValue([]);
    await retrieveDocChunks("durée du stage", 4, "other");
    expect(searchChunks).toHaveBeenCalledWith({
      query: "durée du stage",
      embedding: [0.1, 0.2],
      matchCount: 4,
      docType: "other",
      minFts: MIN_FTS_RANK,
      minCosine: MIN_COSINE,
      rrfK: RRF_K,
      candidateId: null,
    });
  });

  it("bascule en plein-texte quand la question ne peut pas être vectorisée", async () => {
    embedQuery.mockResolvedValue(null);
    searchChunks.mockResolvedValue([row("a.pdf", 0, 0.3)]);
    const out = await retrieveDocChunks("durée");
    expect(searchChunks.mock.calls[0][0].embedding).toBeNull();
    expect(out).toHaveLength(1);
  });

  it("fusionne les extraits voisins au lieu d'en jeter un", async () => {
    embedQuery.mockResolvedValue(null);
    // 0 et 1 sont voisins, 3 et 4 aussi. Autrefois 1 et 4 étaient jetés : ils
    // portaient pourtant la suite du texte.
    searchChunks.mockResolvedValue([0, 1, 3, 4, 6].map((i) => row("a.pdf", i, 0.5 - i / 100)));
    const out = await retrieveDocChunks("stage", 5);
    expect(out.map((c) => c.chunk_index)).toEqual([0, 3, 6]);
    expect(out[0].text).toBe("Texte 0\nTexte 1");
    expect(out[1].text).toBe("Texte 3\nTexte 4");
  });

  it("garde le même index s'il vient d'un autre document", () => {
    const out = mergeAdjacent([row("a.pdf", 2, 0.4), row("b.pdf", 2, 0.3)].map(source));
    expect(out).toHaveLength(2);
  });

  it("recolle deux extraits sans répéter leur chevauchement", () => {
    // Fin de l'extrait 4 = début de l'extrait 5 : c'est le chevauchement du découpeur.
    const a = { ...source(row("cv.pdf", 4, 0.3)), text: "LafargeHolcim Maroc. Inventaire des pièces de rechange." };
    const b = { ...source(row("cv.pdf", 5, 0.6)), text: "Inventaire des pièces de rechange. Port d'Agadir, Marsa Maroc." };
    // L'extrait 5 est mieux classé : le passage garde sa place, mais commence à l'extrait 4.
    const [m] = mergeAdjacent([b, a]);
    expect(m).toMatchObject({ chunk_index: 4, page: 1, similarity: 0.6 });
    expect(m.text).toBe("LafargeHolcim Maroc. Inventaire des pièces de rechange. Port d'Agadir, Marsa Maroc.");
  });

  it("ne fusionne pas deux pages : la citation garde la bonne page", () => {
    const out = mergeAdjacent([row("cv.pdf", 3, 0.5, null, 1), row("cv.pdf", 4, 0.4, null, 2)].map(source));
    expect(out.map((c) => [c.chunk_index, c.page])).toEqual([
      [3, 1],
      [4, 2],
    ]);
  });

  it("réunit deux passages quand un extrait les relie", () => {
    const out = mergeAdjacent([5, 7, 6].map((i) => source(row("a.pdf", i, 0.5))));
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Texte 5\nTexte 6\nTexte 7");
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
      doc_type: "other",
      page: 1,
      heading: "Article 1",
      title: null,
      candidate_id: null,
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
    expect(searchChunks.mock.calls[0][0].matchCount).toBe(20);
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
