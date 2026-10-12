// RPC de l'assistant (migration 0021), exécutées sur les vraies migrations et le
// jeu de données synthétique. Chaque question de la transcription de production
// qui avait échoué (« combien de candidats ? », « et les CV ? ») a ici sa réponse
// côté données.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createAssistantDb, pgliteRpc } from "./helpers";
import { retrieveDocChunks } from "../../rag/retrieval";
import { setRpcClient, rpc, type RpcClient } from "../../rpc";

let db: PGlite;
let ids: Record<string, number>;
let previous: RpcClient;

const id = (email: string) => ids[email];
const YASMINE = "yasmine.elamrani@example.com";
const KARIM = "karim.benali@example.com";
const HAJAR = "hajar.aitouarab@example.com";

beforeAll(async () => {
  ({ db, ids } = await createAssistantDb());
  previous = setRpcClient(pgliteRpc(db));
}, 90_000);

afterAll(async () => {
  setRpcClient(previous);
  await db?.close();
});

type Row = Record<string, unknown>;

describe("assistant_overview", () => {
  it("compte candidats, CV indexés, candidatures, offres et affectations", async () => {
    const o = await rpc<Row>("assistant_overview");
    expect(o.candidats).toBe(8); // 4 de la démo 0002 + 4 du jeu de test
    expect(o.candidats_avec_cv_indexe).toBe(3);
    expect(o.autres_documents).toBe(1);
    expect(o.notes).toBe(1);
    expect(o.candidatures).toMatchObject({ total: 8 });
    expect((o.candidatures as Row).par_statut).toMatchObject({ assigned: 1, under_review: 2 });
    expect((o.offres as Row).par_statut).toMatchObject({ open: 6, closed: 1 });
    expect(o.affectations).toEqual({ confirmed: 1 });
  });
});

describe("assistant_roster", () => {
  it("une ligne compacte par candidat, sans e-mail", async () => {
    const rows = await rpc<Row[]>("assistant_roster", { p_limit: 40 });
    expect(rows).toHaveLength(8);
    const hajar = rows.find((r) => r.name === "Hajar Ait Ouarab")!;
    expect(hajar).toMatchObject({
      last_status: "assigned",
      last_offer: "Stage Automatisme & GMAO",
      assignment_status: "confirmed",
      cv_indexed: true,
    });
    expect(rows.every((r) => !("email" in r))).toBe(true);
  });
});

describe("assistant_resolve_candidate", () => {
  const resolve = (q: string) => rpc<Row[]>("assistant_resolve_candidate", { q, p_limit: 5 });

  it("trouve un nom complet, même aux particules près", async () => {
    const [top] = await resolve("Hajar Ait Ouarab");
    expect(top).toMatchObject({ candidate_id: id(HAJAR), match: "nom_exact" });
  });

  it("renvoie TOUTES les personnes d'un nom ambigu", async () => {
    const names = (await resolve("Amrani")).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["Yasmine El Amrani", "Youssef Amrani"]));
    const youssefs = (await resolve("Youssef")).map((r) => r.name);
    expect(youssefs).toEqual(expect.arrayContaining(["Youssef Amrani", "Youssef El Khattabi"]));
  });

  it("accepte un identifiant et un e-mail", async () => {
    expect((await resolve(`#${id(KARIM)}`))[0]).toMatchObject({ candidate_id: id(KARIM), match: "id" });
    expect((await resolve(KARIM))[0]).toMatchObject({ candidate_id: id(KARIM), match: "email" });
  });

  it("ne trouve personne pour un inconnu", async () => {
    expect(await resolve("Mehdi Tazi")).toEqual([]);
  });
});

describe("assistant_candidate_dossier", () => {
  it("réunit candidature, résultat, affectation expliquée, historique et CV", async () => {
    const d = await rpc<Row>("assistant_candidate_dossier", { p_id: id(HAJAR) });
    expect(d).toMatchObject({ name: "Hajar Ait Ouarab", field_of_study: "Électromécanique" });
    const [app] = d.applications as Row[];
    expect(app).toMatchObject({ offer: "Stage Automatisme & GMAO", status: "assigned", start_date: "2026-11-01" });
    expect(app.assignment).toMatchObject({ status: "confirmed", score_breakdown: { skills: 0.8286, education: 1 } });
    expect((app.timeline as Row[]).map((e) => e.status)).toContain("assigned");
    expect(d.documents).toEqual([expect.objectContaining({ title: "CV — Hajar Ait Ouarab", doc_type: "cv" })]);
  });

  it("restitue les notes du recruteur", async () => {
    const d = await rpc<Row>("assistant_candidate_dossier", { p_id: id(KARIM) });
    expect((d.notes as Row[])[0]).toMatchObject({ author: "Mme Bennani", source: "ui" });
    expect(String((d.notes as Row[])[0].body)).toContain("mars 2027");
  });

  it("renvoie null pour un identifiant inconnu", async () => {
    expect(await rpc("assistant_candidate_dossier", { p_id: 999_999 })).toBeNull();
  });
});

describe("assistant_save_note", () => {
  it("enregistre une note retrouvée ensuite dans le dossier", async () => {
    const saved = await rpc<Row>("assistant_save_note", {
      p_candidate_id: id(YASMINE),
      p_author_id: null,
      p_author_name: "Recruteur test",
      p_body: "Préfère le site de Laâyoune.",
      p_source: "assistant",
    });
    expect(saved).toMatchObject({ candidate_id: id(YASMINE), body: "Préfère le site de Laâyoune." });
    const d = await rpc<Row>("assistant_candidate_dossier", { p_id: id(YASMINE) });
    expect((d.notes as Row[])[0]).toMatchObject({ body: "Préfère le site de Laâyoune.", source: "assistant" });
  });

  it("refuse une note vide ou un candidat inconnu", async () => {
    await expect(
      rpc("assistant_save_note", { p_candidate_id: id(YASMINE), p_author_id: null, p_author_name: "x", p_body: "  " }),
    ).rejects.toThrow();
    await expect(
      rpc("assistant_save_note", { p_candidate_id: 999_999, p_author_id: null, p_author_name: "x", p_body: "ok" }),
    ).rejects.toThrow(/introuvable/);
  });
});

describe("assistant_find_candidates", () => {
  const find = (args: Row) => rpc<Row[]>("assistant_find_candidates", args);
  const names = (rows: Row[]) => rows.map((r) => r.name);

  it("sans critère, liste tout le monde", async () => {
    expect(await find({})).toHaveLength(8);
  });

  it("filtre par filière, compétence, statut et offre", async () => {
    expect(names(await find({ p_field: "électrique" }))).toEqual(["Omar Fassi"]);
    expect(names(await find({ p_skills: ["power bi"] }))).toEqual(["Yasmine El Amrani"]);
    expect(names(await find({ p_status: "assigned" }))).toEqual(["Hajar Ait Ouarab"]);
    expect(names(await find({ p_offer: "Data Science" }))).toEqual(["Salma Benjelloun"]);
  });

  it("combine une recherche libre et les filtres", async () => {
    expect(names(await find({ q: "rust" }))).toEqual(["Karim Benali"]);
    expect(await find({ q: "rust", p_field: "Génie civil" })).toEqual([]);
  });
});

describe("assistant_offers", () => {
  it("liste les offres avec leurs affectés", async () => {
    const open = await rpc<Row[]>("assistant_offers", { p_status: "open" });
    expect(open).toHaveLength(6);
    const gmao = open.find((o) => o.title === "Stage Automatisme & GMAO")!;
    expect(gmao.affectes).toEqual(["Hajar Ait Ouarab"]);
    expect(gmao).not.toHaveProperty("candidats"); // le détail n'est donné que pour une offre précise
  });

  it("détaille une offre : compétences et candidats", async () => {
    const [ds] = await rpc<Row[]>("assistant_offers", { p_offer: "Data Science" });
    expect(ds.competences).toEqual(expect.arrayContaining([{ skill: "python", required: true }]));
    expect(ds.candidats).toEqual([expect.objectContaining({ name: "Salma Benjelloun", status: "under_review" })]);
  });
});

describe("assistant_ranking_pool / assistant_bookings", () => {
  it("fournit au classement les candidats évaluables et les offres ouvertes", async () => {
    const pool = await rpc<{ applicants: Row[]; offers: Row[] }>("assistant_ranking_pool");
    expect(pool.applicants.map((a) => a.status)).not.toContain("submitted");
    expect(pool.applicants.find((a) => a.name === "Karim Benali")?.skills).toMatchObject({ rust: 0.9 });
    expect(pool.offers).toHaveLength(6);
  });

  it("retient une réservation qui chevauche la fenêtre", async () => {
    const dec = await rpc<Row[]>("assistant_bookings", { p_from: "2026-12-01", p_to: "2026-12-31" });
    expect(dec.map((b) => b.name)).toEqual(["Hajar Ait Ouarab"]);
    expect(await rpc<Row[]>("assistant_bookings", { p_from: "2027-06-01", p_to: "2027-06-30" })).toEqual([]);
  });
});

describe("rag_search_chunks — CV d'un candidat", () => {
  it("cherche dans le CV d'une personne seulement", async () => {
    const yasmine = await retrieveDocChunks("Power BI", 5, null, id(YASMINE));
    expect(yasmine.length).toBeGreaterThan(0);
    expect(yasmine.every((c) => c.candidate_id === id(YASMINE))).toBe(true);
    expect(yasmine[0].title).toBe("CV — Yasmine El Amrani");
    expect(await retrieveDocChunks("Power BI", 5, null, id(KARIM))).toEqual([]);
  });

  it("étiquette chaque extrait du nom de la personne", async () => {
    const hits = await retrieveDocChunks("Yasmine El Amrani logiciels de simulation", 5);
    const flexsim = hits.find((c) => c.text.includes("FlexSim"));
    expect(flexsim?.heading).toMatch(/^Yasmine El Amrani › /);
  });
});
