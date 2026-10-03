import { describe, expect, it } from "vitest";
import { MAX_TOOL_RESULT_CHARS } from "../config";
import { focusText, toolResultContent } from "../context";
import { detectLanguage } from "../language";

const filler = "Le tuteur accompagne le stagiaire et veille au bon déroulement. ";

describe("focusText", () => {
  it("garde le passage qui contient les termes de la question", () => {
    const text = filler.repeat(20) + "La gratification mensuelle est de 3 000 dirhams. " + filler.repeat(20);
    const out = focusText(text, "Quelle est la gratification ?", 300);
    expect(out).toContain("3 000 dirhams");
    expect(out.length).toBeLessThanOrEqual(302); // + ellipses
  });

  it("retombe sur le début du texte sans terme reconnu", () => {
    const text = "Début. " + filler.repeat(30);
    expect(focusText(text, "", 100).startsWith("Début.")).toBe(true);
  });

  it("ne touche pas un texte déjà court", () => {
    expect(focusText("court", "x", 100)).toBe("court");
  });
});

describe("toolResultContent", () => {
  const chunk = (i: number, size: number) => ({
    type: "doc_chunk",
    source_document: "Politique_de_stage_OCP_2026.pdf",
    chunk_index: i,
    text: `Article ${i}. ` + "La convention tripartite fixe la durée du stage. ".repeat(size / 50),
  });

  it("fait tenir 5 extraits ENTIERS de taille nominale (plus d'amputation)", () => {
    const payload = { extraits: [0, 1, 2, 3, 4].map((i) => chunk(i, 900)) };
    const parsed = JSON.parse(toolResultContent(payload)) as typeof payload;
    expect(parsed.extraits).toHaveLength(5);
    expect(parsed.extraits[0].text).toBe(payload.extraits[0].text);
  });

  it("reste du JSON valide et dans le budget, même très au-delà", () => {
    const payload = { extraits: Array.from({ length: 40 }, (_, i) => chunk(i, 1600)) };
    const content = toolResultContent(payload, MAX_TOOL_RESULT_CHARS, "durée du stage");
    expect(content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(() => JSON.parse(content)).not.toThrow();
    expect((JSON.parse(content) as { tronque?: boolean }).tronque).toBe(true);
  });

  it("rogne la liste la plus volumineuse, pas celle des offres", () => {
    const big = {
      profile: "Data Science",
      based_on_offers: ["Stage Data Science"],
      results: Array.from({ length: 60 }, (_, i) => ({ rank: i + 1, name: "x".repeat(300) })),
    };
    const parsed = JSON.parse(toolResultContent(big)) as typeof big;
    expect(parsed.based_on_offers).toEqual(["Stage Data Science"]);
    expect(parsed.results.length).toBeLessThan(60);
  });

  it("laisse intacte une charge utile qui tient dans le budget", () => {
    const small = { extraits: [], base_documentaire_vide: true };
    expect(JSON.parse(toolResultContent(small))).toEqual(small);
  });
});

describe("detectLanguage", () => {
  it("reconnaît le français et l'anglais", () => {
    expect(detectLanguage("Quelle est la durée maximale du stage ?")).toBe("fr");
    expect(detectLanguage("What is the maximum internship duration?")).toBe("en");
  });

  it("tranche en faveur du français en cas d'égalité", () => {
    expect(detectLanguage("python sql")).toBe("fr");
  });

  it("compte les accents quelle que soit la casse", () => {
    expect(detectLanguage("DURÉE ÉTÉ")).toBe("fr");
  });

  it("connaît « était » (divergence historique avec la version Python)", () => {
    expect(detectLanguage("était")).toBe("fr");
  });
});
