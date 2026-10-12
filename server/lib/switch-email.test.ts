// Envoi de l'e-mail d'échange approuvé : idempotence et isolation des pannes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Constructeur de requêtes Supabase, chaînable comme le vrai client.
// `update(...)` renvoie la chaîne pour qu'on puisse inspecter ce qui a été écrit.
const { from, maybeSingle, update } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const update = vi.fn();
  const query: Record<string, unknown> = {};
  query.select = () => query;
  query.eq = () => query;
  query.is = () => query;
  query.maybeSingle = maybeSingle;
  query.update = (...args: unknown[]) => {
    update(...args);
    return query;
  };
  return { from: vi.fn(() => query), maybeSingle, update };
});

vi.mock("./supabase", () => ({ admin: () => ({ from }) }));

import { notifySwitchApproved, type SwitchEmailContext } from "./switch-email";

const CANDIDATE = { first_name: "Mariem", last_name: "Bedda", email: "mariem@example.org" };

const ctx = (over: Partial<SwitchEmailContext> = {}): SwitchEmailContext => ({
  requestId: "11111111-2222-3333-4444-555555555555",
  candidateId: 7,
  status: "approved",
  emailSentAt: null,
  newOfferTitle: "Stage Data Science",
  departmentName: "Systèmes d'information",
  ...over,
});

/** Dernier objet passé à `.update(...)`, ou null si rien n'a été écrit. */
const lastUpdate = (): Record<string, unknown> | null =>
  update.mock.calls.length
    ? (update.mock.calls[update.mock.calls.length - 1][0] as Record<string, unknown>)
    : null;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_FROM = "Stages <stages@example.org>";
  delete process.env.DOCS_DEADLINE_DAYS;

  maybeSingle.mockResolvedValue({ data: CANDIDATE });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: "msg_abc123" }),
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notifySwitchApproved", () => {
  it("envoie une fois et enregistre email_sent_at", async () => {
    await notifySwitchApproved(ctx());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).method).toBe("POST");

    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.to).toEqual(["mariem@example.org"]);
    expect(body.from).toBe("Stages <stages@example.org>");
    expect(body.subject).toContain("Échange d'offre approuvé");
    // Le corps annonce la bonne offre et demande les documents.
    expect(body.text).toContain("Stage Data Science");
    expect(body.text).toContain("Systèmes d'information");
    expect(body.text).toContain("déposer vos documents");
    expect(body.html).toContain("Stage Data Science");

    const written = lastUpdate();
    expect(written?.email_sent_at).toEqual(expect.any(String));
    expect(written?.email_error).toBeNull();
  });

  it("ne renvoie pas si email_sent_at est déjà posé", async () => {
    await notifySwitchApproved(ctx({ emailSentAt: "2026-08-23T10:00:00.000Z" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("n'envoie rien pour une demande qui n'est pas approuvée", async () => {
    await notifySwitchApproved(ctx({ status: "rejected" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un échec d'envoi ne lève pas et trace email_error", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "domain not verified",
      json: async () => ({}),
    });

    // Le point du test : l'approbation appelante doit pouvoir continuer.
    await expect(notifySwitchApproved(ctx())).resolves.toBeUndefined();

    const written = lastUpdate();
    expect(String(written?.email_error)).toContain("422");
    expect(written?.email_sent_at).toBeUndefined();
  });

  it("une panne réseau ne lève pas non plus", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    await expect(notifySwitchApproved(ctx())).resolves.toBeUndefined();
    expect(String(lastUpdate()?.email_error)).toContain("ECONNRESET");
  });

  it("clé absente : aucun appel réseau, et l'échange reste approuvé", async () => {
    delete process.env.RESEND_API_KEY;

    await expect(notifySwitchApproved(ctx())).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(lastUpdate()?.email_error)).toContain("RESEND_API_KEY");
  });

  it("candidat sans adresse : envoi ignoré, erreur tracée", async () => {
    maybeSingle.mockResolvedValue({ data: { ...CANDIDATE, email: "  " } });

    await notifySwitchApproved(ctx());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(String(lastUpdate()?.email_error)).toContain("introuvable");
  });

  it("ajoute le délai seulement si DOCS_DEADLINE_DAYS est exploitable", async () => {
    process.env.DOCS_DEADLINE_DAYS = "5";
    await notifySwitchApproved(ctx());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).text).toContain("5 jours");

    vi.clearAllMocks();
    process.env.DOCS_DEADLINE_DAYS = "0";
    await notifySwitchApproved(ctx());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).text).not.toContain("délai");
  });
});
