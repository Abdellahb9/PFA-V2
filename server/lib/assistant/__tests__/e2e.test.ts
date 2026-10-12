// De bout en bout, hors ligne : base PGlite (vraies migrations, jeu synthétique,
// CV indexés sous le nom de leur candidat) → instantané → agent (Groq simulé)
// → outils → SQL réel → réponse citée + sources SSE.
//
// Seul le modèle de langage est simulé. Pour la même chaîne avec le vrai
// modèle : `npm run eval:rag` (server/scripts/eval-rag.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../groq", () => ({
  ASSISTANT_MODEL: "test-model",
  groqEnabled: () => true,
  groqClient: () => ({ chat: { completions: { create } } }),
}));

import { createAssistantDb, pgliteRpc } from "./helpers";
import { runAgent, type AgentEvent } from "../agent";
import { setRpcClient, type RpcClient } from "../../rpc";

let db: PGlite;
let previous: RpcClient;

beforeAll(async () => {
  ({ db } = await createAssistantDb());
  previous = setRpcClient(pgliteRpc(db));
}, 90_000);

afterAll(async () => {
  setRpcClient(previous);
  await db?.close();
});

type Msg = { role: string; content: string };
const reply = (text: string) =>
  (async function* () {
    yield { choices: [{ delta: { content: text } }] };
  })();
const callTool = (name: string, args: unknown) =>
  (async function* () {
    yield {
      choices: [
        { delta: { tool_calls: [{ index: 0, id: "c1", function: { name, arguments: JSON.stringify(args) } }] } },
      ],
    };
  })();

async function ask(question: string) {
  const events: AgentEvent[] = [];
  for await (const e of runAgent([{ role: "user", content: question }])) events.push(e);
  return {
    events,
    answer: events.filter((e): e is { type: "delta"; text: string } => e.type === "delta").map((e) => e.text).join(""),
    sources: ((events.find((e) => e.type === "sources") as { sources?: Record<string, unknown>[] })?.sources ?? []),
  };
}

describe("assistant de bout en bout", () => {
  it("répond « combien de candidats ? » depuis l'instantané, sans outil", async () => {
    create.mockReset();
    create.mockImplementation(async (p: { messages: Msg[] }) => {
      // Le modèle lit le chiffre dans l'instantané qu'on lui a remis.
      const snapshot = p.messages[1].content;
      const n = snapshot.match(/(\d+) candidats,/)?.[1] ?? "?";
      return reply(`Nous avons ${n} candidats.`);
    });
    const { answer, events } = await ask("Combien de candidats avons-nous ?");
    expect(answer).toBe("Nous avons 8 candidats.");
    expect(events.some((e) => e.type === "tool")).toBe(false);
    const snapshot = (create.mock.calls[0][0] as { messages: Msg[] }).messages[1].content;
    expect(snapshot).toContain("dont 3 avec un CV indexé");
    expect(snapshot).toContain("#"); // le registre, une ligne par candidat
    expect(snapshot).toMatch(/Hajar Ait Ouarab — Électromécanique.*affectation confirmée/);
  });

  it("répond sur un CV avec citation et sources", async () => {
    create.mockReset();
    let round = 0;
    create.mockImplementation(async (p: { messages: Msg[] }) => {
      if (round++ === 0) {
        return callTool("search_cvs", { query: "logiciels de simulation", candidate: "Yasmine El Amrani" });
      }
      const tool = p.messages.find((m) => m.role === "tool")!;
      const { extraits } = JSON.parse(tool.content) as {
        extraits: { document: string; page: number; texte: string; contenu_non_fiable: boolean }[];
      };
      expect(extraits.every((e) => e.contenu_non_fiable)).toBe(true);
      const best = extraits.find((e) => /FlexSim/.test(e.texte))!;
      return reply(`Arena et FlexSim (${best.document}, p. ${best.page}).`);
    });
    const { answer, sources, events } = await ask("Quels logiciels de simulation Yasmine maîtrise-t-elle ?");
    expect(answer).toBe("Arena et FlexSim (CV — Yasmine El Amrani, p. 2).");
    expect(answer).not.toMatch(/Attention/);
    expect(sources).toContainEqual(
      expect.objectContaining({ type: "doc_chunk", title: "CV — Yasmine El Amrani", page: 2 }),
    );
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("rend le dossier d'un candidat : candidature, résultat, affectation", async () => {
    create.mockReset();
    let round = 0;
    create.mockImplementation(async (p: { messages: Msg[] }) => {
      if (round++ === 0) return callTool("get_candidate", { candidate: "Hajar" });
      const { dossier } = JSON.parse(p.messages.find((m) => m.role === "tool")!.content);
      const app = dossier.applications[0];
      return reply(`${dossier.name} est affectée au « ${app.assignment.offer} » à partir du ${app.start_date}.`);
    });
    const { answer, sources } = await ask("Où en est Hajar ?");
    expect(answer).toBe("Hajar Ait Ouarab est affectée au « Stage Automatisme & GMAO » à partir du 2026-11-01.");
    expect(sources).toEqual([expect.objectContaining({ type: "candidate_dossier", name: "Hajar Ait Ouarab" })]);
  });
});
