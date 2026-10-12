// Tests de la logique d'échange d'offre (pure, sans Supabase ni réseau).
import { describe, expect, it } from "vitest";
import { checkTargetOffer, readPlacement, rpcErrorMessage } from "./offer-switch";
import type { OfferCapacity } from "./offer-switch";

const offer = (over: Partial<OfferCapacity> = {}): OfferCapacity => ({
  id: 1,
  title: "Stage Data Science",
  slots: 2,
  status: "open",
  confirmed: 0,
  ...over,
});

describe("checkTargetOffer", () => {
  it("accepte une offre ouverte qui a encore une place", () => {
    expect(checkTargetOffer(offer({ slots: 2, confirmed: 1 }))).toEqual({ ok: true });
  });

  it("refuse une offre complète en nommant les places occupées", () => {
    const res = checkTargetOffer(offer({ slots: 2, confirmed: 2 }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.detail).toContain("complète");
    expect(res.detail).toContain("2/2");
  });

  it("refuse au-delà de la capacité, pas seulement à égalité", () => {
    // Une incohérence en base ne doit pas rouvrir l'offre.
    const res = checkTargetOffer(offer({ slots: 1, confirmed: 3 }));
    expect(res.ok).toBe(false);
  });

  it("refuse une offre fermée même si elle a des places", () => {
    const res = checkTargetOffer(offer({ status: "closed", confirmed: 0 }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.detail).toContain("plus ouverte");
    expect(res.status).toBe(409);
  });

  it("refuse une offre inexistante", () => {
    const res = checkTargetOffer(null);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
  });
});

describe("rpcErrorMessage", () => {
  it("traduit le refus pour offre complète", () => {
    // La RPC lève cette exception quand deux approbations se croisent.
    expect(rpcErrorMessage('erreur: OFFER_FULL')).toEqual({
      detail: "L'offre cible est complète.",
      status: 409,
    });
  });

  it("traduit une demande déjà traitée", () => {
    expect(rpcErrorMessage("REQUEST_NOT_PENDING").status).toBe(409);
  });

  it("traduit une affectation disparue", () => {
    expect(rpcErrorMessage("ASSIGNMENT_NOT_FOUND").detail).toContain("sans objet");
  });

  it("laisse passer un message inconnu en 500", () => {
    expect(rpcErrorMessage("boom").status).toBe(500);
  });
});

describe("readPlacement", () => {
  it("lit l'affectation confirmée, offre imbriquée en objet", () => {
    expect(
      readPlacement([{ application_id: 4, offer_id: 1, offer: { title: "Stage Optimisation" } }]),
    ).toEqual({ applicationId: 4, offerId: 1, offerTitle: "Stage Optimisation" });
  });

  it("accepte la relation renvoyée en tableau par PostgREST", () => {
    expect(
      readPlacement([{ application_id: 4, offer_id: 1, offer: [{ title: "Stage Optimisation" }] }])
        ?.offerTitle,
    ).toBe("Stage Optimisation");
  });

  it("renvoie null sans affectation confirmée : rien à échanger", () => {
    expect(readPlacement([])).toBeNull();
  });
});
