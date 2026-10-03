// Découpage des documents en extraits de recherche.
//
// Trois garanties, chacune absente de l'ancien découpeur :
//   1. la coupure suit les séparateurs par ORDRE DE PRIORITÉ (paragraphe,
//      ligne, phrase, ponctuation, espace) ;
//   2. le chevauchement commence sur une frontière de phrase ou de mot — jamais
//      au milieu d'un mot ;
//   3. chaque extrait connaît sa page et l'intertitre qui le gouverne, ce qui
//      permet une citation précise et rend l'extrait trouvable par son titre.
import { CHUNK_OVERLAP, CHUNK_SIZE } from "./config";
import type { Chunk, PageText } from "./types";

const SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

/** Normalise sans déplacer le sens : espaces de fin de ligne, lignes vides en rafale. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---- Intertitres ----------------------------------------------------------------

const MARKDOWN_HEADING = /^#{1,6}\s+(.+?)\s*#*$/;
const NUMBERED_HEADING =
  /^((?:article|chapitre|section|titre|annexe|part|chapter|appendix)\s+[\w.-]+\b.*|\d+(?:\.\d+)*\.?\s+\S.*)$/i;

/** Une ligne est-elle un intertitre ? Renvoie son libellé, sinon null. */
export function headingOf(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 90) return null;
  const md = t.match(MARKDOWN_HEADING);
  if (md) return md[1].trim();
  // Une phrase qui se termine par un point n'est pas un titre.
  if (/[.;,]$/.test(t)) return null;
  if (NUMBERED_HEADING.test(t) && t.split(/\s+/).length <= 12) return t;
  // TOUT EN CAPITALES, au moins quatre lettres.
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase() && /[A-ZÀ-Þ]/.test(letters)) {
    return t;
  }
  return null;
}

/** Positions (index de caractère) des intertitres d'un texte normalisé. */
function headingPositions(text: string): { pos: number; title: string }[] {
  const out: { pos: number; title: string }[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const title = headingOf(line);
    if (title) out.push({ pos, title });
    pos += line.length + 1;
  }
  return out;
}

// ---- Découpe d'un texte -----------------------------------------------------------

/** Bornes [start, end[ des extraits d'un texte normalisé. */
export function splitRanges(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const window = text.slice(start, end);
      for (const sep of SEPARATORS) {
        const at = window.lastIndexOf(sep);
        if (at > size / 2) {
          end = start + at + sep.length;
          break;
        }
      }
    }
    ranges.push({ start, end });
    if (end >= text.length) break;
    start = Math.max(overlapStart(text, end, overlap), start + 1);
  }
  return ranges;
}

/**
 * Début du chevauchement : on recule de `overlap` caractères, puis on avance
 * jusqu'à une frontière de phrase si la zone en contient une, sinon jusqu'au
 * début du mot suivant. Si rien ne convient, pas de chevauchement.
 */
function overlapStart(text: string, end: number, overlap: number): number {
  const from = Math.max(0, end - overlap);
  const zone = text.slice(from, end);
  const sentence = zone.search(/[.!?]\s+\S/);
  if (sentence !== -1) {
    const m = zone.slice(sentence).match(/^[.!?]\s+/);
    return from + sentence + (m ? m[0].length : 1);
  }
  let i = from;
  while (i < end && !/\s/.test(text[i - 1] ?? " ")) i++;
  while (i < end && /\s/.test(text[i])) i++;
  return i < end ? i : end;
}

// ---- Document complet ----------------------------------------------------------------

/**
 * Découpe un document page par page. L'intertitre courant se propage d'une page
 * à l'autre : une section qui déborde sur la page suivante garde son titre.
 */
export function chunkPages(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  let carried: string | null = null;

  for (const { page, text: raw } of pages) {
    const text = normalizeText(raw);
    if (!text) continue;
    const headings = headingPositions(text);

    for (const { start, end } of splitRanges(text)) {
      const content = text.slice(start, end).trim();
      if (!content) continue;
      // Intertitre en vigueur au début de l'extrait ; à défaut, le premier qu'il contient.
      const before = headings.filter((h) => h.pos <= start).at(-1);
      const inside = headings.find((h) => h.pos > start && h.pos < end);
      const heading = before?.title ?? (inside && !carried ? inside.title : carried);
      chunks.push({ content, page, heading: heading ?? null });
    }
    carried = headings.at(-1)?.title ?? carried;
  }
  return chunks;
}

/** Raccourci pour un texte brut sans pagination. */
export function chunkText(text: string): Chunk[] {
  return chunkPages([{ page: null, text }]);
}
