// Recherche de candidats : filtres délégués à SQL, plancher, diagnostic.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../supabase", () => ({ admin: () => ({ rpc }) }));

import { candidateEmptyAnswer, retrieveCandidates } from "../candidates";
import { MIN_CANDIDATE_RELEVANCE } from "../config";
import type { CandidateSearchDiag } from "../types";

const ok = (data: unknown) => ({ data, error: null });
const row = (id: number, rank: number) => ({
  candidate_id: id,
  name: `Candidat ${id}`,
  education_level: "Bac+5",
  field_of_study: "Informatique",
  years_experience: "3",
  skills: ["python", "sql"],
  rank,
});

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("retrieveCandidates", () => {
  it("délègue les filtres à SQL", async () => {
    rpc.mockResolvedValue(ok([row(1, 0.42)]));
    await retrieveCandidates("python", { minYearsExperience: 2, educationLevel: "Bac+5", topK: 7 });
    expect(rpc).toHaveBeenCalledWith("search_candidates", {
      q: "python",
      min_years: 2,
      education: "Bac+5",
      top_k: 7,
    });
  });

  it("publie le rang absolu renvoyé par Postgres, typé", async () => {
    rpc.mockResolvedValue(ok([row(1, 0.123456)]));
    const { results } = await retrieveCandidates("python");
    expect(results[0]).toMatchObject({ type: "candidate", similarity: 0.1235, years_experience: 3 });
  });

  it("écarte les profils sous le plancher, garde celui pile au plancher", async () => {
    rpc.mockResolvedValueOnce(ok([row(1, 0.5), row(2, MIN_CANDIDATE_RELEVANCE), row(3, 0.01)]));
    rpc.mockResolvedValueOnce(ok([]));
    const { results } = await retrieveCandidates("python");
    expect(results.map((r) => r.candidate_id)).toEqual([1, 2]);
  });

  it("garde une recherche purement structurée (rang nul, filtres posés)", async () => {
    rpc.mockResolvedValue(ok([row(1, 0)]));
    const { results } = await retrieveCandidates("", { educationLevel: "Bac+5" });
    expect(results).toHaveLength(1);
  });

  it("ne demande le diagnostic que si la recherche est vide", async () => {
    rpc.mockResolvedValueOnce(ok([row(1, 0.5)]));
    await retrieveCandidates("python");
    expect(rpc).toHaveBeenCalledTimes(1);

    rpc.mockReset();
    rpc.mockResolvedValueOnce(ok([]));
    rpc.mockResolvedValueOnce(
      ok([{ scanned: 9, term_matches: 2, excluded_by_years: 2, excluded_by_education: 0, experience_unknown: 1 }]),
    );
    const { diag } = await retrieveCandidates("python", { minYearsExperience: 3 });
    expect(rpc).toHaveBeenLastCalledWith("search_candidates_diag", {
      q: "python",
      min_years: 3,
      education: null,
    });
    expect(diag).toEqual({
      scanned: 9,
      termMatches: 2,
      excludedByYears: 2,
      excludedByEducation: 0,
      experienceUnknown: 1,
      minYears: 3,
    });
  });

  it("un diagnostic en échec ne fait pas échouer la recherche", async () => {
    rpc.mockResolvedValueOnce(ok([]));
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { results, diag } = await retrieveCandidates("python");
    expect(results).toEqual([]);
    expect(diag.scanned).toBe(0);
  });

  it("remonte une erreur de la recherche elle-même", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation missing" } });
    await expect(retrieveCandidates("python")).rejects.toThrow("relation missing");
  });
});

describe("candidateEmptyAnswer", () => {
  const diag = (d: Partial<CandidateSearchDiag>): CandidateSearchDiag => ({
    scanned: 10,
    termMatches: 0,
    excludedByYears: 0,
    excludedByEducation: 0,
    experienceUnknown: 0,
    minYears: null,
    ...d,
  });

  it("signale une base vide", () => {
    expect(candidateEmptyAnswer(diag({ scanned: 0 }))).toMatch(/Aucun candidat n'est encore/);
  });

  it("distingue un échec des termes d'un filtre", () => {
    expect(candidateEmptyAnswer(diag({}))).toMatch(/Aucun des 10 candidats/);
  });

  it("nomme le filtre d'années et l'expérience inconnue", () => {
    const text = candidateEmptyAnswer(
      diag({ termMatches: 3, excludedByYears: 3, experienceUnknown: 2, minYears: 2 }),
    );
    expect(text).toMatch(/aucun n'atteint 2 an/);
    expect(text).toMatch(/pour 2 d'entre eux/);
  });

  it("nomme le filtre de formation, en anglais aussi", () => {
    expect(
      candidateEmptyAnswer(diag({ termMatches: 2, excludedByEducation: 2 }), "en"),
    ).toMatch(/requested education level/);
  });
});
