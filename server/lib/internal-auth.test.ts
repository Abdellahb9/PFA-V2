import { afterEach, describe, expect, it, vi } from "vitest";
import { internalAuthHeader, rejectUnlessInternal } from "./internal-auth";

const req = (auth?: string) =>
  new Request("http://local/api/rag-embed", { method: "POST", headers: auth ? { authorization: auth } : {} });

afterEach(() => vi.unstubAllEnvs());

describe("routes internes", () => {
  it("exigent le secret quand CRON_SECRET est défini (Vercel Cron l'envoie)", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(rejectUnlessInternal(req("Bearer s3cret"))).toBeNull();
    expect(rejectUnlessInternal(req("Bearer autre"))?.status).toBe(401);
    expect(rejectUnlessInternal(req())?.status).toBe(401);
    expect(internalAuthHeader()).toEqual({ authorization: "Bearer s3cret" });
  });

  it("restent ouvertes sans CRON_SECRET (développement)", () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(rejectUnlessInternal(req())).toBeNull();
    expect(internalAuthHeader()).toEqual({});
  });
});
