// Récupération : ce qui part vers Postgres et ce qui en revient.
//
// Ces chemins n'avaient aucun test alors qu'ils portaient les défauts les plus
// coûteux : table entière rapatriée, filtres appliqués en mémoire, et pertinence
// normalisée sur le meilleur résultat (donc toujours 100 % en tête de liste).
import { describe, expect, it, vi, beforeEach } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ admin: () => ({ rpc }) }));

import { MIN_RELEVANCE, retrieveCandidates, retrieveDocChunks } from "./rag";

const ok = (data: unknown) => ({ data, error: null });

beforeEach(() => vi.clearAllMocks());

describe("retrieveCandidates", () => {
  const row = (id: number, rank: number) => ({
    candidate_id: id,
    name: `Candidat ${id}`,
    education_level: "Bac+5",
    field_of_study: "Informatique",
    years_experience: "3",
    skills: ["python", "sql"],
    rank,
  });

  it("délègue les filtres à SQL au lieu de les appliquer après coup", async () => {
    rpc.mockResolvedValue(ok([row(1, 0.42)]));

    await retrieveCandidates("python", {
      minYearsExperience: 2,
      educationLevel: "Bac+5",
      topK: 7,
    });

    expect(rpc).toHaveBeenCalledWith("search_candidates", {
      q: "python",
      min_years: 2,
      education: "Bac+5",
      top_k: 7,
    });
  });

  it("publie le rang absolu renvoyé par Postgres", async () => {
    rpc.mockResolvedValue(ok([row(1, 0.42), row(2, 0.11)]));

    const { results } = await retrieveCandidates("python");

    // Surtout pas 1.0 : le premier résultat ne doit plus être « 100 % » d'office.
    expect(results[0].similarity).toBe(0.42);
    expect(results[1].similarity).toBe(0.11);
    expect(results[0].years_experience).toBe(3); // numeric -> string -> number
  });

  it("ne demande le diagnostic que si la recherche est vide", async () => {
    rpc.mockResolvedValue(ok([row(1, 0.4)]));
    await retrieveCandidates("python");
    expect(rpc).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === "search_candidates"
          ? ok([])
          : ok([
              {
                scanned: 12,
                term_matches: 4,
                excluded_by_years: 4,
                excluded_by_education: 0,
                experience_unknown: 3,
              },
            ]),
      ),
    );

    const { results, diag } = await retrieveCandidates("python", { minYearsExperience: 5 });

    expect(results).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(diag).toMatchObject({ scanned: 12, termMatches: 4, excludedByYears: 4, minYears: 5 });
  });

  it("un diagnostic en échec ne fait pas échouer la recherche", async () => {
    rpc.mockImplementation((fn: string) =>
      fn === "search_candidates"
        ? Promise.resolve(ok([]))
        : Promise.resolve({ data: null, error: { message: "boom" } }),
    );

    const { results, diag } = await retrieveCandidates("python");

    expect(results).toEqual([]);
    expect(diag.scanned).toBe(0);
  });

  it("remonte une erreur de la recherche elle-même", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation absente" } });
    await expect(retrieveCandidates("python")).rejects.toThrow("relation absente");
  });
});

describe("retrieveDocChunks", () => {
  const chunk = (index: number, rank: number, doc = "politique.pdf") => ({
    source_document: doc,
    chunk_index: index,
    chunk_text: `Extrait ${index}`,
    rank,
  });

  it("écarte les extraits sous le seuil de pertinence", async () => {
    rpc.mockResolvedValue(ok([chunk(0, 0.4), chunk(5, MIN_RELEVANCE / 2)]));

    const chunks = await retrieveDocChunks("duree du stage");

    expect(chunks).toHaveLength(1);
    expect(chunks[0].similarity).toBe(0.4);
  });

  it("ne normalise plus sur le meilleur résultat", async () => {
    rpc.mockResolvedValue(ok([chunk(0, 0.2), chunk(4, 0.1)]));

    const chunks = await retrieveDocChunks("duree");

    expect(chunks[0].similarity).toBe(0.2); // et non 1.0
    expect(chunks[1].similarity).toBe(0.1);
  });

  it("déduplique les extraits voisins d'un même document", async () => {
    // 0 et 1 se recouvrent de CHUNK_OVERLAP caractères : n'en garder qu'un.
    rpc.mockResolvedValue(ok([chunk(0, 0.5), chunk(1, 0.4), chunk(9, 0.3)]));

    const chunks = await retrieveDocChunks("duree");

    expect(chunks.map((c) => c.chunk_index)).toEqual([0, 9]);
  });

  it("garde le même index s'il vient d'un autre document", async () => {
    rpc.mockResolvedValue(ok([chunk(3, 0.5, "a.pdf"), chunk(3, 0.4, "b.pdf")]));
    expect(await retrieveDocChunks("duree")).toHaveLength(2);
  });

  it("renvoie une liste vide quand rien ne correspond", async () => {
    rpc.mockResolvedValue(ok([]));
    expect(await retrieveDocChunks("xyzzy")).toEqual([]);
  });
});
