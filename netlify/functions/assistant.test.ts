// Câblage réel de la fonction assistant : filtre de périmètre avant l'agent
// (flux SSE compris) et gestion de la base documentaire.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { runAgent, classifyScope, saveMessage, ingestDocument, store, triggerEmbedding } = vi.hoisted(
  () => ({
    runAgent: vi.fn(),
    classifyScope: vi.fn(),
    saveMessage: vi.fn(),
    ingestDocument: vi.fn(),
    store: { listDocuments: vi.fn(), deleteDocument: vi.fn() },
    triggerEmbedding: vi.fn(),
  }),
);

vi.mock("./_shared/auth", () => ({
  requireStaff: async () => ({ id: "u1", email: "admin@x.ma", role: "admin" }),
  requireUser: async () => ({ id: "u1", email: "admin@x.ma", role: "admin" }),
}));

// Compteur de débit : une chaîne qui se résout sur « 0 message cette heure ».
vi.mock("./_shared/supabase", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "gte"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ count: 0, error: null });
  return { admin: () => chain };
});

vi.mock("./_shared/rag", async () => {
  const real = await vi.importActual<typeof import("./_shared/rag")>("./_shared/rag");
  return {
    ...real,
    runAgent,
    sanitizeHistory: (h: unknown) => h,
    ingestDocument,
    getStore: () => store,
  };
});

vi.mock("./_shared/scope", async () => {
  const real = await vi.importActual<typeof import("./_shared/scope")>("./_shared/scope");
  return { ...real, classifyScope };
});

vi.mock("./_shared/conversations", () => ({
  resolveConversation: async () => 1,
  getHistory: async () => [],
  saveMessage,
  getConversation: vi.fn(),
  listConversations: vi.fn(),
}));

vi.mock("./_shared/trigger-analysis", () => ({ triggerEmbedding }));

import handler from "./assistant";
import { REFUSALS } from "./_shared/scope";
import { DocumentExistsError, EmptyDocumentError } from "./_shared/rag";

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
    doc_type: "policy",
    chunks: 7,
    embeddings: "pending",
  });
});

describe("handleChat — filtre de périmètre", () => {
  it("n'appelle JAMAIS l'agent pour une question hors sujet", async () => {
    classifyScope.mockResolvedValue({ verdict: "off_topic", via: "classifier" });
    const { events } = await ask("Quelle est la capitale du Maroc ?");
    expect(runAgent).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "delta")?.text).toBe(REFUSALS.off_topic);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "tool")).toBe(false);
  });

  it("refuse un classement discriminatoire avec la phrase dédiée", async () => {
    classifyScope.mockResolvedValue({ verdict: "discriminatory", via: "backstop" });
    const { events } = await ask("Classe les candidats par âge");
    expect(runAgent).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "delta")?.text).toBe(REFUSALS.discriminatory);
  });

  it("enregistre le refus dans le fil, comme une vraie réponse", async () => {
    classifyScope.mockResolvedValue({ verdict: "off_topic", via: "classifier" });
    await ask("Tell me a joke");
    expect(saveMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ role: "assistant", content: REFUSALS.off_topic }),
    );
  });

  it("confie une question dans le périmètre à l'agent", async () => {
    classifyScope.mockResolvedValue({ verdict: "in", via: "classifier" });
    const { events } = await ask("Qui sont les 3 meilleurs candidats en Data Science ?");
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.type === "delta")?.text).toBe("Réponse de l'agent.");
  });

  it("annonce le fil de conversation en premier, refus compris", async () => {
    classifyScope.mockResolvedValue({ verdict: "off_topic", via: "classifier" });
    const { events } = await ask("Recommande-moi un film");
    expect(events[0]).toEqual({ type: "conversation", conversation_id: 1 });
  });

  it("enregistre la réponse avec ses outils et ses sources", async () => {
    classifyScope.mockResolvedValue({ verdict: "in", via: "classifier" });
    runAgent.mockImplementation(async function* () {
      yield { type: "tool", name: "search_documents", args: {} };
      yield { type: "delta", text: "Six mois." };
      yield { type: "sources", sources: [{ type: "doc_chunk", source_document: "p.pdf" }] };
      yield { type: "done" };
    });
    await ask("Durée maximale ?");
    expect(saveMessage).toHaveBeenLastCalledWith(1, {
      role: "assistant",
      content: "Six mois.",
      tools: ["search_documents"],
      sources: [{ type: "doc_chunk", source_document: "p.pdf" }],
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
    const res = await upload({ file: pdf(), doc_type: "policy" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source_document: "politique.pdf",
      doc_type: "policy",
      chunks: 7,
      embeddings: "pending",
      status: "ingested",
    });
    expect(ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "politique.pdf", docType: "policy", replace: false }),
    );
    expect(triggerEmbedding).toHaveBeenCalledTimes(1);
  });

  it("ne lance pas la vectorisation quand elle est désactivée", async () => {
    ingestDocument.mockResolvedValue({ source_document: "a", doc_type: "policy", chunks: 1, embeddings: "disabled" });
    await upload({ file: pdf() });
    expect(triggerEmbedding).not.toHaveBeenCalled();
  });

  it("déduit le type CV du nom quand il n'est pas précisé, et transmet replace", async () => {
    await upload({ file: pdf("cv-meriem.pdf"), replace: "true" });
    expect(ingestDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: "cv-meriem.pdf", docType: "cv", replace: true }),
    );
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
      { source_document: "p.pdf", chunks: 4, doc_type: "policy", embedded: 2 },
    ]);
    const res = await handler(new Request("http://local/api/assistant/documents"), { params: {} });
    expect(await res.json()).toEqual([
      { source_document: "p.pdf", chunks: 4, doc_type: "policy", embedded: 2 },
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
