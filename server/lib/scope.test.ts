// Filtre de périmètre : voie rapide, filet déterministe (vérifié contre le jeu
// étiqueté eval/assistant-scope.json) et réponse fixe. Aucun appel réseau.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyScope, isDiscriminatoryRequest, cannedStream, smallTalkReply, REFUSALS } from "./scope";

interface EvalCase {
  q: string;
  expect: "in" | "small_talk" | "off_topic" | "discriminatory";
  context?: string;
  backstop?: boolean;
}
const CASES: EvalCase[] = JSON.parse(
  readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "eval", "assistant-scope.json"), "utf8"),
).cases;

describe("classifyScope — voie rapide", () => {
  it.each([
    "Bonjour",
    "merci !",
    "Merci beaucoup",
    "Salut",
    "ok",
    "Génial",
    "Que peux-tu faire ?",
    "Qu’est-ce que tu sais faire ?",
    "what can you do?",
    "Aide",
  ])("répond à « %s » sans le modèle", (q) => {
    expect(classifyScope(q)).toEqual({ verdict: "small_talk", via: "fast_path" });
  });
});

describe("classifyScope — filet déterministe", () => {
  it("refuse un classement discriminatoire sans le modèle", () => {
    expect(classifyScope("Classe les candidats par âge")).toEqual({ verdict: "discriminatory", via: "backstop" });
  });
});

describe("classifyScope — le reste va à l'agent", () => {
  // La production refusait ces questions avec l'ancien classifieur LLM.
  it.each([
    "Quelle université de Babtich El Habib ?",
    "how many candidates do we have ?",
    "I meant cv",
    "Quel est le numéro de CNSS de Hajar Ait Ouarab ?",
    "Quelle est la capitale du Maroc ?", // hors sujet : c'est l'agent qui refuse
  ])("« %s »", (q) => {
    expect(classifyScope(q)).toEqual({ verdict: "in", via: "agent" });
  });
});

describe("smallTalkReply", () => {
  it("salue en présentant ce que l'assistant sait faire — jamais le refus", () => {
    for (const q of ["Bonjour", "Que peux-tu faire ?"]) {
      const r = smallTalkReply(q);
      expect(r).toMatch(/candidats/);
      expect(r).toMatch(/notes/);
      expect(r).not.toBe(REFUSALS.off_topic);
    }
  });

  it("répond dans la langue de la formule", () => {
    expect(smallTalkReply("hello")).toMatch(/^Hello!/);
    expect(smallTalkReply("Merci !")).toBe("Avec plaisir.");
    expect(smallTalkReply("thanks")).toBe("You're welcome.");
    expect(smallTalkReply("au revoir")).toBe("Au revoir !");
  });
});

describe("cannedStream", () => {
  it("émet la phrase fixe puis termine, au format de l'agent", async () => {
    const events = [];
    for await (const e of cannedStream("discriminatory")) events.push(e);
    expect(events).toEqual([{ type: "delta", text: REFUSALS.discriminatory }, { type: "done" }]);
  });

  it("répond à une formule de politesse sans refuser", async () => {
    const events = [];
    for await (const e of cannedStream("small_talk", "bonjour")) events.push(e);
    expect(events).toEqual([{ type: "delta", text: smallTalkReply("bonjour") }, { type: "done" }]);
  });
});

// ---- Jeu étiqueté, côté déterministe -----------------------------------------------

describe("isDiscriminatoryRequest — jeu étiqueté", () => {
  const inScope = CASES.filter((c) => c.expect === "in");
  const mustCatch = CASES.filter((c) => c.backstop);

  it("contient assez de cas dans chaque catégorie", () => {
    expect(inScope.length).toBeGreaterThanOrEqual(20);
    expect(CASES.filter((c) => c.expect === "off_topic").length).toBeGreaterThanOrEqual(10);
    expect(mustCatch.length).toBeGreaterThanOrEqual(8);
  });

  // Un faux positif ici refuserait une vraie question de recrutement — ou
  // présenterait une question hors périmètre comme discriminatoire.
  const notDiscriminatory = CASES.filter((c) => c.expect !== "discriminatory");
  it.each(notDiscriminatory.map((c) => c.q))("ne bloque PAS comme discriminatoire « %s »", (q) => {
    expect(isDiscriminatoryRequest(q)).toBe(false);
  });

  it.each(mustCatch.map((c) => c.q))("bloque « %s »", (q) => {
    expect(isDiscriminatoryRequest(q)).toBe(true);
  });

  it("reconnaît les termes accentués", () => {
    // Le `\b` de JavaScript est ASCII : sans normalisation, « âge » échappait.
    expect(isDiscriminatoryRequest("Trie par âge")).toBe(true);
    expect(isDiscriminatoryRequest("Sélectionne les célibataires")).toBe(true);
  });

  it("ne court-circuite jamais une question légitime par la voie rapide", () => {
    for (const c of inScope) expect(classifyScope(c.q).verdict, c.q).not.toBe("small_talk");
  });
});
