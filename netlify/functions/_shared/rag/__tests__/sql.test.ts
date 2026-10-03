// Migration 0019 exécutée sur une vraie base Postgres (PGlite + pgvector +
// pg_trgm), par-dessus l'historique RÉEL des migrations 0001 → 0018.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyMigrations,
  conceptEmbedding,
  createDb,
  MIGRATIONS_DIR,
  pgliteStore,
} from "./helpers";
import { MIN_COSINE, MIN_FTS_RANK, RRF_K } from "../config";
import { DocumentExistsError, type RagStore } from "../store";

let db: PGlite;
let store: RagStore;

// ---- Jeu de candidats, posé AVANT 0019 pour comparer les deux versions -------------

const PEOPLE = [
  ["Youssef", "El Khattabi", "Génie informatique", "Bac+5", 2, ["python", "django", "sql"]],
  ["Babtich", "El Habib", "Génie électrique", "Bac+3", 0, ["automatisme", "plc"]],
  ["Meriem", "Bedda", "Data science", "Bac+5", 1, ["python", "machine learning"]],
  ["Salma", "Ait Brahim", "Génie des procédés", "Bac+4", 3, ["chimie", "hse"]],
  ["Omar", "Benali", "Informatique", "Bac+2", 0, ["javascript", "react"]],
] as const;

const QUERIES: [string, number | null, string | null][] = [
  ["python", null, null],
  ["Quelle filière de Babtich El Habib ?", null, null],
  ["babtich habib", null, null],
  ["bedda", null, null],
  ["machine learning", 1, null],
  ["python", null, "Bac+5"],
  ["", null, "Bac+5"],
  ["", 2, null],
  ["Youssef Khattaby", null, null], // faute de frappe sur le nom
  ["poterie", null, null],
];

async function seedCandidates(d: PGlite) {
  for (const [first, last, field, level, years, skills] of PEOPLE) {
    const res = await d.query<{ id: number }>(
      `insert into public.candidates (first_name, last_name, email, field_of_study,
         education_level, years_experience, cv_text)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [first, last, `${first}@x.ma`.toLowerCase(), field, level, years, `CV de ${first} ${last}`],
    );
    for (const skill of skills) {
      const s = await d.query<{ id: number }>(
        `insert into public.skills (name, normalized) values ($1, $1)
         on conflict (normalized) do update set name = excluded.name returning id`,
        [skill],
      );
      await d.query(`insert into public.candidate_skills (candidate_id, skill_id) values ($1, $2)`, [
        res.rows[0].id,
        s.rows[0].id,
      ]);
    }
  }
}

async function searchAll(d: PGlite, fn: string) {
  const out: unknown[] = [];
  for (const [q, years, edu] of QUERIES) {
    const r = await d.query(`select * from public.${fn}($1, $2, $3, 20)`, [q, years, edu]);
    out.push(r.rows);
  }
  return out;
}

/**
 * La version 0017 de search_candidates (balayage complet de la table), avec la
 * même construction de requête que 0019 : sert de RÉFÉRENCE pour prouver que
 * le pré-filtre indexé n'écarte aucun candidat que l'ancien calcul aurait gardé.
 */
function referenceSearchSql(): string {
  const src = readFileSync(join(MIGRATIONS_DIR, "0017_candidate_relevance.sql"), "utf8");
  const start = src.indexOf("create or replace function public.search_candidates(");
  const end = src.indexOf("$;", start) + 3;
  return src
    .slice(start, end)
    .replace("public.search_candidates(", "public.search_candidates_ref(")
    .replace("public.rag_tsquery(q)", "public.rag_tsquery(public.rag_name_core(q))");
}

beforeAll(async () => {
  // Candidats posés AVANT 0019 : l'index trigramme se construit sur des lignes existantes.
  db = await createDb("0018_document_type.sql");
  await seedCandidates(db);
  await applyMigrations(db, (f) => f > "0018_document_type.sql");
  await db.exec(referenceSearchSql());
  store = pgliteStore(db);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("migration 0019 — schéma", () => {
  it("supprime l'ancienne base documentaire et ses fonctions", async () => {
    const r = await db.query<{ t: string | null; f: string | null }>(
      `select to_regclass('public.document_chunks')::text as t,
              to_regprocedure('public.search_document_chunks(text,int,text)')::text as f`,
    );
    expect(r.rows[0]).toEqual({ t: null, f: null });
  });

  it("crée un index HNSW cosinus et un index GIN plein-texte", async () => {
    const r = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'rag_chunks' order by indexname`,
    );
    const defs = r.rows.map((x) => x.indexdef).join("\n");
    expect(defs).toMatch(/USING hnsw \(embedding extensions\.vector_cosine_ops\)/);
    expect(defs).toMatch(/USING gin \(search_vector\)/);
  });

  it("ne laisse les fonctions qu'au rôle de service", async () => {
    const r = await db.query<{ anon: boolean; service: boolean }>(
      `select has_function_privilege('anon', 'public.rag_replace_document(text,text,jsonb,boolean)', 'execute') as anon,
              has_function_privilege('service_role', 'public.rag_replace_document(text,text,jsonb,boolean)', 'execute') as service`,
    );
    expect(r.rows[0]).toEqual({ anon: false, service: true });
  });
});

describe("search_candidates — pré-filtre indexé", () => {
  it("renvoie EXACTEMENT les mêmes résultats que le balayage complet de 0017", async () => {
    const reference = await searchAll(db, "search_candidates_ref");
    const actual = await searchAll(db, "search_candidates");
    QUERIES.forEach(([q, years, edu], i) => {
      expect(actual[i], JSON.stringify({ q, years, edu })).toEqual(reference[i]);
    });
    // Le jeu de questions doit réellement exercer les deux branches.
    expect(reference.filter((rows) => (rows as unknown[]).length > 0).length).toBeGreaterThan(5);
  });

  it("applique enfin l'exclusion « -mot » (0017 l'ignorait : pas de test @@)", async () => {
    const ref = await db.query<{ name: string }>(
      "select name from public.search_candidates_ref('chimie -hse', null, null, 20)",
    );
    const now = await db.query<{ name: string }>(
      "select name from public.search_candidates('chimie -hse', null, null, 20)",
    );
    expect(ref.rows.map((r) => r.name)).toContain("Salma Ait Brahim"); // a « hse » : à tort
    expect(now.rows.map((r) => r.name)).not.toContain("Salma Ait Brahim");
  });

  it("ne garde plus aucun mot vide ni interrogatif dans la requête", async () => {
    const r = await db.query<{ t: string }>("select public.rag_tsquery('Quelle est la durée ?')::text as t");
    expect(r.rows[0].t).not.toMatch(/'(est|la|quell?|quel)'/);
    expect(r.rows[0].t).toMatch(/dur/);
  });

  it("retrouve un nom malgré une faute de frappe (branche trigrammes)", async () => {
    const r = await db.query<{ name: string }>(
      "select name from public.search_candidates('Youssef Khattaby', null, null, 5)",
    );
    expect(r.rows.map((x) => x.name)).toContain("Youssef El Khattabi");
  });

  it("n'attribue plus un homonyme partiel sur une particule (El)", async () => {
    const r = await db.query<{ name: string }>(
      "select name from public.search_candidates('Quelle filière de Babtich El Habib ?', null, null, 5)",
    );
    expect(r.rows.map((x) => x.name)).toEqual(["Babtich El Habib"]);
  });
});

describe("rag_replace_document — ingestion atomique", () => {
  const chunks = [
    { content: "La durée maximale d'un stage est de six mois.", page: 2, heading: "Durée" },
    { content: "   ", page: 2, heading: null },
    { content: "La gratification est de 3 000 dirhams.", page: 3, heading: "Gratification" },
  ];

  it("enregistre les extraits non vides, renumérotés sans trou", async () => {
    const res = await store.replaceDocument("atomic.pdf", "policy", chunks, false);
    expect(res.chunks).toBe(2);
    const r = await db.query<{ chunk_index: number; page: number }>(
      `select c.chunk_index, c.page from public.rag_chunks c
         join public.rag_documents d on d.id = c.document_id
        where d.name = 'atomic.pdf' order by c.chunk_index`,
    );
    expect(r.rows).toEqual([
      { chunk_index: 0, page: 2 },
      { chunk_index: 1, page: 3 },
    ]);
  });

  it("refuse un nom existant sans replace (409), dans la même transaction", async () => {
    await expect(store.replaceDocument("atomic.pdf", "policy", chunks, false)).rejects.toBeInstanceOf(
      DocumentExistsError,
    );
    // Rien n'a bougé.
    expect((await store.listDocuments()).find((d) => d.source_document === "atomic.pdf")?.chunks).toBe(2);
  });

  it("remplace avec replace=true, type compris", async () => {
    const res = await store.replaceDocument("atomic.pdf", "other", chunks.slice(0, 1), true);
    expect(res.chunks).toBe(1);
    const doc = (await store.listDocuments()).find((d) => d.source_document === "atomic.pdf");
    expect(doc).toMatchObject({ chunks: 1, doc_type: "other", embedded: 0 });
  });

  it("rejette un doc_type invalide", async () => {
    await expect(store.replaceDocument("x.pdf", "memo" as never, chunks, false)).rejects.toThrow(
      /doc_type invalide/,
    );
  });

  it("supprime un document et ses extraits en cascade", async () => {
    expect(await store.deleteDocument("atomic.pdf")).toBe(true);
    expect(await store.deleteDocument("atomic.pdf")).toBe(false);
    const r = await db.query<{ n: number }>("select count(*)::int as n from public.rag_chunks");
    expect(r.rows[0].n).toBe(0);
  });
});

describe("rag_search_chunks — recherche hybride", () => {
  const params = (query: string, embedding: number[] | null, docType: "policy" | "cv" | null = null) => ({
    query,
    embedding,
    matchCount: 10,
    docType,
    minFts: MIN_FTS_RANK,
    minCosine: MIN_COSINE,
    rrfK: RRF_K,
  });

  beforeAll(async () => {
    await store.replaceDocument(
      "politique.pdf",
      "policy",
      [
        { content: "La durée maximale d'un stage est fixée à six mois.", page: 2, heading: "Durée du stage" },
        { content: "Le stagiaire perçoit une gratification mensuelle de 3 000 dirhams.", page: 3, heading: "Gratification" },
        { content: "Le stagiaire est couvert par l'assurance accidents du travail.", page: 4, heading: "Assurance" },
      ],
      false,
    );
    await store.replaceDocument(
      "cv-meriem.pdf",
      "cv",
      [{ content: "Meriem Bedda, stage de fin d'études en data science, six mois.", page: 1, heading: null }],
      false,
    );
    const pending = await store.pendingChunks(100);
    expect(pending).toHaveLength(4);
    const n = await store.setEmbeddings(
      pending.map((c) => ({ id: c.id, embedding: conceptEmbedding(`${c.heading ?? ""} ${c.content}`) })),
    );
    expect(n).toBe(4);
    expect(await store.pendingChunks(100)).toEqual([]);
  });

  it("plein-texte seul quand il n'y a pas de vecteur de requête", async () => {
    const rows = await store.searchChunks(params("durée maximale du stage", null));
    expect(rows[0]).toMatchObject({ source_document: "politique.pdf", page: 2, cosine: null });
    expect(rows[0].fts_rank).toBeGreaterThan(0);
  });

  it("retrouve par le SENS un passage sans aucun mot commun", async () => {
    const q = "Combien est payé un interne ?";
    // Aucun terme en commun : le plein-texte seul ne trouve pas l'article.
    const lexical = await store.searchChunks(params(q, null));
    expect(lexical.some((r) => r.heading === "Gratification")).toBe(false);

    const hybrid = await store.searchChunks(params(q, conceptEmbedding(q)));
    expect(hybrid[0]).toMatchObject({ heading: "Gratification", page: 3 });
    expect(hybrid[0].cosine).toBeGreaterThanOrEqual(MIN_COSINE);
  });

  it("place en tête l'extrait retenu par les DEUX classements", async () => {
    const q = "durée du stage";
    const rows = await store.searchChunks(params(q, conceptEmbedding(q)));
    expect(rows[0]).toMatchObject({ heading: "Durée du stage" });
    expect(rows[0].fts_rank).toBeGreaterThan(0);
    expect(rows[0].cosine).not.toBeNull();
  });

  it("filtre par type de document", async () => {
    const q = "stage six mois";
    const cvOnly = await store.searchChunks(params(q, conceptEmbedding(q), "cv"));
    expect(cvOnly.length).toBeGreaterThan(0);
    expect(cvOnly.every((r) => r.doc_type === "cv")).toBe(true);
  });

  it("ne renvoie rien pour une question faite de mots vides et sans vecteur", async () => {
    expect(await store.searchChunks(params("quelle est la", null))).toEqual([]);
  });

  it("respecte l'exclusion « -mot »", async () => {
    const rows = await store.searchChunks(params("stage -gratification", null));
    expect(rows.some((r) => r.content.includes("gratification"))).toBe(false);
  });
});
