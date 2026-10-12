// Extract plain text from a CV (PDF / DOCX) — pure-JS, serverless-friendly.
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;

// « N ans » tout seul est le plus souvent un ÂGE : un CV s'ouvrant sur
// « MERIEM BEDDA 22 ans » donnait 22 années d'expérience. On exige donc un mot
// de contexte (expérience / experience) collé au nombre, de part et d'autre.
// `\b` devant le nombre : sans lui, « 2021 ans » livrait « 21 ».
const EXPERIENCE_RE =
  /(?:exp[ée]rience[^.\n]{0,20}?\b(\d{1,2})\s*\+?\s*(?:ans?|years?|yrs?)|\b(\d{1,2})\s*\+?\s*(?:ans?|years?|yrs?)[^.\n]{0,20}?d?['’]?\s*exp[ée]rience)/gi;
// Au-delà, c'est une date, un âge ou une coquille — pas une carrière de stagiaire.
const MAX_PLAUSIBLE_YEARS = 50;

const UNIVERSITY_GENERIC =
  /((?:universit[ée]|facult[ée](?:\s+des\s+sciences[\w\s'’.-]*)?|[ée]cole\s+(?:nationale|sup[ée]rieure|polytechnique|mohammadia|d['’]ing[ée]nieurs)[\w\s'’.-]*|institut\s+(?:national|sup[ée]rieur)[\w\s'’.-]*)[\w\s'’.&,-]{0,40})/i;
const UNIVERSITY_ACRONYM =
  /\b((?:ENSAM|ENSIAS|ENSEM|ENSET|ENSA|ENCG|EHTP|ESITH|INPT|FSJES|FST|EMINES|EMSI|EHEC|ENA)[\w\s'’.&,-]{0,40})/;

export async function extractCvText(data: Uint8Array, filename: string): Promise<string> {
  const name = (filename || "").toLowerCase();
  try {
    if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(data);
      const { text } = await extractText(pdf, { mergePages: true });
      return Array.isArray(text) ? text.join("\n") : text;
    }
    if (name.endsWith(".docx")) {
      const res = await mammoth.extractRawText({ buffer: Buffer.from(data) });
      return res.value;
    }
  } catch (err) {
    console.error("CV text extraction failed:", err);
    return "";
  }
  return new TextDecoder().decode(data);
}

/**
 * Un stagiaire est un étudiant : au-delà, la valeur est presque toujours un âge
 * ou une année lue de travers.
 */
export const MAX_PLAUSIBLE_INTERN_YEARS = 15;

/**
 * Arbitre entre l'expérience annoncée par le LLM et celle trouvée par regex.
 *
 * Le modèle confond régulièrement l'âge et l'expérience : un CV qui s'ouvre sur
 * « MERIEM BEDDA 22 ans » lui fait renvoyer 22. La regex, elle, EXIGE un mot de
 * contexte (« expérience ») autour du nombre — quand elle ne trouve rien alors
 * que le modèle annonce une carrière entière, c'est le modèle qui se trompe.
 */
export function reconcileExperience(
  llmYears: number | null | undefined,
  hintYears: number,
): number {
  // `Number(null)` vaut 0, pas NaN : sans ce test, une valeur ABSENTE passait
  // pour un zéro légitime et écrasait la regex.
  if (llmYears == null) return hintYears;
  const llm = Number(llmYears);
  if (!Number.isFinite(llm) || llm < 0) return hintYears;
  if (llm <= MAX_PLAUSIBLE_INTERN_YEARS) return llm;
  // Valeur invraisemblable pour un stage : on retombe sur la regex contextuelle,
  // qui vaut 0 quand aucune expérience n'est réellement mentionnée.
  return hintYears;
}

/** Lightweight regex fallbacks (used to fill gaps the LLM missed). */
export function regexHints(text: string): {
  email: string | null;
  phone: string | null;
  yearsExperience: number;
  university: string | null;
} {
  const email = text.match(EMAIL_RE)?.[0] ?? null;
  const phone = text.match(PHONE_RE)?.[0]?.trim() ?? null;
  const years = [...text.matchAll(new RegExp(EXPERIENCE_RE))]
    .map((m) => parseInt(m[1] ?? m[2], 10))
    .filter((n) => !Number.isNaN(n) && n <= MAX_PLAUSIBLE_YEARS);
  const uni = text.match(UNIVERSITY_GENERIC)?.[1] ?? text.match(UNIVERSITY_ACRONYM)?.[1] ?? null;
  return {
    email,
    phone,
    yearsExperience: years.length ? Math.max(...years) : 0,
    university: uni ? uni.split(/[\n\r;|]/)[0].replace(/\s+/g, " ").trim() : null,
  };
}
