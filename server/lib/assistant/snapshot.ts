// Instantané remis au modèle à chaque message : chiffres clés et registre des
// candidats, frais de la base.
//
// C'est ce qui manquait : sans lui, « combien de candidats ? » partait en
// recherche plein-texte du mot « candidats » et revenait « aucun » avec 7
// candidats en base. Compact (≈ 1 ligne par candidat) pour tenir dans le budget
// de tokens de l'offre gratuite ; au-delà de ROSTER_LIMIT candidats, seuls les
// chiffres restent et le modèle passe par find_candidates.
import { rpc } from "../rpc";

export const ROSTER_LIMIT = 40;

/** Libellés des statuts de candidature, tels que l'interface les affiche. */
export const STATUS_LABEL: Record<string, string> = {
  submitted: "reçue",
  parsing: "en analyse",
  parsed: "analysée",
  under_review: "en examen",
  assigned: "affectée",
  rejected: "refusée",
  failed: "analyse échouée",
};

const ASSIGNMENT_LABEL: Record<string, string> = {
  proposed: "affectation proposée",
  confirmed: "affectation confirmée",
  rejected: "affectation rejetée",
};

export interface Overview {
  candidats: number;
  candidats_avec_cv_indexe: number;
  extraits_en_attente_de_vecteur: number;
  autres_documents: number;
  candidatures: { total: number; par_statut: Record<string, number>; sans_offre: number; "7_derniers_jours": number };
  offres: { par_statut: Record<string, number>; places_ouvertes: number; places_pourvues: number };
  affectations: Record<string, number>;
  demandes_echange_en_attente: number;
  notes: number;
}

export interface RosterRow {
  candidate_id: number;
  name: string;
  field_of_study?: string;
  education_level?: string;
  university?: string;
  last_status?: string;
  last_offer?: string;
  applications?: number;
  assignment_status?: string;
  assignment_offer?: string;
  notes?: number;
  cv_indexed?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function statusList(counts: Record<string, number>, labels: Record<string, string>): string {
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${labels[k] ?? k}`);
  return parts.length ? parts.join(", ") : "aucune";
}

/** Une ligne par candidat, sans e-mail ni téléphone. */
export function rosterLine(r: RosterRow): string {
  const profile = [r.field_of_study, r.education_level, r.university].filter(Boolean).join(", ");
  const parts = [`#${r.candidate_id} ${r.name}`];
  if (profile) parts.push(profile);
  if (r.last_status) {
    const offer = r.last_offer ? `« ${r.last_offer} »` : "candidature spontanée";
    const more = (r.applications ?? 1) > 1 ? ` (+${(r.applications ?? 1) - 1} autre)` : "";
    parts.push(`${offer} : ${STATUS_LABEL[r.last_status] ?? r.last_status}${more}`);
  }
  if (r.assignment_status) {
    parts.push(`${ASSIGNMENT_LABEL[r.assignment_status] ?? r.assignment_status} « ${r.assignment_offer ?? "?"} »`);
  }
  parts.push(r.cv_indexed ? "CV indexé" : "pas de CV indexé");
  if (r.notes) parts.push(plural(r.notes, "note", "notes"));
  return `- ${parts.join(" — ")}`;
}

export function formatSnapshot(o: Overview, roster: RosterRow[], today = new Date()): string {
  const lines = [
    `INSTANTANÉ de la base au ${today.toISOString().slice(0, 10)} (à jour, fiable pour les chiffres) :`,
    `- ${plural(o.candidats, "candidat", "candidats")}, dont ${o.candidats_avec_cv_indexe} avec un CV indexé` +
      (o.extraits_en_attente_de_vecteur ? ` (${o.extraits_en_attente_de_vecteur} extraits en cours de vectorisation)` : "") +
      (o.autres_documents ? ` ; ${plural(o.autres_documents, "autre document", "autres documents")}` : "") +
      ".",
    `- ${plural(o.candidatures.total, "candidature", "candidatures")} : ${statusList(o.candidatures.par_statut, STATUS_LABEL)}` +
      (o.candidatures.sans_offre ? ` ; ${o.candidatures.sans_offre} sans offre (vivier)` : "") +
      (o.candidatures["7_derniers_jours"] ? ` ; ${o.candidatures["7_derniers_jours"]} ces 7 derniers jours` : "") +
      ".",
    `- Offres : ${statusList(o.offres.par_statut, { open: "ouvertes", closed: "clôturées", draft: "en brouillon" })} ;` +
      ` ${o.offres.places_ouvertes} places sur les offres ouvertes, ${o.offres.places_pourvues} pourvues.`,
    `- Affectations : ${statusList(o.affectations, { confirmed: "confirmées", proposed: "proposées", rejected: "rejetées" })}.` +
      (o.demandes_echange_en_attente ? ` ${o.demandes_echange_en_attente} demande(s) d'échange d'offre en attente.` : ""),
  ];
  if (o.notes) lines.push(`- ${plural(o.notes, "note", "notes")} de recruteur enregistrée(s).`);

  if (roster.length && o.candidats <= ROSTER_LIMIT) {
    lines.push("", "REGISTRE DES CANDIDATS (dernière candidature d'abord) :", ...roster.map(rosterLine));
  } else if (o.candidats > ROSTER_LIMIT) {
    lines.push("", `Registre trop long pour être affiché ici : utilise find_candidates pour lister ou filtrer.`);
  }
  return lines.join("\n");
}

/** Construit l'instantané ; en cas d'échec, le dit au modèle au lieu de bloquer. */
export async function buildSnapshot(): Promise<string> {
  try {
    const [overview, roster] = await Promise.all([
      rpc<Overview>("assistant_overview"),
      rpc<RosterRow[]>("assistant_roster", { p_limit: ROSTER_LIMIT }),
    ]);
    return formatSnapshot(overview, roster ?? []);
  } catch (err) {
    console.error("[assistant] instantané indisponible :", err);
    return "INSTANTANÉ indisponible : utilise find_candidates et get_candidate pour toute question sur les candidats.";
  }
}
