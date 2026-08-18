// Unit tests for the RAG assistant's pure logic (no Supabase / Groq calls).
import { describe, expect, it } from "vitest";
import {
  candidateEmptyAnswer,
  chunkText,
  classifyIntent,
  detectLanguage,
  emptyAnswer,
  templateAnswer,
} from "./rag";
import type { CandidateSearchDiag } from "./rag";
import type { CandidateSource } from "./rag";

describe("classifyIntent (keyword path, no GROQ_API_KEY)", () => {
  it("forces matching_explanation when an assignment id is given", async () => {
    expect(await classifyIntent("n'importe quoi", 42)).toBe("matching_explanation");
  });

  it("detects candidate search queries (FR + EN)", async () => {
    expect(await classifyIntent("Trouve-moi un candidat Python avec 3 ans d'expérience")).toBe(
      "candidate_search",
    );
    expect(await classifyIntent("find candidates who know react")).toBe("candidate_search");
  });

  it("detects score explanation queries", async () => {
    expect(await classifyIntent("Pourquoi ce score de matching ?")).toBe("matching_explanation");
  });

  it("detects policy questions", async () => {
    expect(await classifyIntent("Quelle est la durée maximale d'un stage ?")).toBe("policy_qa");
    expect(await classifyIntent("Quelle est la politique de gratification ?")).toBe("policy_qa");
  });

  it("defaults to policy_qa without keywords", async () => {
    expect(await classifyIntent("bonjour")).toBe("policy_qa");
  });
});

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    expect(chunkText("Un règlement de stage court.")).toEqual(["Un règlement de stage court."]);
  });

  it("splits long documents into overlapping chunks covering all content", () => {
    const paragraph = "La durée du stage est de six mois maximum. ".repeat(20);
    const text = Array.from({ length: 6 }, (_, i) => `Article ${i + 1}. ${paragraph}`).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 1600)).toBe(true);
    // First and last content must be preserved.
    expect(chunks[0]).toContain("Article 1");
    expect(chunks[chunks.length - 1]).toContain("Article 6");
  });
});

describe("detectLanguage", () => {
  it("detects French queries", () => {
    expect(detectLanguage("Quelle est la durée maximale d'un stage ?")).toBe("fr");
    expect(detectLanguage("Trouve-moi des candidats avec 3 ans d'expérience")).toBe("fr");
  });

  it("detects English queries", () => {
    expect(detectLanguage("What is the maximum duration of an internship?")).toBe("en");
    expect(detectLanguage("Find candidates who know react with 2 years of experience")).toBe("en");
  });

  it("defaults to French on ambiguous input", () => {
    expect(detectLanguage("python sql docker")).toBe("fr");
  });
});

describe("bilingual answers", () => {
  const candidate: CandidateSource = {
    type: "candidate",
    candidate_id: 1,
    name: "Amina El Idrissi",
    education_level: "Bac+5",
    field_of_study: "Informatique",
    years_experience: 3,
    skills: ["python", "sql"],
    similarity: 0.9,
  };

  it("templates candidate search in both languages", () => {
    expect(templateAnswer("candidate_search", [candidate], "fr")).toContain("pertinents");
    expect(templateAnswer("candidate_search", [candidate], "en")).toContain(
      "Most relevant candidates",
    );
  });

  it("gives empty answers in both languages", () => {
    expect(emptyAnswer("policy_qa", "fr")).toContain("Je ne trouve pas");
    expect(emptyAnswer("policy_qa", "en")).toContain("I cannot find");
  });
});

// A bare "no results" hid whether the terms or a filter emptied the search —
// these lock in the message naming the actual cause.
describe("candidateEmptyAnswer", () => {
  const base: CandidateSearchDiag = {
    scanned: 6,
    termMatches: 0,
    excludedByYears: 0,
    excludedByEducation: 0,
    experienceUnknown: 0,
    minYears: null,
  };

  it("tells the user when no candidate exists at all", () => {
    expect(candidateEmptyAnswer({ ...base, scanned: 0 }, "fr")).toContain("Aucun candidat");
    expect(candidateEmptyAnswer({ ...base, scanned: 0 }, "en")).toContain("No candidates recorded");
  });

  it("distinguishes a term miss from a filter", () => {
    const msg = candidateEmptyAnswer(base, "fr");
    expect(msg).toContain("6 candidats");
    expect(msg).toContain("termes");
  });

  it("names the years filter and flags unknown experience", () => {
    const msg = candidateEmptyAnswer(
      { ...base, termMatches: 2, excludedByYears: 2, experienceUnknown: 2, minYears: 2 },
      "fr",
    );
    expect(msg).toContain("2 candidat(s)");
    expect(msg).toContain("2 an(s)");
    expect(msg).toContain("n'a pas pu être");
  });

  it("omits the unknown-experience warning when experience is on file", () => {
    const msg = candidateEmptyAnswer(
      { ...base, termMatches: 3, excludedByYears: 3, experienceUnknown: 0, minYears: 5 },
      "en",
    );
    expect(msg).toContain("3 candidate(s)");
    expect(msg).not.toContain("could not be extracted");
  });

  it("names the education filter", () => {
    const msg = candidateEmptyAnswer(
      { ...base, termMatches: 4, excludedByEducation: 4 },
      "fr",
    );
    expect(msg).toContain("niveau d'études");
  });
});
