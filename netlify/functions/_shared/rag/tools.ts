// Exécution des outils de l'agent : { charge utile pour le modèle, sources pour l'UI }.
//
// Les arguments viennent du MODÈLE, donc ils sont douteux : chaque valeur est
// bornée ou validée avant d'atteindre la base. `top_k: "beaucoup"` donnait
// autrefois NaN, puis une liste vide présentée comme un vrai résultat négatif.
import { admin } from "../supabase";
import { loadApplicantPool, loadOpenOffersWithSkills } from "../db";
import { buildFieldProfile, rankApplicants } from "../ranking";
import { candidateEmptyAnswer, getScoreBreakdown, retrieveCandidates } from "./candidates";
import { detectLanguage } from "./language";
import { retrieveDocChunks } from "./retrieval";
import { getStore } from "./store";
import { isDocType } from "./types";

export type ToolArgs = Record<string, unknown>;

export interface ToolResult {
  payload: unknown;
  sources: unknown[];
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Nombre positif optionnel : toute valeur inexploitable vaut « non précisé ». */
export function optionalNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const optionalString = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

const OFFER_STATUSES = new Set(["open", "closed", "draft"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function searchCandidatesTool(args: ToolArgs): Promise<ToolResult> {
  const query = String(args.query ?? "");
  const { results, diag } = await retrieveCandidates(query, {
    minYearsExperience: optionalNumber(args.min_years_experience),
    educationLevel: optionalString(args.education_level),
    topK: clampInt(args.top_k, 1, 20, 5),
  });
  if (results.length) return { payload: { candidates: results, diagnostic: diag }, sources: results };
  return {
    payload: {
      candidates: [],
      diagnostic: diag,
      // La phrase d'explication est déjà calculée : le modèle n'invente pas de raison.
      explication: candidateEmptyAnswer(diag, detectLanguage(query)),
      // La personne peut figurer dans un document déposé sans être candidate.
      prochaine_etape:
        "Aucun candidat trouvé. Appelle search_documents avec la même requête " +
        "avant de répondre : la personne peut apparaître dans un document déposé.",
    },
    sources: [],
  };
}

async function rankCandidatesTool(args: ToolArgs): Promise<ToolResult> {
  const skills = Array.isArray(args.skills)
    ? args.skills.filter((x): x is string => typeof x === "string" && x.trim() !== "")
    : typeof args.skills === "string" && args.skills.trim()
      ? args.skills.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
      : [];

  const [offers, pool] = await Promise.all([loadOpenOffersWithSkills(), loadApplicantPool()]);
  const built = buildFieldProfile(
    {
      field: optionalString(args.field),
      offer: optionalString(args.offer),
      skills,
      minEducationLevel: optionalString(args.min_education_level),
    },
    offers,
  );
  if (!built.ok) {
    // Pas de devinette : on rend au modèle la liste de ce qui existe.
    return { payload: { erreur: built.error, disponibles: built.known }, sources: [] };
  }

  const ranking = rankApplicants(built.profile, pool, clampInt(args.top_k, 1, 10, 5));
  return {
    payload: ranking.results.length
      ? ranking
      : {
          ...ranking,
          explication:
            `Aucun des ${ranking.evaluated} candidats analysés ne couvre les critères ` +
            `de « ${ranking.profile} ». Dis-le en une phrase.`,
        },
    sources: ranking.results.map((r) => ({ type: "ranked_candidate", ...r })),
  };
}

async function searchDocumentsTool(args: ToolArgs): Promise<ToolResult> {
  const chunks = await retrieveDocChunks(
    String(args.query ?? ""),
    clampInt(args.top_k, 1, 20, 5),
    isDocType(args.doc_type) ? args.doc_type : null,
  );
  if (chunks.length) {
    // Texte déposé par un tiers : étiqueté pour être traité en donnée, pas en consigne.
    return {
      payload: { extraits: chunks.map((c) => ({ ...c, contenu_non_fiable: true })) },
      sources: chunks,
    };
  }
  // Distinguer « base vide » de « aucun résultat », sinon le modèle relance la
  // même recherche en boucle avec d'autres mots.
  const count = await getStore().countChunks();
  return {
    payload: {
      extraits: [],
      base_documentaire_vide: count === 0,
      explication: count
        ? "Aucun extrait ne correspond. Ne relance pas la même recherche : " +
          "dis-le en une phrase et arrête-toi."
        : "La base documentaire ne contient aucun document. Dis-le franchement " +
          "et invite à déposer un document. N'appelle plus cet outil.",
    },
    sources: [],
  };
}

async function explainScoreTool(args: ToolArgs): Promise<ToolResult> {
  const id = Number(args.assignment_id);
  if (!Number.isInteger(id) || id <= 0) {
    return { payload: { erreur: "assignment_id invalide" }, sources: [] };
  }
  const res = await getScoreBreakdown(id);
  return { payload: res ?? { erreur: "Affectation introuvable" }, sources: res ? [res] : [] };
}

async function listOffersTool(args: ToolArgs): Promise<ToolResult> {
  const status = optionalString(args.status) ?? "open";
  if (!OFFER_STATUSES.has(status)) {
    return { payload: { erreur: `Statut inconnu : ${status} (open, closed ou draft)` }, sources: [] };
  }
  const { data, error } = await admin()
    .from("internship_offers")
    .select("id, title, field, slots, status, min_education_level, department:departments(name)")
    .eq("status", status);
  if (error) return { payload: { erreur: error.message }, sources: [] };
  return { payload: { offres: data ?? [] }, sources: [] };
}

async function listBookingsTool(args: ToolArgs): Promise<ToolResult> {
  const from = optionalString(args.from);
  const to = optionalString(args.to);
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
    return { payload: { erreur: "Dates attendues au format AAAA-MM-JJ" }, sources: [] };
  }
  const { data, error } = await admin()
    .from("assignments")
    .select(
      "id, status, candidate:candidates(first_name, last_name), " +
        "offer:internship_offers(title, department:departments(name)), " +
        "application:applications(start_date, end_date, duration_months)",
    )
    .eq("status", "confirmed");
  if (error) return { payload: { erreur: error.message }, sources: [] };
  // Une réservation est retenue si elle CHEVAUCHE la fenêtre demandée.
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).filter((r) => {
    const raw = r.application as Record<string, string | null> | Record<string, string | null>[];
    const app = Array.isArray(raw) ? raw[0] : raw;
    const start = app?.start_date ?? null;
    const end = app?.end_date ?? null;
    if (!start || !end) return !from && !to;
    if (from && end < from) return false;
    if (to && start > to) return false;
    return true;
  });
  return { payload: { reservations: rows }, sources: [] };
}

const HANDLERS: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
  search_candidates: searchCandidatesTool,
  rank_candidates: rankCandidatesTool,
  search_documents: searchDocumentsTool,
  explain_assignment_score: explainScoreTool,
  list_offers: listOffersTool,
  list_bookings: listBookingsTool,
};

export async function runTool(name: string, args: ToolArgs): Promise<ToolResult> {
  const handler = HANDLERS[name];
  if (!handler) return { payload: { erreur: `Outil inconnu : ${name}` }, sources: [] };
  return handler(args ?? {});
}
