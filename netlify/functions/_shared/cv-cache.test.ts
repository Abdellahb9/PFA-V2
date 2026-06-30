import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks for the Supabase query builder (chainable: select->eq->gte->maybeSingle).
const { from, maybeSingle, upsert } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const upsert = vi.fn();
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.gte = () => query;
  query.maybeSingle = maybeSingle;
  query.upsert = upsert;
  return { from: vi.fn(() => query), maybeSingle, upsert };
});

vi.mock("./supabase", () => ({ admin: () => ({ from }) }));
vi.mock("./groq", () => ({ extractProfile: vi.fn() }));

import { extractProfileCached, hashText } from "./cv-cache";
import { extractProfile } from "./groq";

const mockedExtract = extractProfile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ error: null });
});

describe("hashText", () => {
  it("is stable and ignores surrounding/inner whitespace", () => {
    expect(hashText("a   b\n c")).toBe(hashText("a b c"));
    expect(hashText("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("extractProfileCached", () => {
  it("cache HIT: returns cached profile, skips Groq and write", async () => {
    maybeSingle.mockResolvedValue({ data: { profile: { skills: ["python"] } } });

    const res = await extractProfileCached("some cv text");

    expect(res).toEqual({ skills: ["python"] });
    expect(mockedExtract).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("cache MISS: calls Groq and stores the result", async () => {
    maybeSingle.mockResolvedValue({ data: null });
    mockedExtract.mockResolvedValue({ skills: ["nlp"] });

    const res = await extractProfileCached("other cv");

    expect(res).toEqual({ skills: ["nlp"] });
    expect(mockedExtract).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("fail-open: a cache read error still returns a fresh extraction", async () => {
    maybeSingle.mockRejectedValue(new Error("cache down"));
    mockedExtract.mockResolvedValue({ skills: ["x"] });

    const res = await extractProfileCached("cv");

    expect(res).toEqual({ skills: ["x"] });
    expect(mockedExtract).toHaveBeenCalledOnce();
  });

  it("empty text short-circuits (no Groq, no cache access)", async () => {
    const res = await extractProfileCached("   ");

    expect(res).toBeNull();
    expect(mockedExtract).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
