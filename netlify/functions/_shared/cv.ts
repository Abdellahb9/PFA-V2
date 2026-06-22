// Extract plain text from a CV (PDF / DOCX) — pure-JS, serverless-friendly.
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/;
const EXPERIENCE_RE = /(\d+)\+?\s*(?:ans|years|an)\b/i;

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

/** Lightweight regex fallbacks (used to fill gaps the LLM missed). */
export function regexHints(text: string): {
  email: string | null;
  phone: string | null;
  yearsExperience: number;
  university: string | null;
} {
  const email = text.match(EMAIL_RE)?.[0] ?? null;
  const phone = text.match(PHONE_RE)?.[0]?.trim() ?? null;
  const years = [...text.matchAll(new RegExp(EXPERIENCE_RE, "gi"))]
    .map((m) => parseInt(m[1], 10))
    .filter((n) => !Number.isNaN(n));
  const uni = text.match(UNIVERSITY_GENERIC)?.[1] ?? text.match(UNIVERSITY_ACRONYM)?.[1] ?? null;
  return {
    email,
    phone,
    yearsExperience: years.length ? Math.max(...years) : 0,
    university: uni ? uni.split(/[\n\r;|]/)[0].replace(/\s+/g, " ").trim() : null,
  };
}
