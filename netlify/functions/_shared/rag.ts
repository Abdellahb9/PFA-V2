// RAG assistant core for the serverless stack (Supabase + Groq, no vectors).
//
// Mirrors backend/app/services/rag/: one retrieval backbone with three skills.
// Retrieval differs by necessity — no embedding model in a function, so:
//   candidate_search        skill/keyword matching over candidates + skills
//   matching_explanation    reads assignments.score_breakdown (no retrieval)
//   policy_qa               Postgres full-text search over document_chunks
// Generation uses Groq when GROQ_API_KEY is set, else deterministic French
// templates — the assistant stays functional without any LLM key.
import Groq from "groq-sdk";
import { admin } from "./supabase";
import { groqEnabled } from "./groq";

export type Intent = "candidate_search" | "matching_explanation" | "policy_qa";
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
  const words = text.toLowerCase().match(/[a-zà-ÿ']+/g) ?? [];
  let fr = words.filter((w) => FR_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  fr += (text.match(/[àâçéèêëîïôùûüÿœ]/g) ?? []).length; // accents → French
  return en > fr ? "en" : "fr";
}

// ---- Intent classification (ported from backend rag/router.py) --------------

const PATTERNS: Record<Intent, RegExp> = {
  candidate_search:
    /\b(candidat|profil|cherche|trouve|recherch\w*|qui (a|sait|maitrise)|candidate|find|search|experience|expérience|compétence|skill)\w*\b/gi,
  matching_explanation:
    /\b(score|matching|affectation|assignment|pourquoi|explique|explain|justifi\w*|breakdown)\b/gi,
  policy_qa:
    /\b(politique|policy|procédure|process(us)?|règle|regle|rule|durée|duree|convention|gratification|rémunération|remuneration|document|charte|combien de (temps|mois|semaines)|comment (faire|demander|obtenir))\b/gi,
};

const CLASSIFY_PROMPT = (q: string) =>
  "Classify this HR assistant query into exactly one category. Reply with the " +
  "category name only.\nCategories: candidate_search (find/filter candidate " +
  "profiles), matching_explanation (explain a candidate-offer matching score), " +
  `policy_qa (question about internship policy/process documents).\nQuery: ${q.slice(0, 1000)}`;

export async function classifyIntent(query: string, assignmentId?: number | null): Promise<Intent> {
  if (assignmentId != null) return "matching_explanation";

  const scores = (Object.keys(PATTERNS) as Intent[]).map((intent) => ({
    intent,
    hits: (query.match(PATTERNS[intent]) ?? []).length,
  }));
  scores.sort((a, b) => b.hits - a.hits);
  if (scores[0].hits > 0 && scores[0].hits > scores[1].hits) return scores[0].intent;

  if (groqEnabled()) {
    try {
      const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const res = await client.chat.completions.create({
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        temperature: 0,
        messages: [{ role: "user", content: CLASSIFY_PROMPT(query) }],
      });
      const content = (res.choices[0]?.message?.content ?? "").toLowerCase();
      for (const intent of Object.keys(PATTERNS) as Intent[]) {
        if (content.includes(intent)) return intent;
      }
    } catch (err) {
      console.error("Intent classification via Groq failed:", err);
    }
  }
  return scores[0].hits > 0 ? scores[0].intent : "policy_qa";
}

// ---- Skill 1: candidate search ----------------------------------------------

export interface CandidateSource {
  type: "candidate";
  candidate_id: number;
  name: string;
  education_level: string | null;
  field_of_study: string | null;
  years_experience: number;
  skills: string[];
  similarity: number; // share of query terms matched, in [0, 1]
}

const MIN_YEARS_RE = /(\d+)\s*(?:\+|ans?|years?)/i;

export async function retrieveCandidates(
  query: string,
  opts: { minYearsExperience?: number | null; educationLevel?: string | null; topK?: number } = {},
): Promise<CandidateSource[]> {
  const sb = admin();
  const topK = opts.topK ?? 5;
  const { data: rows, error } = await sb
    .from("candidates")
    .select(
      "id, first_name, last_name, education_level, field_of_study, years_experience, cv_text, candidate_skills(skill:skills(name))",
    );
  if (error) throw new Error(error.message);

  // Terms from the query (3+ chars) matched against skills / field / CV text.
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-zà-ÿ0-9+#.]+/i)
        .filter((t) => t.length >= 3),
    ),
  ];
  const minYears =
    opts.minYearsExperience ??
    (MIN_YEARS_RE.test(query) ? parseInt(query.match(MIN_YEARS_RE)![1], 10) : null);

  const scored: CandidateSource[] = [];
  for (const r of rows ?? []) {
    const years = Number(r.years_experience ?? 0);
    if (minYears != null && years < minYears) continue;
    if (
      opts.educationLevel &&
      !(r.education_level ?? "").toLowerCase().includes(opts.educationLevel.toLowerCase())
    )
      continue;

    const skills = (r.candidate_skills ?? [])
      .map((cs: { skill: { name: string } | { name: string }[] | null }) => {
        const s = cs.skill;
        return Array.isArray(s) ? s[0]?.name : s?.name;
      })
      .filter(Boolean)
      .sort() as string[];
    const haystackSkills = skills.map((s) => s.toLowerCase());
    const haystackText = `${r.field_of_study ?? ""} ${r.cv_text ?? ""}`.toLowerCase();

    let hits = 0;
    for (const term of terms) {
      if (haystackSkills.some((s) => s.includes(term))) hits += 2; // skill hits weigh double
      else if (haystackText.includes(term)) hits += 1;
    }
    if (hits === 0) continue;

    scored.push({
      type: "candidate",
      candidate_id: r.id,
      name: `${r.first_name} ${r.last_name}`.trim(),
      education_level: r.education_level,
      field_of_study: r.field_of_study,
      years_experience: years,
      skills,
      similarity: Math.min(1, hits / Math.max(1, terms.length)),
    });
  }
  return scored.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
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

export async function retrieveDocChunks(query: string, topK = 5): Promise<ChunkSource[]> {
  const sb = admin();
  const { data, error } = await sb.rpc("search_document_chunks", { q: query, top_k: topK });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as {
    source_document: string;
    chunk_index: number;
    chunk_text: string;
    rank: number;
  }[];
  const maxRank = Math.max(...rows.map((r) => r.rank), 0.0001);
  return rows.map((r) => ({
    type: "doc_chunk",
    source_document: r.source_document,
    chunk_index: r.chunk_index,
    text: r.chunk_text,
    similarity: Math.round((r.rank / maxRank) * 10000) / 10000,
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
      // Prefer breaking on a paragraph, then sentence, then word boundary.
      const window = clean.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
        window.lastIndexOf(" "),
      );
      if (breakAt > CHUNK_SIZE / 2) end = start + breakAt + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
  }
  return chunks;
}

/** Replace all chunks of `sourceDocument` with freshly chunked `text`. */
export async function ingestDocumentText(sourceDocument: string, text: string): Promise<number> {
  const sb = admin();
  const chunks = chunkText(text);
  const del = await sb.from("document_chunks").delete().eq("source_document", sourceDocument);
  if (del.error) throw new Error(del.error.message);
  if (chunks.length === 0) return 0;
  const { error } = await sb.from("document_chunks").insert(
    chunks.map((chunk, index) => ({
      source_document: sourceDocument,
      chunk_text: chunk,
      chunk_index: index,
    })),
  );
  if (error) throw new Error(error.message);
  return chunks.length;
}

// ---- Generation (Groq or deterministic French templates) ----------------------

const LANG_INSTRUCTION: Record<Lang, string> = {
  fr: "Réponds en français.",
  en: "Answer in English.",
};

const NO_ANSWER: Record<Lang, string> = {
  fr: "Je ne trouve pas cette information dans les documents disponibles.",
  en: "I cannot find this information in the available documents.",
};

const GEN_SYSTEM =
  "Tu es l'assistant RH de PHOSBOUCRAA. Tu réponds uniquement à partir des " +
  "données fournies, sans jamais inventer d'information, dans la langue de la question.";

const GEN_PROMPTS: Record<Intent, (query: string, context: string, lang: Lang) => string> = {
  candidate_search: (query, context, lang) =>
    `Voici des profils de candidats retrouvés pour la requête d'un recruteur.\n` +
    `Requête: ${query}\n\nProfils (JSON):\n${context}\n\n` +
    `Résume les candidats les plus pertinents et pourquoi (compétences, expérience, ` +
    `formation). Base-toi UNIQUEMENT sur ces données. ${LANG_INSTRUCTION[lang]}`,
  matching_explanation: (query, context, lang) =>
    `Explique pourquoi ce candidat a obtenu ce score de matching pour cette offre.\n` +
    `Question: ${query}\n\nDonnées de l'affectation (JSON):\n${context}\n\n` +
    `Appuie CHAQUE affirmation sur les chiffres du score_breakdown — n'invente ` +
    `aucune qualité ou lacune qui n'y figure pas. ${LANG_INSTRUCTION[lang]}`,
  policy_qa: (query, context, lang) =>
    `Réponds à la question en te basant UNIQUEMENT sur les extraits ci-dessous.\n` +
    `Question: ${query}\n\nExtraits (JSON, avec source_document):\n${context}\n\n` +
    `Cite pour chaque élément le document source. Si les extraits ne permettent pas ` +
    `de répondre, réponds exactement: "${NO_ANSWER[lang]}" — ne complète jamais ` +
    `avec des connaissances externes. ${LANG_INSTRUCTION[lang]}`,
};

export async function generateAnswer(
  intent: Intent,
  query: string,
  results: unknown[] | ExplanationSource | null,
): Promise<string> {
  const lang = detectLanguage(query);
  const empty = Array.isArray(results) ? results.length === 0 : results == null;
  if (empty) return emptyAnswer(intent, lang);

  if (groqEnabled()) {
    try {
      const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const res = await client.chat.completions.create({
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        temperature: 0,
        messages: [
          { role: "system", content: GEN_SYSTEM },
          {
            role: "user",
            content: GEN_PROMPTS[intent](
              query,
              JSON.stringify(results, null, 2).slice(0, 12000),
              lang,
            ),
          },
        ],
      });
      const content = res.choices[0]?.message?.content?.trim();
      if (content) return content;
    } catch (err) {
      console.error("Groq generation failed, using template:", err);
    }
  }
  return templateAnswer(intent, results as never, lang);
}

export function emptyAnswer(intent: Intent, lang: Lang = "fr"): string {
  if (intent === "policy_qa") return NO_ANSWER[lang];
  if (intent === "matching_explanation") {
    return lang === "fr"
      ? "Affectation introuvable ou sans détail de score."
      : "Assignment not found or missing a score breakdown.";
  }
  return lang === "fr"
    ? "Aucun résultat ne correspond à cette recherche."
    : "No results match this search.";
}

const pct = (v: unknown) => `${Math.round(Number(v ?? 0) * 100)}%`;

// Per-language strings for the deterministic (no-Groq) answers.
const T: Record<Lang, Record<string, string>> = {
  fr: {
    topCandidates: "Candidats les plus pertinents :",
    relevance: "pertinence",
    unknownLevel: "niveau inconnu",
    yearsExp: "an(s) d'expérience",
    skills: "Compétences",
    noSkills: "aucune compétence détectée",
    semantic: "Similarité sémantique",
    skillCoverage: "Couverture des compétences",
    weight: "poids",
    matched: "acquises",
    missing: "manquantes",
    none: "aucune",
    educationFit: "Adéquation formation",
    candidate: "candidat",
    required: "requis",
    unknown: "inconnu",
    unspecified: "non spécifié",
    extracts: "Extraits pertinents des documents :",
  },
  en: {
    topCandidates: "Most relevant candidates:",
    relevance: "relevance",
    unknownLevel: "unknown level",
    yearsExp: "year(s) of experience",
    skills: "Skills",
    noSkills: "no skills detected",
    semantic: "Semantic similarity",
    skillCoverage: "Skill coverage",
    weight: "weight",
    matched: "matched",
    missing: "missing",
    none: "none",
    educationFit: "Education fit",
    candidate: "candidate",
    required: "required",
    unknown: "unknown",
    unspecified: "unspecified",
    extracts: "Relevant document extracts:",
  },
};

const scoreHeader = (lang: Lang, score: string, name: string, title: string) =>
  lang === "fr"
    ? `Score de ${score} pour ${name} sur l'offre « ${title} » :`
    : `Score of ${score} for ${name} on the offer “${title}”:`;

export function templateAnswer(
  intent: Intent,
  results: CandidateSource[] | ChunkSource[] | ExplanationSource,
  lang: Lang = "fr",
): string {
  const t = T[lang];

  if (intent === "candidate_search") {
    const rows = results as CandidateSource[];
    return [
      t.topCandidates,
      ...rows.map(
        (r) =>
          `- ${r.name} (${t.relevance} ${pct(r.similarity)}) — ${r.education_level ?? t.unknownLevel}, ` +
          `${Math.round(r.years_experience)} ${t.yearsExp}. ` +
          `${t.skills} : ${r.skills.slice(0, 8).join(", ") || t.noSkills}.`,
      ),
    ].join("\n");
  }

  if (intent === "matching_explanation") {
    const r = results as ExplanationSource;
    const b = (r.score_breakdown ?? {}) as Record<string, unknown>;
    const weights = (b.weights ?? {}) as Record<string, unknown>;
    const matched = r.candidate.skills.filter((s) => r.offer.required_skills.includes(s));
    const missing = r.offer.required_skills.filter((s) => !r.candidate.skills.includes(s));
    const lines = [scoreHeader(lang, pct(r.match_score), r.candidate.name, r.offer.title)];
    if (b.semantic !== undefined)
      lines.push(`- ${t.semantic} : ${pct(b.semantic)} (${t.weight} ${weights.semantic ?? "?"})`);
    lines.push(
      `- ${t.skillCoverage} : ${pct(b.skills)} (${t.weight} ${weights.skills ?? "?"}) — ` +
        `${t.matched} : ${matched.join(", ") || t.none} ; ${t.missing} : ${missing.join(", ") || t.none}`,
      `- ${t.educationFit} : ${pct(b.education)} (${t.weight} ${weights.education ?? "?"}) — ` +
        `${t.candidate} : ${r.candidate.education_level ?? t.unknown}, ` +
        `${t.required} : ${r.offer.min_education_level ?? t.unspecified}`,
    );
    return lines.join("\n");
  }

  const chunks = results as ChunkSource[];
  return [
    t.extracts,
    ...chunks.map((c) => `- [${c.source_document}] ${c.text.slice(0, 400).trim()}…`),
  ].join("\n");
}
