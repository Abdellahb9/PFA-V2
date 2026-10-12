// Base de test de l'assistant : les VRAIES migrations sur PGlite, le jeu de
// données synthétique (__fixtures__/seed.sql), et les CV de lib/rag/__fixtures__
// indexés et rattachés à leur candidat — exactement comme le fait analyze-cv.
//
// Sert aux tests SQL des RPC et à l'évaluation (scripts/eval-rag.ts) : tout
// l'assistant tourne alors sans Supabase.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PGlite } from "@electric-sql/pglite";
import { createDb, fixturePages, pgliteStore } from "../../rag/__tests__/helpers";
import { cvDocumentName, cvTitle, ingestPages } from "../../rag/ingest";
import { setStore } from "../../rag/store";
import { RpcError, type RpcClient } from "../../rpc";

const here = fileURLToPath(new URL(".", import.meta.url));
export const SEED_FILE = join(here, "..", "__fixtures__", "seed.sql");

/** Les CV du corpus de test, et la personne à qui chacun appartient. */
export const SEED_CVS = [
  { email: "yasmine.elamrani@example.com", file: "cv-yasmine-el-amrani.md" },
  { email: "karim.benali@example.com", file: "resume-karim-benali.md" },
  { email: "hajar.aitouarab@example.com", file: "cv-hajar-ait-ouarab.txt" },
];
/** Document qui n'est pas un CV : le compte rendu du jury. */
export const SEED_OTHER_DOCS = [{ name: "compte-rendu-jury-2026.docx", file: "compte-rendu-jury-2026.md" }];

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Client RPC sur PGlite, au format de PostgREST : valeur pour une fonction
 * scalaire, tableau pour une fonction ensembliste (setof jsonb → tableau de
 * valeurs, returns table → tableau de lignes).
 */
export function pgliteRpc(db: PGlite): RpcClient {
  const retset = new Map<string, boolean>();
  return {
    async call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
      if (!IDENT.test(fn)) throw new RpcError(fn, "nom de fonction invalide");
      if (!retset.has(fn)) {
        const meta = await db.query<{ proretset: boolean }>(
          `select p.proretset from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = $1 limit 1`,
          [fn],
        );
        if (!meta.rows.length) throw new RpcError(fn, "fonction inconnue");
        retset.set(fn, meta.rows[0].proretset);
      }
      const keys = Object.keys(args).filter((k) => args[k] !== undefined && IDENT.test(k));
      const params = keys.map((k) => {
        const v = args[k];
        return v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : v;
      });
      const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
      let res;
      try {
        res = await db.query<Record<string, unknown>>(sql, params);
      } catch (err) {
        const e = err as { message?: string; code?: string };
        throw new RpcError(fn, e.message ?? String(err), e.code);
      }
      const single = res.fields.length === 1 && res.fields[0].name === fn;
      if (retset.get(fn)) return (single ? res.rows.map((r) => r[fn]) : res.rows) as T;
      return (single ? (res.rows[0]?.[fn] ?? null) : res.rows) as T;
    },
  };
}

/** Identifiants des candidats du jeu de données, par e-mail. */
export async function candidateIds(db: PGlite): Promise<Record<string, number>> {
  const r = await db.query<{ id: number; email: string }>("select id::int as id, email from public.candidates");
  return Object.fromEntries(r.rows.map((x) => [x.email, x.id]));
}

/**
 * Base complète : migrations + seed + CV indexés (plein-texte ; les vecteurs
 * dépendent de MISTRAL_API_KEY ou d'un faux vectoriseur, au choix de l'appelant).
 * Installe aussi le stockage RAG PGlite (setStore) ; l'appelant installe le
 * client RPC s'il en a besoin (setRpcClient(pgliteRpc(db))).
 */
export async function createAssistantDb(): Promise<{ db: PGlite; ids: Record<string, number> }> {
  const db = await createDb();
  await db.exec(readFileSync(SEED_FILE, "utf8"));
  setStore(pgliteStore(db));
  const ids = await candidateIds(db);
  for (const cv of SEED_CVS) {
    const id = ids[cv.email];
    const r = await db.query<{ name: string }>(
      "select trim(first_name || ' ' || last_name) as name from public.candidates where id = $1",
      [id],
    );
    const name = r.rows[0].name;
    await ingestPages(cvDocumentName(id), fixturePages(cv.file), "cv", true, {
      candidateId: id,
      title: cvTitle(name),
      headingTitle: name,
    });
  }
  for (const doc of SEED_OTHER_DOCS) {
    await ingestPages(doc.name, fixturePages(doc.file), "other", true);
  }
  return { db, ids };
}
