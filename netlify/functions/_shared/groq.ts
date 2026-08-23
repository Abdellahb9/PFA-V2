// CV understanding via Groq's free LLM API (OpenAI-compatible). Groq has no
// embeddings model, so we use it for high-quality STRUCTURED EXTRACTION; the
// matching then runs on the normalised skills + education (no vectors).
import Groq from "groq-sdk";

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
}

const SYSTEM =
  "You extract structured data from CVs for an HR system. " +
  "Respond with a STRICT JSON object only, no prose.";

const PROMPT = (cv: string) => `Extract these fields from the CV below as JSON:
- first_name, last_name, email, phone (strings or null)
- education_level: one of "Bac+2","Bac+3","Bac+4","Bac+5","Doctorat" or null
- field_of_study, university (strings or null)
- years_experience (number)
- skills: array of short skill keywords, lowercase, in ENGLISH and canonical
  (e.g. "machine learning" not "ML", "javascript" not "JS").

CV:
"""
${cv.slice(0, 6000)}
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
