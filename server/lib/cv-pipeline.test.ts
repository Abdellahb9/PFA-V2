// Chaîne CV : ce qui ne dépend pas d'un appel réseau — nommage provisoire,
// répartition de la réindexation, indexation sous le nom du candidat.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { candidatesRows, nameRow, ingestPages, embedPending, enabled } = vi.hoisted(() => ({
  candidatesRows: { value: [] as unknown[] },
  nameRow: { value: { first_name: "Yasmine", last_name: "El Amrani" } as Record<string, string> | null },
  ingestPages: vi.fn(),
  embedPending: vi.fn(),
  enabled: { value: false },
}));

// Deux lectures seulement : la liste des candidats (reindexAll) et le nom d'un
// candidat (indexCandidateCv).
vi.mock("./supabase", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = async () => ({ data: candidatesRows.value, error: null });
  chain.single = async () => ({ data: nameRow.value, error: null });
  return { admin: () => chain, BUCKET: "documents" };
});

vi.mock("./rag", async () => {
  const real = await vi.importActual<typeof import("./rag")>("./rag");
  return { ...real, ingestPages, embedPending, embeddingsEnabled: () => enabled.value };
});

import { guessNameFromFilename, indexCandidateCv, reindexAll } from "./cv-pipeline";

beforeEach(() => {
  vi.clearAllMocks();
  enabled.value = false;
  ingestPages.mockResolvedValue({ chunks: 4 });
});

describe("guessNameFromFilename", () => {
  it("tire un nom provisoire du nom de fichier", () => {
    expect(guessNameFromFilename("jean_dupont_CV.pdf")).toEqual({ first: "Jean", last: "Dupont" });
    expect(guessNameFromFilename("CV-2024.docx")).toEqual({ first: "Candidat", last: "(import CV)" });
  });
});

describe("indexCandidateCv", () => {
  it("indexe le CV sous le nom du candidat, rattaché à lui", async () => {
    const n = await indexCandidateCv(12, [{ page: 1, text: "Expériences…" }]);
    expect(n).toBe(4);
    expect(ingestPages).toHaveBeenCalledWith("cv-candidat-12", [{ page: 1, text: "Expériences…" }], "cv", true, {
      candidateId: 12,
      title: "CV — Yasmine El Amrani",
      headingTitle: "Yasmine El Amrani",
    });
    expect(embedPending).not.toHaveBeenCalled(); // sans clé Mistral
  });

  it("vectorise aussitôt quand les embeddings sont actifs, sans échouer si l'API tombe", async () => {
    enabled.value = true;
    embedPending.mockRejectedValue(new Error("mistral down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(indexCandidateCv(12, [{ page: null, text: "x" }])).resolves.toBe(4);
    expect(embedPending).toHaveBeenCalledOnce();
  });
});

describe("reindexAll", () => {
  it("réanalyse le dernier CV stocké, sinon indexe le texte connu, sinon ignore", async () => {
    candidatesRows.value = [
      {
        id: 1,
        cv_text: "x".repeat(500),
        applications: [
          { id: 10, created_at: "2026-01-01", documents: [{ id: 1 }] },
          { id: 11, created_at: "2026-05-01", documents: [{ id: 2 }] },
        ],
      },
      { id: 2, cv_text: "Texte de CV assez long pour être indexé. ".repeat(4), applications: [] },
      { id: 3, cv_text: "Omar Fassi - Génie électrique", applications: [{ id: 30, created_at: "2026-01-01", documents: [] }] },
    ];
    const analyze = vi.fn();
    const res = await reindexAll(analyze);
    expect(analyze.mock.calls).toEqual([[11]]); // la plus récente munie d'un fichier
    expect(ingestPages).toHaveBeenCalledTimes(1);
    expect(ingestPages.mock.calls[0][0]).toBe("cv-candidat-2");
    expect(res).toEqual({ analyses: 1, indexes_sans_fichier: 1, ignores: 1 });
  });
});
