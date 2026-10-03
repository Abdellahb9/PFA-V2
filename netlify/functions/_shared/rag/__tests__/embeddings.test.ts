import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBED_BATCH, EMBED_DIM, EMBED_MODEL } from "../config";
import { embedQuery, embeddingInput, embeddingsEnabled, embedTexts } from "../embeddings";

const vec = (x: number) => new Array(EMBED_DIM).fill(x);
const ok = (inputs: string[]) =>
  new Response(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: vec(index) })) }), {
    status: 200,
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("MISTRAL_API_KEY", "test-key");
  fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) =>
    ok((JSON.parse(String(init?.body)) as { input: string[] }).input),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("embedTexts", () => {
  it("découpe en lots et conserve l'ordre", async () => {
    const texts = Array.from({ length: EMBED_BATCH + 5 }, (_, i) => `t${i}`);
    const out = await embedTexts(texts);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(texts.length);
    expect(out[EMBED_BATCH][0]).toBe(0); // premier élément du 2e lot
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.model).toBe(EMBED_MODEL);
    expect(fetchMock.mock.calls[0][1].headers.authorization).toBe("Bearer test-key");
  });

  it("remplace une entrée vide (que l'API rejetterait)", async () => {
    await embedTexts(["a", "   "]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).input).toEqual(["a", "-"]);
  });

  it("réessaie sur 429 puis réussit", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockImplementationOnce(async (_u: unknown, init?: RequestInit) =>
        ok((JSON.parse(String(init?.body)) as { input: string[] }).input),
      );
    await expect(embedTexts(["a"])).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ne réessaie PAS une erreur client (401)", async () => {
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(embedTexts(["a"])).rejects.toThrow(/401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuse un lot incomplet plutôt que de décaler les vecteurs", async () => {
    fetchMock.mockResolvedValue(ok(["seul"]));
    await expect(embedTexts(["a", "b"])).rejects.toThrow(/expected 2/);
  });

  it("refuse une dimension inattendue", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }), { status: 200 }),
    );
    await expect(embedTexts(["a"])).rejects.toThrow(/dimension/);
  });

  it("lève sans clé configurée", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "");
    expect(embeddingsEnabled()).toBe(false);
    await expect(embedTexts(["a"])).rejects.toThrow(/MISTRAL_API_KEY/);
  });
});

describe("embedQuery", () => {
  it("renvoie null sans clé, sans appeler l'API", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "");
    expect(await embedQuery("durée du stage")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renvoie null sur panne, sans réessai (la question attend)", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    expect(await embedQuery("durée du stage")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renvoie le vecteur de la question", async () => {
    expect(await embedQuery("durée")).toHaveLength(EMBED_DIM);
  });
});

describe("embeddingInput", () => {
  it("préfixe l'intertitre quand il existe", () => {
    expect(embeddingInput("six mois", "Durée")).toBe("Durée\nsix mois");
    expect(embeddingInput("six mois", null)).toBe("six mois");
  });
});
