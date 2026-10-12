// Client d'embeddings Gemini : format des requêtes, lots, réessais, garde-fous.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMBED_BATCH, EMBED_DIM, EMBED_MODEL } from "../config";
import { embedQuery, embeddingInput, embeddingsEnabled, embedTexts, queryInput } from "../embeddings";

type GeminiRequest = { model: string; content: { parts: { text: string }[] }; output_dimensionality: number };
const texts = (init?: RequestInit) =>
  (JSON.parse(String(init?.body)) as { requests: GeminiRequest[] }).requests.map((r) => r.content.parts[0].text);

const vec = (x: number) => new Array(EMBED_DIM).fill(x);
const ok = (inputs: string[]) =>
  new Response(JSON.stringify({ embeddings: inputs.map((_, i) => ({ values: vec(i) })) }), { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => ok(texts(init)));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("embedTexts", () => {
  it("découpe en lots, conserve l'ordre et parle le format Gemini", async () => {
    const input = Array.from({ length: EMBED_BATCH + 5 }, (_, i) => `t${i}`);
    const out = await embedTexts(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(input.length);
    expect(out[EMBED_BATCH][0]).toBe(0); // premier élément du 2e lot
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain(`models/${EMBED_MODEL}:batchEmbedContents`);
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    const [first] = (JSON.parse(String(init.body)) as { requests: GeminiRequest[] }).requests;
    expect(first).toEqual({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: "t0" }] },
      output_dimensionality: EMBED_DIM,
    });
  });

  it("remplace une entrée vide (que l'API rejetterait)", async () => {
    await embedTexts(["a", "   "]);
    expect(texts(fetchMock.mock.calls[0][1])).toEqual(["a", "-"]);
  });

  it("réessaie sur 429 puis réussit", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockImplementationOnce(async (_u: unknown, init?: RequestInit) => ok(texts(init)));
    await expect(embedTexts(["a"])).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ne réessaie PAS une erreur client (clé refusée)", async () => {
    fetchMock.mockResolvedValue(new Response("API key not valid", { status: 400 }));
    await expect(embedTexts(["a"])).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("n'écrit jamais la clé dans le message d'erreur", async () => {
    fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
    await expect(embedTexts(["a"])).rejects.not.toThrow(/test-key/);
  });

  it("refuse un lot incomplet plutôt que de décaler les vecteurs", async () => {
    fetchMock.mockResolvedValue(ok(["seul"]));
    await expect(embedTexts(["a", "b"])).rejects.toThrow(/expected 2/);
  });

  it("refuse une dimension inattendue", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ embeddings: [{ values: [1, 2, 3] }] }), { status: 200 }));
    await expect(embedTexts(["a"])).rejects.toThrow(/dimension/);
  });

  it("lève sans clé configurée", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(embeddingsEnabled()).toBe(false);
    await expect(embedTexts(["a"])).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

describe("embedQuery", () => {
  it("renvoie null sans clé, sans appeler l'API", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(await embedQuery("expérience en logistique")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renvoie null sur panne, sans réessai (la question attend)", async () => {
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    expect(await embedQuery("expérience en logistique")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("encode la question côté requête de la recherche asymétrique", async () => {
    expect(await embedQuery("  qui connaît SAP ?  ")).toHaveLength(EMBED_DIM);
    expect(texts(fetchMock.mock.calls[0][1])).toEqual(["task: search result | query: qui connaît SAP ?"]);
  });
});

describe("format des textes", () => {
  it("encode un extrait côté document, l'intertitre servant de titre", () => {
    expect(embeddingInput("Power BI, SQL", "Yasmine El Amrani › COMPÉTENCES")).toBe(
      "title: Yasmine El Amrani › COMPÉTENCES | text: Power BI, SQL",
    );
    expect(embeddingInput("texte", null)).toBe("title: none | text: texte");
  });

  it("encode une question avec le préfixe de recherche", () => {
    expect(queryInput("durée")).toBe("task: search result | query: durée");
  });
});
