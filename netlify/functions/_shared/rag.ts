// Socle de RÉCUPÉRATION du RAG serverless (Supabase). Aucune génération ici :
// c'est l'agent (./agent.ts) qui parle au modèle, ce module ne fait que fournir
// les données sur lesquelles il s'appuie.
//
// Trois sources, toutes interrogées côté Postgres :
//   retrieveCandidates    RPC search_candidates    (FTS pondérée + trigrammes)
//   getScoreBreakdown     lecture de assignments.score_breakdown
//   retrieveDocChunks     RPC search_document_chunks (FTS bilingue)
//
// La pertinence renvoyée (`similarity`) est un score ABSOLU issu de ts_rank_cd,
// comparable d'une requête à l'autre — surtout pas une valeur normalisée sur le
// meilleur résultat, qui afficherait 100 % même pour un extrait hors sujet.
// Le pendant Python de ce module est backend/app/services/rag/retriever.py ; il
// s'appuie sur pgvector et ses scores ne sont donc PAS sur la même échelle.
import { admin } from "./supabase";

export type Lang = "fr" | "en";

// ---- Query-language detection (stopword heuristic; ties default to French) ---

const FR_WORDS = new Set(
  "le la les un une des du de et est sont quelle quel quels quelles pourquoi comment combien avec pour dans qui que quoi sur pas plus trouve cherche moi mon ma mes ce cette ces son sa ses stage durée politique règle candidat compétence expérience être avoir fait ans an mois".split(
    " ",
  ),
);
const EN_WORDS = new Set(
  "the a an and is are was were what which why how much many with for in on who that this these those find search show me my of to from do does can could should would internship policy rule candidate skill experience years year months".split(
    " ",
  ),
);

export function detectLanguage(text: string): Lang {
  const lower = text.toLowerCase();
  const words = lower.match(/[a-zà-ÿ']+/g) ?? [];
  let fr = words.filter((w) => FR_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  // Accents → français. Compté sur la version en minuscules : la classe ne liste
  // que des minuscules, donc une question en capitales ne marquait aucun point.
  fr += (lower.match(/[àâçéèêëîïôùûüÿœ]/g) ?? []).length;
  return en > fr ? "en" : "fr";
}

// ---- Source 1 : recherche de candidats ---------------------------------------

export interface CandidateSource {
  type: "candidate";
  candidate_id: number;
  name: string;
  education_level: string | null;
  field_of_study: string | null;
  years_experience: number;
  skills: string[];
  /** Score ABSOLU ts_rank_cd dans [0, 1[ — comparable d'une requête à l'autre. */
  similarity: number;
}

/** Why a search came back empty — a bare "no results" hides the real cause. */
export interface CandidateSearchDiag {
  scanned: number;
  /** Matched the query terms, before the years / education filters. */
  termMatches: number;
  excludedByYears: number;
  excludedByEducation: number;
  /** Among those excluded by the years filter, how many have no experience on file. */
  experienceUnknown: number;
  minYears: number | null;
}

interface CandidateRow {
  candidate_id: number;
  name: string;
  education_level: string | null;
  field_of_study: string | null;
  years_experience: number | string | null;
  skills: string[] | null;
  rank: number | string | null;
}

/**
 * Recherche de candidats, entièrement déléguée à Postgres (RPC search_candidates).
 *
 * Les filtres `min_years` / `education` partent avec la requête : ils sont
 * appliqués en SQL, pas après coup sur un jeu de lignes déjà rapatrié. Le
 * diagnostic n'est demandé QUE si le résultat est vide — c'est un comptage sur
 * toute la table, inutile de le payer sur le chemin nominal.
 */
export async function retrieveCandidates(
  query: string,
  opts: { minYearsExperience?: number | null; educationLevel?: string | null; topK?: number } = {},
): Promise<{ results: CandidateSource[]; diag: CandidateSearchDiag }> {
  const sb = admin();
  const minYears = opts.minYearsExperience ?? null;
  const education = opts.educationLevel ?? null;

  const { data, error } = await sb.rpc("search_candidates", {
    q: query,
    min_years: minYears,
    education,
    top_k: opts.topK ?? 5,
  });
  if (error) throw new Error(error.message);

  const results: CandidateSource[] = ((data ?? []) as CandidateRow[]).map((r) => ({
    type: "candidate",
    candidate_id: r.candidate_id,
    name: r.name,
    education_level: r.education_level,
    field_of_study: r.field_of_study,
    years_experience: Number(r.years_experience ?? 0),
    skills: r.skills ?? [],
    similarity: Math.round(Number(r.rank ?? 0) * 10000) / 10000,
  }));

  if (results.length) {
    return { results, diag: { ...EMPTY_DIAG, scanned: results.length, termMatches: results.length, minYears } };
  }
  return { results, diag: await candidateDiag(query, minYears, education) };
}

const EMPTY_DIAG: CandidateSearchDiag = {
  scanned: 0,
  termMatches: 0,
  excludedByYears: 0,
  excludedByEducation: 0,
  experienceUnknown: 0,
  minYears: null,
};

interface DiagRow {
  scanned: number | string;
  term_matches: number | string;
  excluded_by_years: number | string;
  excluded_by_education: number | string;
  experience_unknown: number | string;
}

/** Comptages expliquant une recherche vide. Le diagnostic ne doit jamais lever. */
async function candidateDiag(
  query: string,
  minYears: number | null,
  education: string | null,
): Promise<CandidateSearchDiag> {
  try {
    const { data, error } = await admin().rpc("search_candidates_diag", {
      q: query,
      min_years: minYears,
      education,
    });
    if (error) throw new Error(error.message);
    const row = (data as DiagRow[] | null)?.[0];
    if (!row) return { ...EMPTY_DIAG, minYears };
    return {
      scanned: Number(row.scanned),
      termMatches: Number(row.term_matches),
      excludedByYears: Number(row.excluded_by_years),
      excludedByEducation: Number(row.excluded_by_education),
      experienceUnknown: Number(row.experience_unknown),
      minYears,
    };
  } catch (err) {
    console.error("candidate diagnostic failed:", err);
    return { ...EMPTY_DIAG, minYears };
  }
}
/** Empty-result message that names the cause instead of a bare "no results". */
export function candidateEmptyAnswer(diag: CandidateSearchDiag, lang: Lang = "fr"): string {
  const fr = lang === "fr";
  if (diag.scanned === 0) {
    return fr
      ? "Aucun candidat n'est encore enregistré. Importez des CV depuis la page Candidatures."
      : "No candidates recorded yet. Import CVs from the Applications page.";
  }
  if (diag.termMatches === 0) {
    return fr
      ? `Aucun des ${diag.scanned} candidats ne correspond aux termes de la recherche. ` +
          `La recherche porte sur les compétences extraites, la filière et le texte du CV.`
      : `None of the ${diag.scanned} candidates match the search terms. ` +
          `The search covers extracted skills, field of study and CV text.`;
  }
  if (diag.excludedByYears > 0) {
    const unknown = diag.experienceUnknown;
    const base = fr
      ? `${diag.termMatches} candidat(s) correspondent à la recherche, mais aucun n'atteint ` +
        `${diag.minYears} an(s) d'expérience.`
      : `${diag.termMatches} candidate(s) match the search, but none reach ` +
        `${diag.minYears} year(s) of experience.`;
    if (unknown === 0) return base;
    return fr
      ? `${base} Attention : pour ${unknown} d'entre eux l'expérience n'a pas pu être ` +
          `extraite du CV (enregistrée à 0). Relancez l'analyse de leur CV ou retirez ce critère.`
      : `${base} Note: for ${unknown} of them the experience could not be extracted from ` +
          `the CV (stored as 0). Re-run their CV analysis or drop this filter.`;
  }
  if (diag.excludedByEducation > 0) {
    return fr
      ? `${diag.termMatches} candidat(s) correspondent à la recherche, mais aucun n'a le ` +
          `niveau d'études demandé.`
      : `${diag.termMatches} candidate(s) match the search, but none have the requested ` +
          `education level.`;
  }
  return fr
    ? "Aucun résultat ne correspond à cette recherche."
    : "No results match this search.";
}

// ---- Skill 2: matching-score explanation -------------------------------------

export interface ExplanationSource {
  type: "matching_explanation";
  assignment_id: number;
  match_score: number;
  score_breakdown: Record<string, unknown> | null;
  status: string;
  candidate: {
    name: string;
    education_level: string | null;
    field_of_study: string | null;
    years_experience: number;
    skills: string[];
  };
  offer: { title: string; min_education_level: string | null; required_skills: string[] };
}

export async function getScoreBreakdown(assignmentId: number): Promise<ExplanationSource | null> {
  const sb = admin();
  const { data: a, error } = await sb
    .from("assignments")
    .select(
      `id, match_score, score_breakdown, status,
       candidate:candidates(first_name, last_name, education_level, field_of_study,
         years_experience, candidate_skills(skill:skills(name))),
       offer:internship_offers(title, min_education_level, offer_skills(skill:skills(name)))`,
    )
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!a) return null;

  const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const skillNames = (list: unknown): string[] =>
    ((list as { skill: { name: string } | { name: string }[] | null }[]) ?? [])
      .map((x) => {
        const s = x.skill;
        return Array.isArray(s) ? s[0]?.name : s?.name;
      })
      .filter(Boolean)
      .sort() as string[];

  const cand = one(a.candidate) as Record<string, unknown> | null;
  const offer = one(a.offer) as Record<string, unknown> | null;
  if (!cand || !offer) return null;
  return {
    type: "matching_explanation",
    assignment_id: a.id,
    match_score: Number(a.match_score ?? 0),
    score_breakdown: a.score_breakdown,
    status: a.status,
    candidate: {
      name: `${cand.first_name} ${cand.last_name}`.trim(),
      education_level: (cand.education_level as string) ?? null,
      field_of_study: (cand.field_of_study as string) ?? null,
      years_experience: Number(cand.years_experience ?? 0),
      skills: skillNames(cand.candidate_skills),
    },
    offer: {
      title: offer.title as string,
      min_education_level: (offer.min_education_level as string) ?? null,
      required_skills: skillNames(offer.offer_skills),
    },
  };
}

// ---- Skill 3: policy-document Q&A (full-text search) -------------------------

export interface ChunkSource {
  type: "doc_chunk";
  source_document: string;
  chunk_index: number;
  text: string;
  similarity: number;
}

/**
 * Seuil de pertinence absolu. Depuis que la recherche relie les termes par OU,
 * un extrait partageant un seul mot courant avec la question ressort ; sans
 * plancher il arrivait jusqu'au modèle et servait de « source » à la réponse.
 */
export const MIN_RELEVANCE = 0.02;

export async function retrieveDocChunks(query: string, topK = 5): Promise<ChunkSource[]> {
  const sb = admin();
  const { data, error } = await sb.rpc("search_document_chunks", { q: query, top_k: topK });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    source_document: string;
    chunk_index: number;
    chunk_text: string;
    rank: number | string;
  }[];

  const chunks = rows.map((r) => ({
    type: "doc_chunk" as const,
    source_document: r.source_document,
    chunk_index: r.chunk_index,
    text: r.chunk_text,
    // Le rang est déjà borné dans [0, 1[ par ts_rank_cd : on le publie tel quel.
    // Le normaliser sur le meilleur résultat plaçait TOUJOURS le premier extrait
    // à 100 %, y compris quand il était hors sujet.
    similarity: Math.round(Number(r.rank ?? 0) * 10000) / 10000,
  }));

  return dedupeAdjacent(chunks.filter((c) => c.similarity >= MIN_RELEVANCE));
}

/**
 * Deux extraits voisins d'un même document partagent CHUNK_OVERLAP caractères :
 * les garder tous deux consomme plusieurs des rares places de contexte pour
 * répéter le même passage. On conserve le mieux classé.
 */
function dedupeAdjacent(chunks: ChunkSource[]): ChunkSource[] {
  const kept: ChunkSource[] = [];
  for (const c of chunks) {
    const redundant = kept.some(
      (k) => k.source_document === c.source_document && Math.abs(k.chunk_index - c.chunk_index) <= 1,
    );
    if (!redundant) kept.push(c);
  }
  return kept;
}

/** Documents ingérés et leur nombre d'extraits, comptés en SQL. */
export async function listDocumentCounts(): Promise<
  { source_document: string; chunks: number }[]
> {
  const { data, error } = await admin().rpc("list_document_chunk_counts");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { source_document: string; chunks: number | string }[]).map((r) => ({
    source_document: r.source_document,
    chunks: Number(r.chunks),
  }));
}

// ---- Ingestion ---------------------------------------------------------------

const CHUNK_SIZE = 1600;
const CHUNK_OVERLAP = 200;

/** Paragraph-aware splitter (~300-500 tokens per chunk with overlap). */
export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      // Séparateurs par ORDRE DE PRIORITÉ, pas par position : un Math.max sur
      // les index retenait toujours le plus à droite, donc la dernière espace.
      // Les coupures par paragraphe et par phrase annoncées ici n'avaient donc
      // jamais lieu et les extraits partaient au milieu d'une phrase.
      const window = clean.slice(start, end);
      for (const sep of ["\n\n", ". ", "\n", " "]) {
        const at = window.lastIndexOf(sep);
        if (at > CHUNK_SIZE / 2) {
          end = start + at + sep.length;
          break;
        }
      }
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Remplace tous les extraits de `sourceDocument` par ceux de `text`.
 *
 * Le suppression-puis-insertion se fait dans UNE transaction côté Postgres : en
 * deux requêtes, une insertion en échec laissait le document supprimé et
 * définitivement perdu, l'appelant ne recevant qu'une erreur 500.
 */
export async function ingestDocumentText(sourceDocument: string, text: string): Promise<number> {
  const chunks = chunkText(text);
  const { data, error } = await admin().rpc("replace_document_chunks", {
    p_source_document: sourceDocument,
    p_chunks: chunks,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}
