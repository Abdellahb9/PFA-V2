// Vecteurs Gemini : migration 0022 (1024 → 768 dimensions) et recherche par le
// sens de bout en bout — client réel, API remplacée par le vectoriseur
// déterministe (fakeGeminiFetch), SQL réel sur PGlite.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrations, createDb, fakeGeminiFetch, fixturePages, pgliteStore } from "./helpers";
import { EMBED_DIM } from "../config";
import { embedPending, ingestPages } from "../ingest";
import { retrieveDocChunks } from "../retrieval";
import { setStore, type RagStore } from "../store";

const dimOf = async (db: PGlite) =>
  (
    await db.query<{ d: number }>(
      `select atttypmod as d from pg_attribute
        where attrelid = 'public.rag_chunks'::regclass and attname = 'embedding'`,
    )
  ).rows[0].d;

describe("migration 0022 — vecteurs Gemini", () => {
  it("efface les vecteurs Mistral (1024) et passe la colonne en 768", async () => {
    const db = await createDb("0021_candidate_knowledge.sql");
    try {
      await db.query("select public.rag_replace_document('a.pdf', 'other', $1::jsonb, false)", [
        JSON.stringify([{ content: "texte", page: 1, heading: null }]),
      ]);
      await db.query("update public.rag_chunks set embedding = $1::extensions.vector, embedded_at = now()", [
        JSON.stringify(new Array(1024).fill(0.01)),
      ]);
      await applyMigrations(db, (f) => f.startsWith("0022_"));
      expect(await dimOf(db)).toBe(768);
      const r = await db.query<{ pending: number }>(
        "select count(*)::int as pending from public.rag_chunks where embedding is null and embedded_at is null",
      );
      expect(r.rows[0].pending).toBe(1); // à revectoriser, toujours trouvable en plein-texte
    } finally {
      await db.close();
    }
  }, 60_000);

  it("ne touche à rien au rejeu : les vecteurs Gemini restent", async () => {
    const db = await createDb();
    try {
      await db.query("select public.rag_replace_document('b.pdf', 'other', $1::jsonb, false)", [
        JSON.stringify([{ content: "texte", page: 1, heading: null }]),
      ]);
      await db.query("update public.rag_chunks set embedding = $1::extensions.vector, embedded_at = now()", [
        JSON.stringify(new Array(768).fill(0.01)),
      ]);
      await applyMigrations(db, (f) => f.startsWith("0022_"));
      const r = await db.query<{ n: number }>("select count(embedding)::int as n from public.rag_chunks");
      expect(r.rows[0].n).toBe(1);
    } finally {
      await db.close();
    }
  }, 60_000);
});

describe("recherche par le sens, de bout en bout", () => {
  let db: PGlite;
  let previous: RagStore;

  beforeAll(async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", fakeGeminiFetch());
    db = await createDb();
    previous = setStore(pgliteStore(db));
    await ingestPages("cv-yasmine.pdf", fixturePages("cv-yasmine-el-amrani.md"), "cv", false, {
      headingTitle: "Yasmine El Amrani",
    });
  }, 60_000);

  afterAll(async () => {
    setStore(previous);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await db?.close();
  });

  it("vectorise les extraits en attente, en 768 dimensions", async () => {
    const n = await embedPending();
    expect(n).toBeGreaterThan(0);
    expect(EMBED_DIM).toBe(768);
    expect(await embedPending()).toBe(0); // idempotent
  });

  it("retrouve un passage sans aucun mot commun avec la question", async () => {
    // « idiomes » n'apparaît nulle part : seul le vecteur rapproche la question de « LANGUES ».
    const [top] = await retrieveDocChunks("Quels idiomes pratique-t-elle ?");
    expect(top.text).toContain("Arabe");
    expect(top.page).toBe(2);
    expect(top.similarity).toBeGreaterThan(0);
  });
});
