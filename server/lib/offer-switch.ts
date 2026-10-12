// Logique métier de l'échange d'offre, isolée des handlers pour être testable.
//
// L'offre actuelle d'un candidat est portée par son affectation CONFIRMÉE
// (`assignments.offer_id`) : `applications.offer_id` n'enregistre que l'offre
// visée au dépôt et vaut souvent NULL pour une candidature générale.
//
// La capacité est vérifiée deux fois, volontairement : ici pour rendre un
// message clair en français, et de nouveau dans la RPC sous verrou de ligne,
// qui seule protège de deux approbations simultanées.
export interface OfferCapacity {
  id: number;
  title: string;
  slots: number;
  status: string;
  confirmed: number;
}

export type ApproveCheck =
  | { ok: true }
  | { ok: false; detail: string; status: number };

/** L'offre cible peut-elle accueillir un stagiaire de plus ? */
export function checkTargetOffer(offer: OfferCapacity | null | undefined): ApproveCheck {
  if (!offer) return { ok: false, detail: "Offre cible introuvable.", status: 404 };
  if (offer.status !== "open") {
    return { ok: false, detail: `L'offre « ${offer.title} » n'est plus ouverte.`, status: 409 };
  }
  if (offer.confirmed >= offer.slots) {
    return {
      ok: false,
      detail: `L'offre « ${offer.title} » est complète (${offer.confirmed}/${offer.slots} places).`,
      status: 409,
    };
  }
  return { ok: true };
}

/** Traduit les exceptions de la RPC en messages destinés au personnel. */
export function rpcErrorMessage(message: string): { detail: string; status: number } {
  if (message.includes("OFFER_FULL")) {
    return { detail: "L'offre cible est complète.", status: 409 };
  }
  if (message.includes("OFFER_CLOSED")) {
    return { detail: "L'offre cible n'est plus ouverte.", status: 409 };
  }
  if (message.includes("REQUEST_NOT_PENDING")) {
    return { detail: "Cette demande a déjà été traitée.", status: 409 };
  }
  if (message.includes("REQUEST_NOT_FOUND")) {
    return { detail: "Demande introuvable.", status: 404 };
  }
  if (message.includes("ASSIGNMENT_NOT_FOUND")) {
    return {
      detail: "Le candidat n'a plus d'affectation confirmée : l'échange est sans objet.",
      status: 409,
    };
  }
  return { detail: message, status: 500 };
}

export interface CurrentPlacement {
  applicationId: number;
  offerId: number;
  offerTitle: string;
}

/** Ce dont un candidat a besoin pour pouvoir demander un échange. */
export function readPlacement(rows: unknown[]): CurrentPlacement | null {
  const row = (rows ?? [])[0] as
    | { application_id: number; offer_id: number; offer?: { title?: string } | { title?: string }[] }
    | undefined;
  if (!row) return null;
  const offer = Array.isArray(row.offer) ? row.offer[0] : row.offer;
  return {
    applicationId: row.application_id,
    offerId: row.offer_id,
    offerTitle: offer?.title ?? "",
  };
}
