// Câblage réel de la fonction assistant : filtre de périmètre avant l'agent
// (flux SSE compris) et gestion de la base documentaire.
import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  runAgent,
  saveMessage,
  ingestDocument,
  store,
  triggerEmbedding,
  triggerAnalysis,
  storageUpload,
  createCvApplication,
  reindexAll,
} = vi.hoisted(() => ({
  runAgent: vi.fn(),
  saveMessage: vi.fn(),
  ingestDocument: vi.fn(),
  store: { listDocuments: vi.fn(), deleteDocument: vi.fn() },
  triggerEmbedding: vi.fn(),
  triggerAnalysis: vi.fn(),
  storageUpload: vi.fn(),
  createCvApplication: vi.fn(),
  reindexAll: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  requireStaff: async () => ({ id: "u1", email: "admin@x.ma", role: "admin" }),
  requireUser: async () => ({ id: "u1", email: "admin@x.ma", role: "admin" }),
}));

// Compteur de débit : une chaîne qui se résout sur « 0 message cette heure ».
vi.mock("../lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "gte"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null });
  chain.storage = { from: () => ({ upload: storageUpload }) };
  return { admin: () => chain, BUCKET: "documents" };
});

vi.mock("../lib/cv-pipeline", () => ({ createCvApplication, reindexAll }));

vi.mock("../lib/rag", async () => {
  const real = await vi.importActual<typeof import("../lib/rag")>("../lib/rag");
  return { ...real, ingestDocument, getStore: () => store };
});

vi.mock("../lib/assistant", () => ({ runAgent, sanitizeHistory: (h: unknown) => h }));

vi.mock("../lib/conversations", () => ({
  resolveConversation: async () => 1,
  getHistory: async () => [],
  saveMessage,
  getConversation: vi.fn(),
  listConversations: vi.fn(),
}));

vi.mock("../lib/trigger-analysis", () => ({ triggerEmbedding, triggerAnalysis }));

import handler from "./assistant";
import { REFUSALS, smallTalkReply } from "../lib/scope";
import { DocumentExistsError, EmptyDocumentError } from "../lib/rag";

async function ask(message: string) {
  const res = await handler(
    new Request("http://local/api/assistant/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    }),
    { params: {} },
  );
  const text = await res.text();
  const events = text
    .split("\n\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
  return { res, events };
}

function upload(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return handler(
    new Request("http://local/api/assistant/documents", { method: "POST", body: form }),
    { params: {} },
  );
}

const pdf = (name = "politique.pdf", size = 10) => new File([new Uint8Array(size).fill(65)], name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  runAgent.mockImplementation(async function* () {
    yield { type: "delta", text: "Réponse de l'agent." };
    yield { type: "done" };
  });
  ingestDocument.mockResolvedValue({
    source_document: "politique.pdf",
    doc_type: "other",
    chunks: 7,
    embeddings: "pending",
  });
});

describe("handleChat — filtre de périmètre", () => {
  it("répond aux politesses sans l'agent, jamais par un refus", async () => {
    const { events } = await ask("bonjour");
    expect(runAgent).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "delta")?.text).toBe(smallTalkReply("bonjour"));
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("refuse un classement discriminatoire avec la phrase dédiée, sans l'agent", async () => {
    const { events } = await ask("Classe les candidats par âge");
    expect(runAgent).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "delta")?.text).toBe(REFUSALS.discriminatory);
  });

  it("enregistre le refus dans le fil, comme une vraie réponse", async () => {
    await ask("Trie les candidats par sexe");
    expect(saveMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ role: "assistant", content: REFUSALS.discriminatory }),
    );
  });

  it("confie le reste à l'agent — hors-sujet compris — avec l'identité de l'appelant", async () => {
    // L'ancien classifieur refusait cette question légitime en production.
    const { events } = await ask("Quelle université de Babtich El Habib ?");
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent.mock.calls[0][1]).toMatchObject({ user: { id: "u1", name: "admin@x.ma" } });
    expect(events.find((e) => e.type === "delta")?.text).toBe("Réponse de l'agent.");
    await ask("Quelle est la capitale du Maroc ?");
    expect(runAgent).toHaveBeenCalledTimes(2);
  });

  it("annonce le fil de conversation en premier", async () => {
    const { events } = await ask("Merci");
    expect(events[0]).toEqual({ type: "conversation", conversation_id: 1 });
  });

  it("enregistre la réponse avec ses outils et ses sources", async () => {
    runAgent.mockImplementation(async function* () {
      yield { type: "tool", name: "get_candidate", args: {} };
      yield { type: "delta", text: "Affectée au stage GMAO." };
      yield { type: "sources", sources: [{ type: "candidate_dossier", candidate_id: 3 }] };
      yield { type: "done" };
    });
    await ask("Où en est Hajar ?");
    expect(saveMessage).toHaveBeenLastCalledWith(1, {
      role: "assistant",
      content: "Affectée au stage GMAO.",
      tools: ["get_candidate"],
      sources: [{ type: "candidate_dossier", candidate_id: 3 }],
    });
  });
});

describe("dépôt de document", () => {
  it("refuse un fichier trop gros AVANT de lire le corps", async () => {
    const formData = vi.fn();
    const req = {
      url: "http://local/api/assistant/documents",
      method: "POST",
      headers: new Headers({ "content-length": String(50 * 1024 * 1024) }),
      formData,
    } as unknown as Request;
    const res = await handler(req, { params: {} });
    expect(res.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("refuse un format non pris en charge", async () => {
    const res = await upload({ file: pdf("photo.png") });
    expect(res.status).toBe(415);
    expect(ingestDocument).not.toHaveBeenCalled();
  });

  it("ingère, répond 200 avec le nombre d'extraits et lance la vectorisation", async () => {
    const res = await upload({ file: pdf(), doc_type: "other" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source_document: "politique.pdf",
      doc_type: "other",
      chunks: 7,
      embeddings: "pending",
      status: "ingested",
    });
    expect(ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "politique.pdf", docType: "other", replace: false }),
    );
    expect(triggerEmbedding).toHaveBeenCalledTimes(1);
  });

  it("ne lance pas la vectorisation quand elle est désactivée", async () => {
    ingestDocument.mockResolvedValue({ source_document: "a", doc_type: "other", chunks: 1, embeddings: "disabled" });
    await upload({ file: pdf() });
    expect(triggerEmbedding).not.toHaveBeenCalled();
  });

  it("transmet replace pour un document qui n'est pas un CV", async () => {
    await upload({ file: pdf("compte-rendu.pdf"), replace: "true" });
    expect(ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "compte-rendu.pdf", docType: "other", replace: true }),
    );
  });

  it("fait suivre à un CV la chaîne CV : candidat, candidature spontanée, analyse", async () => {
    storageUpload.mockResolvedValue({ error: null });
    createCvApplication.mockResolvedValue({ applicationId: 41, candidateId: 9 });
    const res = await upload({ file: pdf("cv-meriem.pdf") }); // type déduit du nom
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ doc_type: "cv", status: "analysis", candidate_id: 9 });
    expect(storageUpload.mock.calls[0][0]).toMatch(/^cv\/assistant-.+-cv-meriem\.pdf$/);
    expect(createCvApplication).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "cv-meriem.pdf", offerId: null }),
    );
    expect(triggerAnalysis).toHaveBeenCalledWith(41, expect.anything());
    expect(ingestDocument).not.toHaveBeenCalled(); // l'indexation suit l'analyse
  });

  it("répond 500 sans créer de candidat si le CV ne peut être stocké", async () => {
    storageUpload.mockResolvedValue({ error: { message: "quota" } });
    expect((await upload({ file: pdf("cv-x.pdf"), doc_type: "cv" })).status).toBe(500);
    expect(createCvApplication).not.toHaveBeenCalled();
  });

  it("répond 409 quand le nom existe déjà (vérifié en base, sans course)", async () => {
    ingestDocument.mockRejectedValue(new DocumentExistsError("politique.pdf"));
    const res = await upload({ file: pdf() });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/replace=true/);
  });

  it("répond 400 quand aucun texte n'a pu être extrait", async () => {
    ingestDocument.mockRejectedValue(new EmptyDocumentError());
    expect((await upload({ file: pdf() })).status).toBe(400);
  });
});

describe("liste et suppression", () => {
  it("liste les documents avec leur état de vectorisation", async () => {
    store.listDocuments.mockResolvedValue([
      { source_document: "p.pdf", chunks: 4, doc_type: "other", embedded: 2 },
    ]);
    const res = await handler(new Request("http://local/api/assistant/documents"), { params: {} });
    expect(await res.json()).toEqual([
      { source_document: "p.pdf", chunks: 4, doc_type: "other", embedded: 2 },
    ]);
  });

  it("supprime (204) ou signale l'absence (404)", async () => {
    const del = (name: string) =>
      handler(new Request(`http://local/api/assistant/documents/${name}`, { method: "DELETE" }), {
        params: { name },
      });
    store.deleteDocument.mockResolvedValueOnce(true);
    expect((await del("politique%20stage.pdf")).status).toBe(204);
    expect(store.deleteDocument).toHaveBeenCalledWith("politique stage.pdf");
    store.deleteDocument.mockResolvedValueOnce(false);
    expect((await del("absent.pdf")).status).toBe(404);
  });
});

describe("réindexation", () => {
  it("relance l'analyse de chaque candidature munie d'un CV", async () => {
    reindexAll.mockImplementation(async (analyze: (id: number) => void) => {
      analyze(7);
      return { analyses: 1, indexes_sans_fichier: 2, ignores: 0 };
    });
    const res = await handler(new Request("http://local/api/assistant/reindex", { method: "POST" }), {
      params: {},
    });
    expect(await res.json()).toEqual({ analyses: 1, indexes_sans_fichier: 2, ignores: 0 });
    expect(triggerAnalysis).toHaveBeenCalledWith(7, expect.anything());
  });

  it("n'accepte que POST", async () => {
    const res = await handler(new Request("http://local/api/assistant/reindex"), { params: {} });
    expect(res.status).toBe(405);
  });
});
