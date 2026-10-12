// Types publics du RAG. Les formes `*Source` sont un contrat avec l'interface
// (frontend/src/api/types.ts) : elles arrivent telles quelles dans l'événement
// SSE `sources` et dans assistant_messages.sources.

/** Nature d'un document : un CV, ou le reste (compte rendu, fiche…). */
export type DocType = "cv" | "other";
export const DOC_TYPES: readonly DocType[] = ["cv", "other"];

export function isDocType(value: unknown): value is DocType {
  return typeof value === "string" && (DOC_TYPES as readonly string[]).includes(value);
}

/** Texte d'une page (PDF) ou du document entier (page = null). */
export interface PageText {
  page: number | null;
  text: string;
}

/** Un extrait prêt à être enregistré. */
export interface Chunk {
  content: string;
  page: number | null;
  heading: string | null;
}

export interface ChunkSource {
  type: "doc_chunk";
  source_document: string;
  chunk_index: number;
  text: string;
  /**
   * Pertinence ABSOLUE dans [0, 1], comparable d'une requête à l'autre :
   * max(rang plein-texte, cosinus recalé au-dessus de MIN_COSINE).
   * Jamais normalisée sur le meilleur résultat.
   */
  similarity: number;
  doc_type: DocType;
  page: number | null;
  heading: string | null;
  /** Titre affiché du document (« CV — Yasmine El Amrani ») ; null = son nom. */
  title?: string | null;
  /** Candidat auquel appartient le document (un CV), sinon null. */
  candidate_id?: number | null;
}

export interface CandidateSource {
  type: "candidate";
  candidate_id: number;
  name: string;
  education_level: string | null;
  field_of_study: string | null;
  years_experience: number;
  skills: string[];
  /** Score ABSOLU (ts_rank_cd ou correspondance de nom) dans [0, 1]. */
  similarity: number;
}

/** Pourquoi une recherche de candidats est revenue vide. */
export interface CandidateSearchDiag {
  scanned: number;
  /** Correspondances aux termes, avant les filtres années / formation. */
  termMatches: number;
  excludedByYears: number;
  excludedByEducation: number;
  /** Parmi les exclus par les années, ceux dont l'expérience est inconnue (0). */
  experienceUnknown: number;
  minYears: number | null;
}

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

/** Un document de la base, tel que listé dans le panneau d'administration. */
export interface KnowledgeDocument {
  source_document: string;
  chunks: number;
  doc_type: DocType;
  /** Extraits déjà vectorisés ; < chunks tant que la tâche de fond travaille. */
  embedded: number;
  title: string | null;
  candidate_id: number | null;
  candidate_name: string | null;
}

/** Ligne renvoyée par la RPC rag_search_chunks. */
export interface SearchRow {
  chunk_id: number;
  source_document: string;
  doc_type: DocType;
  chunk_index: number;
  page: number | null;
  heading: string | null;
  content: string;
  fts_rank: number;
  cosine: number | null;
  score: number;
  title: string | null;
  candidate_id: number | null;
}
