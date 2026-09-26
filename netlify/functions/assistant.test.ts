// Le filtre de périmètre doit s'intercaler AVANT l'agent : une question refusée
// ne doit jamais atteindre le modèle principal ni ses outils. On vérifie ici le
// câblage réel de handleChat, bout de flux SSE compris.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { runAgent, classifyScope, saveMessage } = vi.hoisted(() => ({
  runAgent: vi.fn(),
  classifyScope: vi.fn(),
  saveMessage: vi.fn(),
}));

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

vi.mock("./_shared/agent", () => ({
  runAgent,
  sanitizeHistory: (h: unknown) => h,
}));

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

vi.mock("./_shared/cv", () => ({ extractCvText: vi.fn() }));
vi.mock("./_shared/rag", () => ({ ingestDocumentText: vi.fn(), listDocumentCounts: vi.fn() }));

import handler from "./assistant";
import { REFUSALS } from "./_shared/scope";

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

beforeEach(() => {
  vi.clearAllMocks();
  runAgent.mockImplementation(async function* () {
    yield { type: "delta", text: "Réponse de l'agent." };
    yield { type: "done" };
  });
});

describe("handleChat — filtre de périmètre", () => {
  it("n'appelle JAMAIS l'agent pour une question hors sujet", async () => {
    classifyScope.mockResolvedValue({ verdict: "off_topic", via: "classifier" });

    const { events } = await ask("Quelle est la capitale du Maroc ?");

    expect(runAgent).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "delta")?.text).toBe(REFUSALS.off_topic);
    expect(events.at(-1)).toEqual({ type: "done" });
    // Aucun appel d'outil annoncé : l'interface n'affiche aucune pastille.
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
});
