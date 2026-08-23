// Logique pure du socle RAG (ni Supabase, ni Groq).
import { describe, expect, it } from "vitest";
import { candidateEmptyAnswer, chunkText, detectLanguage } from "./rag";
import type { CandidateSearchDiag } from "./rag";


describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    expect(chunkText("Un règlement de stage court.")).toEqual(["Un règlement de stage court."]);
  });

  // Math.max sur des index choisit le séparateur le PLUS À DROITE (toujours une
  // espace), jamais le plus prioritaire : la coupure par paragraphe annoncée en
  // commentaire n'avait jamais lieu et les extraits partaient au milieu d'une phrase.
  it("coupe sur la fin de paragraphe quand il y en a une dans la fenêtre", () => {
    const para = "Article 1. La duree du stage est de six mois maximum. ".repeat(18); // ~950 c.
    const chunks = chunkText(para.trimEnd() + "\n\n" + "SUITE ".repeat(200));
    expect(chunks[0].endsWith("maximum.")).toBe(true);
    expect(chunks[0]).not.toContain("SUITE");
  });

  it("retombe sur la fin de phrase puis sur l'espace faute de paragraphe", () => {
    const sentences = "La convention precise la duree. ".repeat(60); // ~1900 c., aucun \n
    const chunks = chunkText(sentences);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endsWith("duree.")).toBe(true);

    const noBreaks = "A".repeat(4000); // ni paragraphe, ni phrase, ni espace
    expect(chunkText(noBreaks).every((c) => c.length <= 1600)).toBe(true);
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

  // Le bonus d'accents ne testait que des caractères minuscules, mais sur le
  // texte BRUT : une question en capitales ne marquait aucun point français.
  it("compte les accents quelle que soit la casse", () => {
    expect(detectLanguage("DURÉE MAXIMALE DU STAGE")).toBe("fr");
    expect(detectLanguage("PROCÉDURE DE RÉMUNÉRATION")).toBe("fr");
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
