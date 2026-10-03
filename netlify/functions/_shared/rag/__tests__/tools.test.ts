// Outils de l'agent : les arguments viennent du MODÈLE, donc ils sont douteux.
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  retrieveCandidates,
  retrieveDocChunks,
  getScoreBreakdown,
  loadApplicantPool,
  loadOpenOffersWithSkills,
  countChunks,
} = vi.hoisted(() => ({
  retrieveCandidates: vi.fn(),
  retrieveDocChunks: vi.fn(),
  getScoreBreakdown: vi.fn(),
  loadApplicantPool: vi.fn(),
  loadOpenOffersWithSkills: vi.fn(),
  countChunks: vi.fn(),
}));

vi.mock("../../db", () => ({ loadApplicantPool, loadOpenOffersWithSkills }));
vi.mock("../candidates", () => ({
  retrieveCandidates,
  getScoreBreakdown,
  candidateEmptyAnswer: () => "Aucun candidat.",
}));
vi.mock("../retrieval", () => ({ retrieveDocChunks }));
vi.mock("../store", () => ({ getStore: () => ({ countChunks }) }));
vi.mock("../../supabase", () => ({ admin: () => ({}) }));

import { runTool } from "../tools";

const emptyDiag = {
  scanned: 0,
  termMatches: 0,
  excludedByYears: 0,
  excludedByEducation: 0,
  experienceUnknown: 0,
  minYears: null,
};
const candidate = (i: number) => ({ type: "candidate", candidate_id: i, name: `C${i}`, similarity: 0.5 });

beforeEach(() => {
  vi.clearAllMocks();
  retrieveCandidates.mockResolvedValue({ results: [], diag: emptyDiag });
  retrieveDocChunks.mockResolvedValue([]);
  getScoreBreakdown.mockResolvedValue(null);
  countChunks.mockResolvedValue(0);
});

describe("search_candidates", () => {
  it("applique le défaut à un top_k non numérique", async () => {
    retrieveCandidates.mockResolvedValue({ results: [candidate(1)], diag: emptyDiag });
    await runTool("search_candidates", { query: "python", top_k: "beaucoup" });
    expect(retrieveCandidates).toHaveBeenCalledWith("python", expect.objectContaining({ topK: 5 }));
  });

  it("borne un top_k négatif ou démesuré", async () => {
    await runTool("search_candidates", { query: "python", top_k: -3 });
    expect(retrieveCandidates).toHaveBeenLastCalledWith("python", expect.objectContaining({ topK: 1 }));
    await runTool("search_candidates", { query: "python", top_k: 5000 });
    expect(retrieveCandidates).toHaveBeenLastCalledWith("python", expect.objectContaining({ topK: 20 }));
  });

  it("ignore un min_years_experience non numérique", async () => {
    await runTool("search_candidates", { query: "python", min_years_experience: "trois" });
    expect(retrieveCandidates).toHaveBeenCalledWith(
      "python",
      expect.objectContaining({ minYearsExperience: null }),
    );
  });

  it("explique une recherche vide et oriente vers les documents", async () => {
    const { payload, sources } = await runTool("search_candidates", { query: "Meriem" });
    expect(payload).toMatchObject({ explication: "Aucun candidat." });
    expect((payload as { prochaine_etape: string }).prochaine_etape).toMatch(/search_documents/);
    expect(sources).toEqual([]);
  });
});

describe("search_documents", () => {
  const chunk = { type: "doc_chunk", source_document: "a.pdf", chunk_index: 0, text: "x", page: 1 };

  it("étiquette les extraits comme contenu non fiable", async () => {
    retrieveDocChunks.mockResolvedValue([chunk]);
    const { payload, sources } = await runTool("search_documents", { query: "durée" });
    expect((payload as { extraits: Record<string, unknown>[] }).extraits[0].contenu_non_fiable).toBe(true);
    expect(sources).toEqual([chunk]); // l'UI reçoit l'extrait sans l'étiquette
  });

  it("ne transmet qu'un doc_type valide", async () => {
    await runTool("search_documents", { query: "durée", doc_type: "policy" });
    expect(retrieveDocChunks).toHaveBeenLastCalledWith("durée", 5, "policy");
    await runTool("search_documents", { query: "durée", doc_type: "DROP TABLE" });
    expect(retrieveDocChunks).toHaveBeenLastCalledWith("durée", 5, null);
  });

  it("distingue une base vide d'une recherche sans résultat", async () => {
    countChunks.mockResolvedValue(0);
    let { payload } = await runTool("search_documents", { query: "durée" });
    expect(payload).toMatchObject({ base_documentaire_vide: true });
    countChunks.mockResolvedValue(42);
    ({ payload } = await runTool("search_documents", { query: "durée" }));
    expect(payload).toMatchObject({ base_documentaire_vide: false });
  });
});

describe("explain_assignment_score, list_*", () => {
  it("refuse un assignment_id invalide sans appeler la base", async () => {
    for (const id of ["abc", -1, 1.5]) {
      const { payload } = await runTool("explain_assignment_score", { assignment_id: id });
      expect(payload).toHaveProperty("erreur");
    }
    expect(getScoreBreakdown).not.toHaveBeenCalled();
  });

  it("refuse un statut d'offre inconnu", async () => {
    const { payload } = await runTool("list_offers", { status: "archived" });
    expect(payload).toHaveProperty("erreur");
  });

  it("refuse une date mal formée", async () => {
    const { payload } = await runTool("list_bookings", { from: "septembre" });
    expect(payload).toHaveProperty("erreur");
  });

  it("nomme l'outil inconnu plutôt que de lever", async () => {
    const { payload } = await runTool("drop_database", {});
    expect(payload).toEqual({ erreur: "Outil inconnu : drop_database" });
  });
});

describe("rank_candidates — le code classe, le modèle explique", () => {
  const offers = [
    {
      offerId: 2,
      title: "Stage Data Science",
      field: "Data Science",
      minEducationLevel: "Bac+4",
      skills: [
        { skill: "python", weight: 1, required: true },
        { skill: "data science", weight: 0.9, required: true },
      ],
    },
  ];
  const person = (id: number, name: string, skills: string[], field = "Data Science") => ({
    candidateId: id,
    applicationId: id * 10,
    name,
    status: "parsed",
    educationLevel: "Bac+5",
    fieldOfStudy: field,
    yearsExperience: 1,
    skills: new Map(skills.map((x) => [x, 0.9])),
  });

  beforeEach(() => {
    loadOpenOffersWithSkills.mockResolvedValue(offers);
    loadApplicantPool.mockResolvedValue([
      person(1, "Partiel", ["python"]),
      person(2, "Complet", ["python", "data science"]),
    ]);
  });

  it("renvoie un classement déterministe et des sources typées", async () => {
    const { payload, sources } = await runTool("rank_candidates", { field: "data science" });
    expect((payload as { results: { name: string }[] }).results.map((r) => r.name)).toEqual([
      "Complet",
      "Partiel",
    ]);
    expect((sources[0] as { type: string }).type).toBe("ranked_candidate");
  });

  it("refuse une filière inconnue et liste les filières connues", async () => {
    const { payload } = await runTool("rank_candidates", { field: "poterie" });
    expect((payload as { disponibles: string[] }).disponibles).toContain("Data Science");
  });

  it("accepte des compétences en chaîne séparée par des virgules", async () => {
    const { payload } = await runTool("rank_candidates", { skills: "python, data science" });
    expect((payload as { results: unknown[] }).results).toHaveLength(2);
  });

  it("borne top_k à 10", async () => {
    loadApplicantPool.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => person(i + 1, `C${i}`, ["python"])),
    );
    const { payload } = await runTool("rank_candidates", { field: "data science", top_k: 50 });
    expect((payload as { results: unknown[] }).results).toHaveLength(10);
  });

  it("explique un classement vide", async () => {
    loadApplicantPool.mockResolvedValue([person(1, "Hors sujet", ["hr"], "RH")]);
    const { payload, sources } = await runTool("rank_candidates", { field: "data science" });
    expect(payload).toHaveProperty("explication");
    expect(sources).toEqual([]);
  });
});
