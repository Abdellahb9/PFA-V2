// Extraction du texte d'un document déposé, PAGE PAR PAGE quand c'est possible :
// la page suit chaque extrait jusqu'à la citation (« politique.pdf, p. 3 »).
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import type { PageText } from "./types";

/**
 * Postgres refuse le caractère NUL dans un `text` : un seul octet nul, fréquent
 * dans les PDF générés, faisait échouer l'insertion du document entier.
 */
function clean(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n");
}

export async function extractDocument(data: Uint8Array, filename: string): Promise<PageText[]> {
  const name = (filename || "").toLowerCase();
  try {
    if (name.endsWith(".pdf")) {
      const pdf = await getDocumentProxy(data);
      const { text } = await extractText(pdf, { mergePages: false });
      const pages = Array.isArray(text) ? text : [text];
      return pages
        .map((t, i) => ({ page: i + 1, text: clean(t) }))
        .filter((p) => p.text.trim() !== "");
    }
    if (name.endsWith(".docx")) {
      const res = await mammoth.extractRawText({ buffer: Buffer.from(data) });
      const text = clean(res.value);
      return text.trim() ? [{ page: null, text }] : [];
    }
  } catch (err) {
    console.error("[rag] document text extraction failed:", err);
    return [];
  }
  const text = clean(new TextDecoder("utf-8").decode(data));
  return text.trim() ? [{ page: null, text }] : [];
}
