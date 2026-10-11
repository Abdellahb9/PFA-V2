// Filtre de périmètre : la plomberie (hors ligne, Groq simulé) et le filet
// déterministe, vérifié contre le jeu d'évaluation étiqueté.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { create, enabled } = vi.hoisted(() => ({
  create: vi.fn(),
  enabled: { value: true },
}));

vi.mock("./groq", () => ({
  EXTRACT_MODEL: "test-model",
  groqEnabled: () => enabled.value,
  groqClient: () => ({ chat: { completions: { create } } }),
}));

import {
  classifierRequestBody,
  classifyScope,
  isDiscriminatoryRequest,
  cannedStream,
  smallTalkReply,
  REFUSALS,
} from "./scope";

interface EvalCase {
  q: string;
  expect: "in" | "small_talk" | "off_topic" | "discriminatory";
  context?: string;
  backstop?: boolean;
}
const CASES: EvalCase[] = JSON.parse(
  readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "eval", "assistant-scope.json"), "utf8"),
).cases;

const answer = (verdict: string) =>
  create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ verdict }) } }] });

beforeEach(() => {
  vi.clearAllMocks();
  enabled.value = true;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

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
  ])("répond à « %s » sans appeler le modèle", async (q) => {
    expect(await classifyScope(q)).toEqual({ verdict: "small_talk", via: "fast_path" });
    expect(create).not.toHaveBeenCalled();
  });

  it("laisse une vraie question passer au classifieur", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '{"verdict":"in"}' } }] });
    expect(await classifyScope("Que peut faire Karim Benali en Rust ?")).toEqual({ verdict: "in", via: "classifier" });
  });
});

describe("smallTalkReply", () => {
  it("salue en présentant ce que l'assistant sait faire — jamais le refus", () => {
    for (const q of ["Bonjour", "Que peux-tu faire ?"]) {
      const r = smallTalkReply(q);
      expect(r).toMatch(/candidat/);
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

describe("classifyScope — filet déterministe", () => {
  it("refuse un classement discriminatoire SANS appeler le modèle", async () => {
    expect(await classifyScope("Classe les candidats par âge")).toEqual({
      verdict: "discriminatory",
      via: "backstop",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("tient même quand le classifieur est en panne ou désactivé", async () => {
    enabled.value = false;
    expect((await classifyScope("Only show me male applicants")).verdict).toBe("discriminatory");
  });
});

describe("classifyScope — classifieur", () => {
  it.each(["in", "off_topic", "discriminatory"])("relaie le verdict « %s »", async (v) => {
    answer(v);
    const r = await classifyScope("Quelle est la capitale du Maroc ?");
    expect(r).toEqual({ verdict: v, via: "classifier" });
  });

  it("transmet la réponse précédente pour juger une relance", async () => {
    answer("in");
    await classifyScope("Et en génie électrique ?", "Les 3 meilleurs en Data Science sont…");
    const sent = create.mock.calls[0][0].messages[1].content as string;
    expect(sent).toContain("Les 3 meilleurs en Data Science");
    expect(sent).toContain("Et en génie électrique ?");
  });

  it("borne le contexte et le message transmis", async () => {
    answer("in");
    await classifyScope("q".repeat(5000), "c".repeat(5000));
    const sent = create.mock.calls[0][0].messages[1].content as string;
    expect(sent.length).toBeLessThan(2700);
  });

  it("demande un JSON strict à température nulle, avec un délai", async () => {
    answer("in");
    await classifyScope("Quelles offres sont ouvertes ?");
    const [body, opts] = create.mock.calls[0];
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it("n'autorise AUCUNE nouvelle tentative du SDK", async () => {
    // Sur un 429, les tentatives automatiques avec délai croissant dépassaient
    // le timeout : l'appel mourait sans statut HTTP. Le filtre doit échouer vite.
    answer("in");
    await classifyScope("Quelles offres sont ouvertes ?");
    expect(create.mock.calls[0][1].maxRetries).toBe(0);
  });
});

describe("classifierRequestBody", () => {
  it("demande un raisonnement court aux modèles gpt-oss", () => {
    const body = classifierRequestBody("openai/gpt-oss-20b", "x") as unknown as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("low");
  });

  it("n'envoie pas ce paramètre à un autre modèle, qui le rejetterait", () => {
    const body = classifierRequestBody("llama-3.3-70b-versatile", "x") as unknown as Record<string, unknown>;
    expect(body).not.toHaveProperty("reasoning_effort");
  });
});

describe("classifyScope — fail-open", () => {
  it("laisse passer si le modèle dépasse le délai", async () => {
    create.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await classifyScope("Quelles offres ?")).toEqual({ verdict: "in", via: "fail_open" });
  });

  it("laisse passer sur un JSON illisible", async () => {
    create.mockResolvedValue({ choices: [{ message: { content: "pas du json" } }] });
    expect((await classifyScope("Quelles offres ?")).via).toBe("fail_open");
  });

  it("laisse passer sur un verdict inconnu", async () => {
    answer("peut-être");
    expect((await classifyScope("Quelles offres ?")).via).toBe("fail_open");
  });

  it("laisse passer sans clé Groq", async () => {
    enabled.value = false;
    expect(await classifyScope("Quelles offres ?")).toEqual({ verdict: "in", via: "fail_open" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("cannedStream", () => {
  it("émet la phrase fixe puis termine, au format de l'agent", async () => {
    const events = [];
    for await (const e of cannedStream("off_topic")) events.push(e);
    expect(events).toEqual([{ type: "delta", text: REFUSALS.off_topic }, { type: "done" }]);
  });

  it("répond à une formule de politesse sans refuser", async () => {
    const events = [];
    for await (const e of cannedStream("small_talk", "bonjour")) events.push(e);
    expect(events).toEqual([{ type: "delta", text: smallTalkReply("bonjour") }, { type: "done" }]);
  });
});

// ---- Jeu d'évaluation, côté déterministe ---------------------------------------

describe("isDiscriminatoryRequest — jeu d'évaluation", () => {
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
});
