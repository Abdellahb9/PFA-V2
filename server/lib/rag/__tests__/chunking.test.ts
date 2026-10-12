import { describe, expect, it } from "vitest";
import { chunkPages, chunkText, documentTitle, headingOf, splitRanges } from "../chunking";
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

  it("ne prend pas une ligne de dates ou de tableau pour un intertitre", () => {
    expect(headingOf("2024 2025")).toBeNull();
    expect(headingOf("2021 – 2023 Développeur web")).toBeNull();
    expect(headingOf("1 500 dirhams par mois")).toBeNull();
    expect(headingOf("TOTAL 3 000 MAD")).toBeNull();
    expect(headingOf("3. Expérience professionnelle")).toBe("3. Expérience professionnelle");
    expect(headingOf("COMPÉTENCES TECHNIQUES")).toBe("COMPÉTENCES TECHNIQUES");
  });

  it("rattache chaque extrait à sa page et à sa section", () => {
    const chunks = chunkPages(fixturePages("cv-yasmine-el-amrani.md"));
    const skills = chunks.find((c) => c.content.includes("FlexSim"));
    expect(skills?.page).toBe(2);
    expect(skills?.heading).toContain("COMPÉTENCES TECHNIQUES");
    const jobs = chunks.find((c) => c.content.includes("Stage d'ingénieur adjoint, Managem"));
    expect(jobs?.page).toBe(1);
  });

  it("coupe avant un intertitre et commence la section suivante sans chevauchement", () => {
    const text = `## Yasmine\n\n${"Avis favorable pour la logistique. ".repeat(18)}\n\n## Hajar\n\n${"Profil terrain, convoyeurs et pompes. ".repeat(12)}`;
    expect(text.length).toBeGreaterThan(CHUNK_SIZE);
    const breaks = [0, text.indexOf("## Hajar")];
    const ranges = splitRanges(text, CHUNK_SIZE, CHUNK_OVERLAP, breaks);
    expect(ranges[1].start).toBe(breaks[1]);
    expect(ranges[0].end).toBe(breaks[1]);
  });

  it("attribue chaque passage du compte rendu à la bonne personne", () => {
    const chunks = chunkPages(fixturePages("compte-rendu-jury-2026.md"));
    // L'avis sur Hajar était étiqueté « Yasmine El Amrani » : l'extrait
    // commençait dans le chevauchement de la section précédente.
    const hajar = chunks.filter((c) => c.content.includes("Profil terrain"));
    expect(hajar.length).toBeGreaterThan(0);
    for (const c of hajar) expect(c.heading).toBe("Hajar Ait Ouarab");
    expect(chunks.some((c) => c.content.includes("Profil terrain") && c.content.includes("février 2027"))).toBe(false);
  });

  it("propage l'intertitre d'une section qui déborde sur la page suivante", () => {
    const chunks = chunkPages([
      { page: 1, text: "## Article 9 — Discipline\n\nDébut de l'article." },
      { page: 2, text: "Suite de l'article sans nouveau titre." },
    ]);
    expect(chunks[1]).toMatchObject({ page: 2, heading: "Article 9 — Discipline" });
  });
});

describe("titre du document dans chaque intertitre", () => {
  it("prend la première ligne quand elle a l'allure d'un titre", () => {
    expect(documentTitle("cv.pdf", fixturePages("cv-yasmine-el-amrani.md"))).toBe("YASMINE EL AMRANI");
    expect(documentTitle("r.pdf", [{ page: 1, text: "# Karim Benali — Software Engineer\n\nBody" }])).toBe(
      "Karim Benali — Software Engineer",
    );
  });

  it("retombe sur le nom du fichier quand la première ligne n'est pas un titre", () => {
    const pages = (first: string) => [{ page: 1, text: `${first}\nSuite du CV.` }];
    expect(documentTitle("cv-jean-dupont.pdf", pages("Curriculum Vitae"))).toBe("cv jean dupont");
    expect(documentTitle("cv_jean_dupont.pdf", pages("jean.dupont@example.com | +212 600 000 000"))).toBe(
      "cv jean dupont",
    );
    expect(documentTitle("note.txt", pages("Ceci est une phrase complète."))).toBe("note");
  });

  it("rend chaque extrait d'un CV trouvable par le nom de la personne", () => {
    const pages = fixturePages("cv-yasmine-el-amrani.md");
    const chunks = chunkPages(pages, documentTitle("cv-yasmine-el-amrani.pdf", pages));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.heading).toMatch(/^YASMINE EL AMRANI/);
    const skills = chunks.find((c) => c.content.includes("FlexSim"));
    expect(skills?.heading).toBe("YASMINE EL AMRANI › COMPÉTENCES TECHNIQUES");
  });

  it("ne répète pas le titre quand l'intertitre est le titre lui-même", () => {
    const [first] = chunkPages([{ page: 1, text: "# Hajar\n\nTexte." }], "Hajar");
    expect(first.heading).toBe("Hajar");
  });
});
