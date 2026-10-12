// Garde de capacité à la confirmation d'une affectation.
//
// Confirmer occupe une place, mais rien ne l'empêchait de dépasser le nombre de
// postes : seul l'échange d'offre vérifiait la capacité. Ces tests verrouillent
// le comptage — en particulier l'exclusion de l'affectation en cours, sans
// laquelle re-confirmer ferait paraître l'offre complète.
import { describe, expect, it, vi, beforeEach } from "vitest";

const { offerRow, countValue, neqSpy } = vi.hoisted(() => ({
  offerRow: { value: null as Record<string, unknown> | null },
  countValue: { value: 0 },
  neqSpy: vi.fn(),
}));

vi.mock("./supabase", () => ({
  admin: () => ({
    from: (table: string) => {
      if (table === "internship_offers") {
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.maybeSingle = () => Promise.resolve({ data: offerRow.value });
        return q;
      }
      // assignments : comptage des confirmées, avec .neq() optionnel.
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.neq = (col: string, val: unknown) => {
        neqSpy(col, val);
        return q;
      };
      q.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ count: countValue.value }).then(resolve);
      return q;
    },
  }),
}));

import { loadOfferCapacity } from "./db";
import { checkTargetOffer } from "./offer-switch";

beforeEach(() => {
  vi.clearAllMocks();
  offerRow.value = { id: 7, title: "Stage Data Science", slots: 2, status: "open" };
  countValue.value = 0;
});

describe("loadOfferCapacity", () => {
  it("renvoie l'offre avec ses places confirmées", async () => {
    countValue.value = 1;
    expect(await loadOfferCapacity(7)).toEqual({
      id: 7,
      title: "Stage Data Science",
      slots: 2,
      status: "open",
      confirmed: 1,
    });
    expect(neqSpy).not.toHaveBeenCalled();
  });

  it("exclut l'affectation en cours du comptage", async () => {
    await loadOfferCapacity(7, 42);
    expect(neqSpy).toHaveBeenCalledWith("id", 42);
  });

  it("renvoie null pour une offre inexistante", async () => {
    offerRow.value = null;
    expect(await loadOfferCapacity(999)).toBeNull();
  });
});

describe("garde de confirmation", () => {
  it("laisse passer tant qu'il reste une place", async () => {
    countValue.value = 1; // 1/2
    expect(checkTargetOffer(await loadOfferCapacity(7))).toEqual({ ok: true });
  });

  it("refuse en 409 quand l'offre est complète", async () => {
    countValue.value = 2; // 2/2
    const res = checkTargetOffer(await loadOfferCapacity(7));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.detail).toContain("complète");
    expect(res.detail).toContain("2/2");
  });

  it("refuse une offre fermée", async () => {
    offerRow.value = { id: 7, title: "Stage", slots: 5, status: "closed" };
    const res = checkTargetOffer(await loadOfferCapacity(7));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
  });

  it("refuse une offre introuvable en 404", async () => {
    offerRow.value = null;
    const res = checkTargetOffer(await loadOfferCapacity(999));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(404);
  });

  it("re-confirmer la même affectation ne la compte pas contre elle-même", async () => {
    // 2/2 places, mais l'une est CETTE affectation : elle doit rester valide.
    countValue.value = 1; // le .neq a retiré l'affectation courante
    expect(checkTargetOffer(await loadOfferCapacity(7, 42))).toEqual({ ok: true });
    expect(neqSpy).toHaveBeenCalledWith("id", 42);
  });
});
