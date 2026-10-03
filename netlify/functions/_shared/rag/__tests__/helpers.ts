// Outils de test du RAG : une vraie base Postgres en mémoire (PGlite, avec
// pgvector et pg_trgm) sur laquelle on joue les VRAIES migrations, un
// vectoriseur déterministe et un RagStore qui appelle les VRAIES fonctions SQL.
//
// Rien n'est simulé côté SQL : un test vert ici signifie que la migration 0019
// s'applique sur l'historique réel et que ses fonctions répondent comme prévu.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { vector } from "@electric-sql/pglite-pgvector";
import { EMBED_DIM } from "../config";
import { DocumentExistsError, type RagStore } from "../store";
import type { DocType, KnowledgeDocument, SearchRow } from "../types";

const here = fileURLToPath(new URL(".", import.meta.url));
export const MIGRATIONS_DIR = join(here, "..", "..", "..", "..", "..", "supabase", "migrations");
export const FIXTURES_DIR = join(here, "..", "__fixtures__");

/** Ce que Supabase fournit et que les migrations supposent présent. */
const SUPABASE_STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text,
    raw_user_meta_data jsonb, raw_app_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid, bucket_id text, name text, owner uuid);
  create schema extensions;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

/** Base neuve, migrations appliquées jusqu'à `until` inclus (toutes par défaut). */
export async function createDb(until?: string): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { vector, pg_trgm } });
  await db.exec(SUPABASE_STUBS);
  await applyMigrations(db, (f) => !until || f <= until);
  return db;
}

export async function applyMigrations(db: PGlite, keep: (file: string) => boolean): Promise<void> {
  for (const file of migrationFiles().filter(keep)) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
}

// ---- Vectoriseur déterministe -----------------------------------------------------
//
// Un vrai modèle rapproche « salaire » de « gratification ». Ce faux modèle le
// fait par un petit dictionnaire de concepts : chaque concept occupe une
// dimension, et tout mot hors dictionnaire est ignoré. Suffisant pour prouver
// que la branche vectorielle retrouve un passage SANS mot commun avec la question.

const CONCEPTS: Record<string, string[]> = {
  pay: ["gratification", "remuneration", "salaire", "paye", "payee", "indemnite", "argent"],
  duration: ["duree", "longtemps", "combien de temps", "mois", "semaines"],
  intern: ["stage", "stagiaire", "stagiaires", "interne", "internes", "internship", "intern"],
  insurance: ["assurance", "accident", "couverture", "responsabilite"],
  leave: ["conge", "conges", "absence", "absences", "jours"],
  hours: ["horaire", "horaires", "heures", "temps de travail"],
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export function conceptEmbedding(text: string): number[] {
  const v = new Array<number>(EMBED_DIM).fill(0);
  const t = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  Object.values(CONCEPTS).forEach((words, dim) => {
    for (const w of words) if (t.includes(` ${w} `)) v[dim] += 1;
  });
  // Dimension « bruit de fond » : un texte sans concept n'est pas un vecteur nul.
  v[EMBED_DIM - 1] = 0.05;
  const norm = Math.hypot(...v);
  return v.map((x) => x / norm);
}

/** Remplace `fetch` vers l'API Mistral par le vectoriseur déterministe. */
export function fakeMistralFetch(): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { input: string[] };
    return new Response(
      JSON.stringify({
        data: body.input.map((text, index) => ({ index, embedding: conceptEmbedding(text) })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

// ---- RagStore adossé aux vraies fonctions SQL ---------------------------------------

export function pgliteStore(db: PGlite): RagStore {
  const num = (v: unknown) => Number(v ?? 0);
  return {
    async replaceDocument(name, docType, chunks, replace) {
      try {
        const res = await db.query<{ r: { document_id: number; chunks: number } }>(
          "select public.rag_replace_document($1, $2, $3::jsonb, $4) as r",
          [name, docType, JSON.stringify(chunks), replace],
        );
        return { documentId: num(res.rows[0].r.document_id), chunks: num(res.rows[0].r.chunks) };
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw new DocumentExistsError(name);
        throw err;
      }
    },
    async pendingChunks(limit) {
      const res = await db.query<{ id: number; content: string; heading: string | null }>(
        "select * from public.rag_pending_chunks($1)",
        [limit],
      );
      return res.rows.map((r) => ({ ...r, id: num(r.id) }));
    },
    async setEmbeddings(items) {
      const res = await db.query<{ n: number }>("select public.rag_set_embeddings($1::jsonb) as n", [
        JSON.stringify(items),
      ]);
      return num(res.rows[0].n);
    },
    async searchChunks(p) {
      const res = await db.query<Record<string, unknown>>(
        `select * from public.rag_search_chunks($1, $2::extensions.vector, $3, $4, $5, $6, $7)`,
        [
          p.query,
          p.embedding ? JSON.stringify(p.embedding) : null,
          p.matchCount,
          p.docType,
          p.minFts,
          p.minCosine,
          p.rrfK,
        ],
      );
      return res.rows.map(
        (r): SearchRow => ({
          chunk_id: num(r.chunk_id),
          source_document: String(r.source_document),
          doc_type: r.doc_type as DocType,
          chunk_index: num(r.chunk_index),
          page: r.page == null ? null : num(r.page),
          heading: (r.heading as string | null) ?? null,
          content: String(r.content),
          fts_rank: num(r.fts_rank),
          cosine: r.cosine == null ? null : num(r.cosine),
          score: num(r.score),
        }),
      );
    },
    async listDocuments() {
      const res = await db.query<Record<string, unknown>>("select * from public.rag_list_documents()");
      return res.rows.map(
        (r): KnowledgeDocument => ({
          source_document: String(r.source_document),
          chunks: num(r.chunks),
          doc_type: r.doc_type as DocType,
          embedded: num(r.embedded),
        }),
      );
    },
    async deleteDocument(name) {
      const res = await db.query<{ ok: boolean }>("select public.rag_delete_document($1) as ok", [
        name,
      ]);
      return res.rows[0].ok === true;
    },
    async countChunks() {
      const res = await db.query<{ n: number }>("select count(*)::int as n from public.rag_chunks");
      return num(res.rows[0].n);
    },
  };
}

/** Pages d'un fixture : une ligne « <!-- page --> » sépare deux pages (comme un PDF). */
export function fixturePages(file: string): { page: number; text: string }[] {
  return readFileSync(join(FIXTURES_DIR, file), "utf8")
    .split(/^<!-- page -->$/m)
    .map((text, i) => ({ page: i + 1, text }))
    .filter((p) => p.text.trim() !== "");
}
