// Exemple de bout en bout, hors ligne : on dépose un vrai document de
// politique de stage, on le vectorise, puis on pose une question à l'agent.
//
//   ingestion → découpage → stockage (vraies fonctions SQL, PGlite)
//   → vectorisation (code réel, API Mistral remplacée par un vectoriseur
//     déterministe) → recherche hybride → outil → agent (Groq simulé)
//   → réponse citée + sources SSE
//
// Seuls les deux services EXTERNES sont simulés. Tout le reste est le code de
// production. Pour la même démonstration contre les vrais services :
// `npm run rag:demo` (scripts/rag-demo.ts).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../groq", () => ({
  ASSISTANT_MODEL: "test-model",
  groqEnabled: () => true,
  groqClient: () => ({ chat: { completions: { create } } }),
}));
// Les outils hors documents ne sont pas sollicités ; on coupe Supabase par sûreté.
vi.mock("../../supabase", () => ({
  admin: () => {
    throw new Error("Supabase ne doit pas être appelé dans ce test");
  },
}));

import { createDb, fakeMistralFetch, fixturePages, pgliteStore } from "./helpers";
import { embedPending, ingestPages } from "../ingest";
import { retrieveDocChunks } from "../retrieval";
import { runAgent, type AgentEvent } from "../agent";
import { setStore, type RagStore } from "../store";

let db: PGlite;
let previous: RagStore;

beforeAll(async () => {
  vi.stubEnv("MISTRAL_API_KEY", "test-key");
  vi.stubGlobal("fetch", fakeMistralFetch());
  db = await createDb();
  previous = setStore(pgliteStore(db));
}, 60_000);

afterAll(async () => {
  setStore(previous);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await db?.close();
});

describe("RAG de bout en bout", () => {
  it("1. ingère le document : extraits paginés, en attente de vectorisation", async () => {
    const res = await ingestPages("politique-stage.md", fixturePages("politique-stage.md"), "policy", false);
    expect(res).toMatchObject({ doc_type: "policy", embeddings: "pending" });
    expect(res.chunks).toBeGreaterThanOrEqual(6);
  });

  it("2. vectorise les extraits en attente (tâche de fond)", async () => {
    const before = await pgliteStore(db).listDocuments();
    expect(before[0].embedded).toBe(0);
    const n = await embedPending();
    expect(n).toBe(before[0].chunks);
    expect((await pgliteStore(db).listDocuments())[0].embedded).toBe(n);
    expect(await embedPending()).toBe(0); // idempotent
  });

  it("3. retrouve l'article par les mots (plein-texte)", async () => {
    const [top] = await retrieveDocChunks("durée maximale d'un stage");
    expect(top).toMatchObject({ page: 2, heading: "Article 2 — Durée du stage" });
    expect(top.text).toContain("six mois");
  });

  it("4. retrouve l'article par le sens, sans mot commun", async () => {
    const [top] = await retrieveDocChunks("Combien est payé un interne ?");
    expect(top).toMatchObject({ page: 3, heading: "Article 3 — Gratification" });
    expect(top.similarity).toBeGreaterThan(0);
  });

  it("5. répond à une question, avec citation et sources", async () => {
    let round = 0;
    create.mockImplementation(async (params: { messages: { role: string; content: string }[] }) => {
      round++;
      if (round === 1) {
        // Le modèle choisit l'outil documentaire.
        return (async function* () {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: {
                        name: "search_documents",
                        arguments: JSON.stringify({ query: "durée maximale stage", doc_type: "policy" }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        })();
      }
      // Le modèle répond à partir de ce que l'outil lui a réellement remis.
      const tool = params.messages.find((m) => m.role === "tool")!;
      const { extraits } = JSON.parse(tool.content) as {
        extraits: { source_document: string; page: number; text: string; contenu_non_fiable: boolean }[];
      };
      expect(extraits[0].contenu_non_fiable).toBe(true);
      const best = extraits[0];
      const fact = /six mois/.test(best.text) ? "six mois" : "introuvable";
      return (async function* () {
        yield {
          choices: [
            { delta: { content: `D'après ${best.source_document} (p. ${best.page}), la durée maximale est de ${fact}.` } },
          ],
        };
      })();
    });

    const events: AgentEvent[] = [];
    for await (const e of runAgent([{ role: "user", content: "Quelle est la durée maximale d'un stage ?" }])) {
      events.push(e);
    }

    const answer = events
      .filter((e): e is { type: "delta"; text: string } => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(answer).toBe("D'après politique-stage.md (p. 2), la durée maximale est de six mois.");
    expect(answer).not.toMatch(/Attention/); // la citation est vérifiée

    expect(events.find((e) => e.type === "tool")).toEqual({
      type: "tool",
      name: "search_documents",
      args: { query: "durée maximale stage", doc_type: "policy" },
    });
    const sources = (events.find((e) => e.type === "sources") as { sources: Record<string, unknown>[] })
      .sources;
    expect(sources[0]).toMatchObject({
      type: "doc_chunk",
      source_document: "politique-stage.md",
      page: 2,
      doc_type: "policy",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("6. refuse un second dépôt sous le même nom, accepte le remplacement explicite", async () => {
    const pages = fixturePages("politique-stage.md");
    await expect(ingestPages("politique-stage.md", pages, "policy", false)).rejects.toThrow(/existe déjà/);
    const res = await ingestPages("politique-stage.md", pages.slice(0, 2), "policy", true);
    expect(res.chunks).toBe(2);
  });
});
