// Exécution des outils de l'assistant : { charge utile pour le modèle, sources pour l'UI }.
//
// Les arguments viennent du MODÈLE, donc ils sont douteux : chaque valeur est
// bornée ou validée avant d'atteindre la base. Toutes les lectures passent par
// les RPC de la migration 0021 (lib/rpc.ts), une par outil.
import { buildFieldProfile, rankApplicants, type ApplicantRecord, type OfferRecord } from "../ranking";
import { getStore, retrieveDocChunks } from "../rag";
import { rpc } from "../rpc";

export type ToolArgs = Record<string, unknown>;

export interface ToolResult {
  payload: unknown;
  sources: unknown[];
}

/** Qui pose la question : l'auteur des notes enregistrées par save_note. */
export interface ToolContext {
  user?: { id: string | null; name: string | null };
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

const stringList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : typeof v === "string" && v.trim()
      ? v.split(/[,;]/).map((x) => x.trim()).filter(Boolean)
      : [];

const OFFER_STATUSES = new Set(["open", "closed", "draft"]);
const APPLICATION_STATUSES = new Set([
  "submitted", "parsing", "parsed", "under_review", "assigned", "rejected", "failed",
]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_CHARS = 2000;

// ---- Résolution d'un nom -------------------------------------------------------------

interface Match {
  candidate_id: number;
  name: string;
  field_of_study: string | null;
  match: "id" | "email" | "nom_exact" | "nom_proche";
  similarity: number;
}

type Resolved = { ok: true; candidate: Match } | { ok: false; payload: unknown };

/**
 * Un nom, un identifiant ou un e-mail → UN candidat, ou la liste des candidats
 * possibles. « Amrani » désigne deux personnes : on ne choisit jamais à la place
 * de l'utilisateur.
 */
export async function resolveCandidate(ref: unknown): Promise<Resolved> {
  const q = optionalString(ref);
  if (!q) return { ok: false, payload: { erreur: "Candidat non précisé." } };
  const hits = (await rpc<Match[]>("assistant_resolve_candidate", { q, p_limit: 5 })) ?? [];
  if (!hits.length) {
    return {
      ok: false,
      payload: {
        introuvable: q,
        explication:
          "Aucun candidat ne porte ce nom. Avant de conclure, cherche-le dans les CV (search_cvs) : " +
          "la personne peut apparaître dans un document.",
      },
    };
  }
  const certain = hits.filter((h) => h.match !== "nom_proche");
  if (certain.length === 1) return { ok: true, candidate: certain[0] };
  if (hits.length === 1 || hits[0].similarity - hits[1].similarity >= 0.2) {
    return { ok: true, candidate: hits[0] };
  }
  return {
    ok: false,
    payload: {
      ambigu: q,
      candidats_possibles: hits.map((h) => ({
        candidate_id: h.candidate_id,
        name: h.name,
        field_of_study: h.field_of_study,
      })),
      explication: "Plusieurs candidats correspondent : cite-les et demande lequel avant de répondre.",
    },
  };
}

// ---- Outils ------------------------------------------------------------------------------

type Dossier = Record<string, unknown> & {
  candidate_id: number;
  name: string;
  field_of_study?: string;
  applications?: { offer?: string; status?: string }[];
};

async function getCandidateTool(args: ToolArgs): Promise<ToolResult> {
  const r = await resolveCandidate(args.candidate);
  if (!r.ok) return { payload: r.payload, sources: [] };
  const dossier = await rpc<Dossier | null>("assistant_candidate_dossier", { p_id: r.candidate.candidate_id });
  if (!dossier) return { payload: { erreur: "Dossier introuvable." }, sources: [] };
  const last = dossier.applications?.[0];
  return {
    payload: { dossier },
    sources: [
      {
        type: "candidate_dossier",
        candidate_id: dossier.candidate_id,
        name: dossier.name,
        field_of_study: dossier.field_of_study ?? null,
        status: last?.status ?? null,
        offer: last?.offer ?? null,
      },
    ],
  };
}

async function searchCvsTool(args: ToolArgs): Promise<ToolResult> {
  const query = optionalString(args.query);
  if (!query) return { payload: { erreur: "Requête vide." }, sources: [] };
  let candidate: Match | null = null;
  if (optionalString(args.candidate)) {
    const r = await resolveCandidate(args.candidate);
    if (!r.ok) return { payload: r.payload, sources: [] };
    candidate = r.candidate;
  }
  // Un `doc_type` hors schéma, si le modèle en invente un, est ignoré.
  const chunks = await retrieveDocChunks(query, clampInt(args.top_k, 1, 20, 5), null, candidate?.candidate_id ?? null);
  if (chunks.length) {
    // Texte déposé par un tiers : étiqueté pour être traité en donnée, pas en consigne.
    return {
      payload: {
        ...(candidate ? { cv_de: candidate.name } : {}),
        extraits: chunks.map((c) => ({
          document: c.title ?? c.source_document,
          page: c.page,
          section: c.heading,
          texte: c.text,
          contenu_non_fiable: true,
        })),
      },
      sources: chunks,
    };
  }
  if (candidate) {
    return {
      payload: {
        cv_de: candidate.name,
        extraits: [],
        explication:
          `Ni le CV de ${candidate.name} ni les documents qui le citent ne contiennent rien sur ce point ` +
          `(ou aucun CV n'est indexé : voir get_candidate). Dis-le en une phrase.`,
      },
      sources: [],
    };
  }
  const count = await getStore().countChunks();
  return {
    payload: {
      extraits: [],
      base_vide: count === 0,
      explication: count
        ? "Aucun CV ni document ne mentionne cela. Dis-le en une phrase, sans relancer la même recherche."
        : "Aucun CV n'est encore indexé. Dis-le et propose de réindexer depuis la page Assistant.",
    },
    sources: [],
  };
}

type Row = Record<string, unknown> & { candidate_id: number; name: string };

async function findCandidatesTool(args: ToolArgs): Promise<ToolResult> {
  const status = optionalString(args.status);
  if (status && !APPLICATION_STATUSES.has(status)) {
    return { payload: { erreur: `Statut inconnu : ${status}` }, sources: [] };
  }
  const skills = stringList(args.skills);
  const rows =
    (await rpc<Row[]>("assistant_find_candidates", {
      q: optionalString(args.query),
      p_field: optionalString(args.field),
      p_skills: skills.length ? skills : null,
      p_education: optionalString(args.education_level),
      p_status: status,
      p_offer: optionalString(args.offer),
      p_min_years: optionalNumber(args.min_years_experience),
      p_limit: clampInt(args.limit, 1, 100, 20),
    })) ?? [];
  if (!rows.length) {
    return {
      payload: { candidats: [], explication: "Aucun candidat ne correspond à ces critères. Dis-le en une phrase." },
      sources: [],
    };
  }
  return {
    payload: { nombre: rows.length, candidats: rows },
    sources: rows.map((r) => ({
      type: "candidate",
      candidate_id: r.candidate_id,
      name: r.name,
      education_level: (r.education_level as string) ?? null,
      field_of_study: (r.field_of_study as string) ?? null,
      years_experience: Number(r.years_experience ?? 0),
      skills: (r.skills as string[]) ?? [],
      status: (r.last_status as string) ?? null,
    })),
  };
}

interface PoolJson {
  applicants: {
    candidate_id: number;
    application_id: number;
    name: string;
    status: string;
    education_level: string | null;
    field_of_study: string | null;
    years_experience: number | null;
    skills: Record<string, number>;
  }[];
  offers: {
    offer_id: number;
    title: string;
    field: string | null;
    min_education_level: string | null;
    skills: { skill: string; weight: number; required: boolean }[];
  }[];
}

async function rankCandidatesTool(args: ToolArgs): Promise<ToolResult> {
  const pool = await rpc<PoolJson>("assistant_ranking_pool");
  const offers: OfferRecord[] = (pool?.offers ?? []).map((o) => ({
    offerId: o.offer_id,
    title: o.title,
    field: o.field,
    minEducationLevel: o.min_education_level,
    skills: o.skills.map((s) => ({ skill: s.skill, weight: Number(s.weight ?? 1), required: Boolean(s.required) })),
  }));
  const applicants: ApplicantRecord[] = (pool?.applicants ?? []).map((a) => ({
    candidateId: a.candidate_id,
    applicationId: a.application_id,
    name: a.name,
    status: a.status,
    educationLevel: a.education_level,
    fieldOfStudy: a.field_of_study,
    yearsExperience: Number(a.years_experience ?? 0),
    skills: new Map(Object.entries(a.skills ?? {}).map(([k, w]) => [k, Number(w)])),
  }));
  const built = buildFieldProfile(
    {
      field: optionalString(args.field),
      offer: optionalString(args.offer),
      skills: stringList(args.skills),
      minEducationLevel: optionalString(args.min_education_level),
    },
    offers,
  );
  if (!built.ok) {
    // Pas de devinette : on rend au modèle la liste de ce qui existe.
    return { payload: { erreur: built.error, disponibles: built.known }, sources: [] };
  }
  const ranking = rankApplicants(built.profile, applicants, clampInt(args.top_k, 1, 10, 5));
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

async function listOffersTool(args: ToolArgs): Promise<ToolResult> {
  const status = optionalString(args.status);
  if (status && !OFFER_STATUSES.has(status)) {
    return { payload: { erreur: `Statut inconnu : ${status} (open, closed ou draft)` }, sources: [] };
  }
  const offer = optionalString(args.offer);
  const offres = (await rpc<unknown[]>("assistant_offers", { p_status: status, p_offer: offer })) ?? [];
  if (!offres.length && offer) {
    return { payload: { offres: [], explication: `Aucune offre ne correspond à « ${offer} ».` }, sources: [] };
  }
  return { payload: { offres }, sources: [] };
}

async function listBookingsTool(args: ToolArgs): Promise<ToolResult> {
  const from = optionalString(args.from);
  const to = optionalString(args.to);
  if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to))) {
    return { payload: { erreur: "Dates attendues au format AAAA-MM-JJ" }, sources: [] };
  }
  const reservations = (await rpc<unknown[]>("assistant_bookings", { p_from: from, p_to: to })) ?? [];
  return { payload: { reservations }, sources: [] };
}

async function saveNoteTool(args: ToolArgs, ctx: ToolContext): Promise<ToolResult> {
  const note = optionalString(args.note);
  if (!note) return { payload: { erreur: "Note vide : rien n'a été enregistré." }, sources: [] };
  if (note.length > MAX_NOTE_CHARS) {
    return { payload: { erreur: `Note trop longue (maximum ${MAX_NOTE_CHARS} caractères).` }, sources: [] };
  }
  const r = await resolveCandidate(args.candidate);
  if (!r.ok) return { payload: r.payload, sources: [] };
  const saved = await rpc<{ note_id: number; body: string; at: string }>("assistant_save_note", {
    p_candidate_id: r.candidate.candidate_id,
    p_author_id: ctx.user?.id ?? null,
    p_author_name: ctx.user?.name ?? null,
    p_body: note,
    p_source: "assistant",
  });
  return {
    payload: { note_enregistree: { candidat: r.candidate.name, note: saved.body, le: saved.at } },
    sources: [
      { type: "note", note_id: saved.note_id, candidate_id: r.candidate.candidate_id, name: r.candidate.name, body: saved.body },
    ],
  };
}

// ---- Présentation au modèle -----------------------------------------------------------

/** Scores rendus en pourcentage, sous un nom lisible. */
const SCORE_KEYS: Record<string, string> = {
  match_score: "score_adequation",
  last_score: "score_adequation",
  score: "score_adequation",
  skills_coverage: "couverture_competences",
  education_fit: "adequation_formation",
};

const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Ce que le modèle lit : les scores en pourcentage (« 88 % »), sous des noms
 * lisibles. Il recopiait sinon « match_score = 0.88 » tel quel dans ses
 * réponses. Les sources envoyées à l'interface gardent les valeurs brutes.
 */
export function presentForModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(presentForModel);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "score_breakdown" && v && typeof v === "object") {
      const b = v as Record<string, unknown>;
      out.detail_du_score = {
        competences: typeof b.skills === "number" ? pct(b.skills) : (b.skills ?? null),
        formation: typeof b.education === "number" ? pct(b.education) : (b.education ?? null),
      };
    } else if (key in SCORE_KEYS && typeof v === "number") {
      out[SCORE_KEYS[key]] = pct(v);
    } else {
      out[key] = presentForModel(v);
    }
  }
  return out;
}

const HANDLERS: Record<string, (args: ToolArgs, ctx: ToolContext) => Promise<ToolResult>> = {
  get_candidate: getCandidateTool,
  search_cvs: searchCvsTool,
  find_candidates: findCandidatesTool,
  rank_candidates: rankCandidatesTool,
  list_offers: listOffersTool,
  list_bookings: listBookingsTool,
  save_note: saveNoteTool,
};

export async function runTool(name: string, args: ToolArgs, ctx: ToolContext = {}): Promise<ToolResult> {
  const handler = HANDLERS[name];
  if (!handler) return { payload: { erreur: `Outil inconnu : ${name}` }, sources: [] };
  const res = await handler(args ?? {}, ctx);
  return { payload: presentForModel(res.payload), sources: res.sources };
}
