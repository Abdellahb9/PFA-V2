// Recherche de candidats et explication d'un score d'affectation.
//
// La recherche est entièrement déléguée à Postgres (RPC search_candidates,
// pré-filtrée par index depuis 0019) : filtres et plancher partent avec la
// requête. Le diagnostic n'est demandé QUE si le résultat est vide.
import { admin } from "../supabase";
import { MIN_CANDIDATE_RELEVANCE } from "./config";
import type { Lang } from "./language";
import type { CandidateSearchDiag, CandidateSource, ExplanationSource } from "./types";

interface CandidateRow {
  candidate_id: number;
  name: string;
  education_level: string | null;
  field_of_study: string | null;
  years_experience: number | string | null;
  skills: string[] | null;
  rank: number | string | null;
}

interface DiagRow {
  scanned: number | string;
  term_matches: number | string;
  excluded_by_years: number | string;
  excluded_by_education: number | string;
  experience_unknown: number | string;
}

const EMPTY_DIAG: CandidateSearchDiag = {
  scanned: 0,
  termMatches: 0,
  excludedByYears: 0,
  excludedByEducation: 0,
  experienceUnknown: 0,
  minYears: null,
};

export async function retrieveCandidates(
  query: string,
  opts: { minYearsExperience?: number | null; educationLevel?: string | null; topK?: number } = {},
): Promise<{ results: CandidateSource[]; diag: CandidateSearchDiag }> {
  const minYears = opts.minYearsExperience ?? null;
  const education = opts.educationLevel ?? null;

  const { data, error } = await admin().rpc("search_candidates", {
    q: query,
    min_years: minYears,
    education,
    top_k: opts.topK ?? 5,
  });
  if (error) throw new Error(error.message);

  const results: CandidateSource[] = ((data ?? []) as CandidateRow[])
    .map((r) => ({
      type: "candidate" as const,
      candidate_id: Number(r.candidate_id),
      name: r.name,
      education_level: r.education_level,
      field_of_study: r.field_of_study,
      years_experience: Number(r.years_experience ?? 0),
      skills: r.skills ?? [],
      similarity: Math.round(Number(r.rank ?? 0) * 10000) / 10000,
    }))
    // Plancher ré-appliqué ici : l'interface affiche ce tableau comme une
    // PREUVE, mieux vaut ne rien montrer que trois profils sans rapport.
    // Une recherche purement structurée (rang 0, filtres posés) reste valide.
    .filter(
      (r) =>
        r.similarity >= MIN_CANDIDATE_RELEVANCE ||
        (!query.trim() && (minYears != null || education != null)),
    );

  if (results.length) {
    return {
      results,
      diag: { ...EMPTY_DIAG, scanned: results.length, termMatches: results.length, minYears },
    };
  }
  return { results, diag: await candidateDiag(query, minYears, education) };
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
    console.error("[rag] candidate diagnostic failed:", err);
    return { ...EMPTY_DIAG, minYears };
  }
}

/** Phrase d'explication d'une recherche vide, qui nomme la cause. */
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
    const base = fr
      ? `${diag.termMatches} candidat(s) correspondent à la recherche, mais aucun n'atteint ` +
        `${diag.minYears} an(s) d'expérience.`
      : `${diag.termMatches} candidate(s) match the search, but none reach ` +
        `${diag.minYears} year(s) of experience.`;
    if (diag.experienceUnknown === 0) return base;
    return fr
      ? `${base} Attention : pour ${diag.experienceUnknown} d'entre eux l'expérience n'a pas pu ` +
          `être extraite du CV (enregistrée à 0). Relancez l'analyse de leur CV ou retirez ce critère.`
      : `${base} Note: for ${diag.experienceUnknown} of them the experience could not be ` +
          `extracted from the CV (stored as 0). Re-run their CV analysis or drop this filter.`;
  }
  if (diag.excludedByEducation > 0) {
    return fr
      ? `${diag.termMatches} candidat(s) correspondent à la recherche, mais aucun n'a le ` +
          `niveau d'études demandé.`
      : `${diag.termMatches} candidate(s) match the search, but none have the requested ` +
          `education level.`;
  }
  return fr ? "Aucun résultat ne correspond à cette recherche." : "No results match this search.";
}

/** Tout ce qu'il faut pour expliquer le score d'une affectation. */
export async function getScoreBreakdown(assignmentId: number): Promise<ExplanationSource | null> {
  const { data: a, error } = await admin()
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
      .filter((n): n is string => Boolean(n))
      .sort();

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
      name: `${cand.first_name ?? ""} ${cand.last_name ?? ""}`.trim(),
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
