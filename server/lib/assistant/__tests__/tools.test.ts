// Outils de l'assistant, exécutés contre les VRAIES fonctions SQL (PGlite :
// migrations + jeu synthétique + CV indexés). Les arguments viennent du modèle,
// donc ils sont douteux : chaque cas invalide doit donner une erreur lisible,
// jamais une exception ni un faux résultat.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createAssistantDb, pgliteRpc } from "./helpers";
import { clampInt, optionalNumber, runTool } from "../tools";
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

type P = Record<string, any>;
const run = async (name: string, args: P = {}, ctx = {}) => (await runTool(name, args, ctx)) as { payload: P; sources: P[] };

describe("get_candidate", () => {
  it("rend le dossier et une source « candidate_dossier »", async () => {
    const { payload, sources } = await run("get_candidate", { candidate: "Hajar Ait Ouarab" });
    expect(payload.dossier.name).toBe("Hajar Ait Ouarab");
    expect(payload.dossier.applications[0].assignment.status).toBe("confirmed");
    expect(sources).toEqual([
      expect.objectContaining({ type: "candidate_dossier", name: "Hajar Ait Ouarab", status: "assigned" }),
    ]);
  });

  it("ne choisit pas entre deux personnes du même nom", async () => {
    const { payload, sources } = await run("get_candidate", { candidate: "Amrani" });
    expect(payload.ambigu).toBe("Amrani");
    expect(payload.candidats_possibles.map((c: P) => c.name)).toEqual(
      expect.arrayContaining(["Yasmine El Amrani", "Youssef Amrani"]),
    );
    expect(sources).toEqual([]);
  });

  it("dit qu'un inconnu est introuvable et oriente vers les CV", async () => {
    const { payload } = await run("get_candidate", { candidate: "Mehdi Tazi" });
    expect(payload.introuvable).toBe("Mehdi Tazi");
    expect(payload.explication).toMatch(/search_cvs/);
  });

  it("refuse un argument vide", async () => {
    expect((await run("get_candidate", {})).payload.erreur).toBeDefined();
  });
});

describe("search_cvs", () => {
  it("cherche dans le CV d'une personne et étiquette le texte comme non fiable", async () => {
    const { payload, sources } = await run("search_cvs", {
      query: "logiciels de simulation",
      candidate: "Yasmine El Amrani",
    });
    expect(payload.cv_de).toBe("Yasmine El Amrani");
    const hit = payload.extraits.find((e: P) => e.texte.includes("FlexSim"));
    expect(hit).toMatchObject({ document: "CV — Yasmine El Amrani", page: 2, contenu_non_fiable: true });
    expect(sources.every((s) => s.type === "doc_chunk")).toBe(true);
  });

  it("explique un CV qui ne mentionne pas la chose demandée", async () => {
    const { payload } = await run("search_cvs", { query: "Power BI", candidate: "Karim Benali" });
    expect(payload.extraits).toEqual([]);
    expect(payload.explication).toMatch(/Karim Benali/);
  });

  it("retrouve qui, parmi tous les CV, mentionne une compétence", async () => {
    const { sources } = await run("search_cvs", { query: "Power BI" });
    expect(sources.map((s) => s.candidate_id)).not.toContain(undefined);
    expect(sources.some((s) => s.title === "CV — Yasmine El Amrani")).toBe(true);
  });
});

describe("find_candidates", () => {
  it("liste tout le monde sans critère — « combien de candidats ? »", async () => {
    const { payload, sources } = await run("find_candidates");
    expect(payload.nombre).toBe(8);
    expect(sources).toHaveLength(8);
  });

  it("filtre, et dit quand personne ne correspond", async () => {
    expect((await run("find_candidates", { skills: ["power bi"] })).payload.candidats.map((c: P) => c.name)).toEqual([
      "Yasmine El Amrani",
    ]);
    expect((await run("find_candidates", { skills: "rust, go" })).payload.candidats.map((c: P) => c.name)).toEqual([
      "Karim Benali",
    ]);
    expect((await run("find_candidates", { field: "astronomie" })).payload.explication).toMatch(/Aucun/);
  });

  it("rejette un statut inventé", async () => {
    expect((await run("find_candidates", { status: "embauché" })).payload.erreur).toMatch(/Statut inconnu/);
  });
});

describe("rank_candidates", () => {
  it("classe sur les données de la base", async () => {
    const { payload, sources } = await run("rank_candidates", { field: "génie électrique", top_k: 3 });
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results.map((r: P) => r.name)).toContain("Omar Fassi");
    expect(sources[0].type).toBe("ranked_candidate");
  });

  it("rend la liste de ce qui existe quand la filière est inconnue", async () => {
    const { payload } = await run("rank_candidates", { field: "astrophysique quantique" });
    expect(payload.erreur ?? payload.explication).toBeDefined();
  });
});

describe("list_offers / list_bookings", () => {
  it("détaille une offre, refuse un statut inventé", async () => {
    const { payload } = await run("list_offers", { offer: "Data Science" });
    expect(payload.offres[0].candidats[0].name).toBe("Salma Benjelloun");
    expect((await run("list_offers", { status: "archived" })).payload.erreur).toBeDefined();
    expect((await run("list_offers", { offer: "Plongée sous-marine" })).payload.explication).toMatch(/Aucune offre/);
  });

  it("valide les dates et retrouve qui est en stage sur une période", async () => {
    expect((await run("list_bookings", { from: "décembre" })).payload.erreur).toBeDefined();
    const { payload } = await run("list_bookings", { from: "2026-12-01", to: "2026-12-31" });
    expect(payload.reservations.map((r: P) => r.name)).toEqual(["Hajar Ait Ouarab"]);
  });
});

describe("save_note", () => {
  const me = { user: { id: null, name: "rh@ocp.ma" } };

  it("enregistre la note avec son auteur, retrouvée dans le dossier", async () => {
    const { payload, sources } = await run(
      "save_note",
      { candidate: "Omar Fassi", note: "Disponible dès juillet." },
      me,
    );
    expect(payload.note_enregistree).toMatchObject({ candidat: "Omar Fassi", note: "Disponible dès juillet." });
    expect(sources[0]).toMatchObject({ type: "note", name: "Omar Fassi" });
    const dossier = (await run("get_candidate", { candidate: "Omar Fassi" })).payload.dossier;
    expect(dossier.notes[0]).toMatchObject({ body: "Disponible dès juillet.", author: "rh@ocp.ma", source: "assistant" });
  });

  it("n'écrit rien pour un nom ambigu ou une note vide", async () => {
    expect((await run("save_note", { candidate: "Youssef", note: "x" }, me)).payload.ambigu).toBe("Youssef");
    expect((await run("save_note", { candidate: "Omar Fassi", note: "   " }, me)).payload.erreur).toBeDefined();
  });
});

describe("validation des arguments", () => {
  it("borne les entiers et ignore les nombres inexploitables", () => {
    expect(clampInt("beaucoup", 1, 20, 5)).toBe(5);
    expect(clampInt(500, 1, 20, 5)).toBe(20);
    expect(clampInt(-3, 1, 20, 5)).toBe(1);
    expect(optionalNumber("abc")).toBeNull();
    expect(optionalNumber(-1)).toBeNull();
    expect(optionalNumber("2")).toBe(2);
  });

  it("signale un outil inconnu", async () => {
    expect((await run("explain_assignment_score", { assignment_id: 1 })).payload.erreur).toMatch(/Outil inconnu/);
  });
});
