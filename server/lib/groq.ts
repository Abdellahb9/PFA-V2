// CV understanding via Groq's free LLM API (OpenAI-compatible). Groq has no
// embeddings model, so we use it for high-quality STRUCTURED EXTRACTION; the
// matching then runs on the normalised skills + education (no vectors).
import Groq from "groq-sdk";

/** Profil détaillé du CV, conservé dans candidates.profile et lu par l'assistant. */
export interface CvProfile {
  summary?: string | null;
  experiences?: { title?: string | null; organization?: string | null; start?: string | null; end?: string | null; highlights?: string[] }[];
  education?: { degree?: string | null; institution?: string | null; start?: string | null; end?: string | null }[];
  projects?: { name?: string | null; description?: string | null }[];
  languages?: { language?: string | null; level?: string | null }[];
  certifications?: string[];
}

export interface ExtractedProfile {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  education_level?: string | null; // Bac+2..Bac+5 / Doctorat
  field_of_study?: string | null;
  university?: string | null;
  years_experience?: number | null;
  skills?: string[]; // short canonical keywords, lowercase, english
  profile?: CvProfile | null;
}

/**
 * Version du format d'extraction : elle entre dans la clé du cache
 * (cv_analysis_cache), si bien qu'un CV déjà analysé avec un ancien format
 * — sans `profile` — est réanalysé au lieu d'être resservi incomplet.
 */
export const EXTRACTION_VERSION = "v2-profile";

/** Longueur de CV transmise au modèle : assez pour les expériences et projets. */
const MAX_CV_CHARS = 12_000;

const SYSTEM =
  "You extract structured data from CVs for an HR system. " +
  "Respond with a STRICT JSON object only, no prose.";

const PROMPT = (cv: string) => `Extract these fields from the CV below as JSON:
- first_name, last_name, email, phone (strings or null)
- education_level: one of "Bac+2","Bac+3","Bac+4","Bac+5","Doctorat" or null
- field_of_study, university (strings or null)
- years_experience (number): PROFESSIONAL WORK EXPERIENCE ONLY.
  NEVER use the person's age. A CV starting with "Firstname Lastname 22 ans"
  states an AGE, not 22 years of experience. Do not count years of study, and
  do not derive it from graduation dates. If no professional experience is
  explicitly stated, return 0. These are students applying for internships:
  a value above 15 is almost always a mistake.
- skills: array of short skill keywords, lowercase, in ENGLISH and canonical
  (e.g. "machine learning" not "ML", "javascript" not "JS").
- profile: an object describing the CV, written in FRENCH, copied from the CV
  (never invent; omit what the CV does not say):
  - summary: 1 to 2 sentences on who the person is and what they look for
  - experiences: [{title, organization, start, end, highlights: [short facts]}],
    internships and jobs, most recent first, at most 8
  - education: [{degree, institution, start, end}]
  - projects: [{name, description}], at most 6
  - languages: [{language, level}]
  - certifications: [strings]
  Dates as written in the CV (e.g. "2024", "mars 2025"). Do NOT include age,
  date of birth, nationality, marital status, religion, health or appearance.

CV:
"""
${cv.slice(0, MAX_CV_CHARS)}
"""`;

// Groq retires model ids without notice: llama-3.1-8b-instant started
// returning HTTP 404, which silently disabled CV extraction, intent
// classification and answer generation (each call is caught and falls back).
// Both ids are overridable so a retirement is a config change, not a deploy.
export const ASSISTANT_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";
export const EXTRACT_MODEL =
  process.env.GROQ_EXTRACT_MODEL ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";

export function groqEnabled(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

// Un client par appel ouvrait un pool HTTP neuf à chaque requête, sans jamais
// réutiliser de connexion. On le mémoïse pour la durée de vie de l'instance.
let _client: Groq | null = null;

export function groqClient(): Groq {
  if (!_client) _client = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return _client;
}

export async function extractProfile(cvText: string): Promise<ExtractedProfile | null> {
  if (!groqEnabled()) return null;
  try {
    const client = groqClient();
    const res = await client.chat.completions.create({
      model: EXTRACT_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: PROMPT(cvText) },
      ],
    });
    const content = res.choices[0]?.message?.content ?? "{}";
    return JSON.parse(content) as ExtractedProfile;
  } catch (err) {
    console.error("Groq extraction failed:", err);
    return null;
  }
}
