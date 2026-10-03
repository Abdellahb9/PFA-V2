// Les planchers des candidats existent en SQL (search_candidates) ET en
// TypeScript (re-filtrage côté fonction). Ce test empêche qu'ils divergent.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_CANDIDATE_RELEVANCE, NAME_MATCH_MIN } from "../config";
import { MIGRATIONS_DIR, migrationFiles } from "./helpers";

/** Dernière définition de search_candidates dans l'historique des migrations. */
function latestSearchCandidates(): string {
  for (const file of migrationFiles().reverse()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    const start = sql.indexOf("create or replace function public.search_candidates(");
    if (start !== -1) return sql.slice(start, sql.indexOf("$$;", start));
  }
  throw new Error("search_candidates introuvable");
}

describe("planchers TypeScript ↔ SQL", () => {
  const sql = latestSearchCandidates();

  it("relevance_min", () => {
    expect(sql).toContain(`${MIN_CANDIDATE_RELEVANCE}::real as relevance_min`);
  });

  it("name_match_min", () => {
    expect(sql).toContain(`${NAME_MATCH_MIN}::real as name_match_min`);
  });
});
