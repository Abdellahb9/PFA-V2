import { describe, expect, it } from "vitest";
import { chunkPages, chunkText, headingOf, splitRanges } from "../chunking";
import { CHUNK_OVERLAP, CHUNK_SIZE } from "../config";
import { fixturePages } from "./helpers";

const sentence = (i: number) => `Phrase numéro ${i} du règlement de stage, assez longue pour compter. `;
const longText = (n: number) => Array.from({ length: n }, (_, i) => sentence(i)).join("");

describe("chunkText", () => {
  it("ne renvoie rien pour un texte vide", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("garde un document court en un seul extrait", () => {
    expect(chunkText("Durée maximale : six mois.")).toEqual([
      { content: "Durée maximale : six mois.", page: null, heading: null },
    ]);
  });

  it("borne chaque extrait à CHUNK_SIZE et couvre tout le texte", () => {
    const text = longText(80);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.content.length <= CHUNK_SIZE)).toBe(true);
    for (let i = 0; i < 80; i++) {
      expect(chunks.some((c) => c.content.includes(`numéro ${i} `))).toBe(true);
    }
  });

  it("coupe en fin de paragraphe quand la fenêtre en contient une", () => {
    const para = "a".repeat(600) + "\n\n" + "b".repeat(600);
    const [first] = chunkText(para);
    expect(first.content).toBe("a".repeat(600));
  });
});

describe("splitRanges — chevauchement", () => {
  it("ne commence jamais un extrait au milieu d'un mot", () => {
    const text = longText(60);
    const ranges = splitRanges(text);
    for (const { start } of ranges.slice(1)) {
      expect(/\s/.test(text[start - 1])).toBe(true);
      expect(/\s/.test(text[start])).toBe(false);
    }
  });

  it("préfère une frontière de phrase dans la zone de chevauchement", () => {
    const text = longText(60);
    const ranges = splitRanges(text);
    for (const { start } of ranges.slice(1)) {
      expect(text.slice(start)).toMatch(/^Phrase numéro/);
    }
  });

  it("chevauche réellement l'extrait précédent, sans dépasser CHUNK_OVERLAP", () => {
    const ranges = splitRanges(longText(60));
    for (let i = 1; i < ranges.length; i++) {
      const overlap = ranges[i - 1].end - ranges[i].start;
      expect(overlap).toBeGreaterThan(0);
      expect(overlap).toBeLessThanOrEqual(CHUNK_OVERLAP);
    }
  });

  it("progresse toujours, même sur un mot plus long que la fenêtre", () => {
    const ranges = splitRanges("x".repeat(3000));
    expect(ranges.at(-1)?.end).toBe(3000);
    expect(ranges.length).toBeLessThan(10);
  });
});

describe("intertitres et pages", () => {
  it("reconnaît les intertitres usuels", () => {
    expect(headingOf("## Article 2 — Durée du stage")).toBe("Article 2 — Durée du stage");
    expect(headingOf("ARTICLE 3 : GRATIFICATION")).toBe("ARTICLE 3 : GRATIFICATION");
    expect(headingOf("Chapitre 4 Assurance")).toBe("Chapitre 4 Assurance");
    expect(headingOf("2.1 Conditions d'accès")).toBe("2.1 Conditions d'accès");
    expect(headingOf("La durée est de six mois.")).toBeNull();
    expect(headingOf("OK")).toBeNull();
  });

  it("rattache chaque extrait à sa page et à son article", () => {
    const chunks = chunkPages(fixturePages("politique-stage.md"));
    const duree = chunks.find((c) => c.content.includes("six mois par année"));
    expect(duree).toMatchObject({ page: 2, heading: "Article 2 — Durée du stage" });
    const grat = chunks.find((c) => c.content.includes("3 000 dirhams"));
    expect(grat).toMatchObject({ page: 3, heading: "Article 3 — Gratification" });
  });

  it("propage l'intertitre d'une section qui déborde sur la page suivante", () => {
    const chunks = chunkPages([
      { page: 1, text: "## Article 9 — Discipline\n\nDébut de l'article." },
      { page: 2, text: "Suite de l'article sans nouveau titre." },
    ]);
    expect(chunks[1]).toMatchObject({ page: 2, heading: "Article 9 — Discipline" });
  });
});
