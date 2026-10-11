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
// Un numéro de SECTION (« 2. », « 2.1 », au plus deux chiffres par niveau)
// suivi d'une lettre. Sans ces bornes, « 2024 2025 » ou « 1 500 dirhams par
// mois » — lignes courantes dans un CV ou un tableau — devenaient des titres,
// propagés aux extraits suivants et pondérés A dans le plein-texte.
const NUMBERED_HEADING =
  /^((?:article|chapitre|section|titre|annexe|part|chapter|appendix)\s+[\w.-]+\b.*|\d{1,2}(?:\.\d{1,2})*\.?\s+\p{L}.*)$/iu;

/** Une ligne est-elle un intertitre ? Renvoie son libellé, sinon null. */
export function headingOf(line: string): string | null {
  const t = line.trim();
  if (!t || t.length > 90) return null;
  const md = t.match(MARKDOWN_HEADING);
  if (md) return md[1].trim();
  // Une phrase qui se termine par un point n'est pas un titre.
  if (/[.;,]$/.test(t)) return null;
  if (NUMBERED_HEADING.test(t) && t.split(/\s+/).length <= 12) return t;
  // TOUT EN CAPITALES, au moins quatre lettres, sans chiffre : « TOTAL 3 000
  // MAD » est une ligne de tableau, pas un titre.
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (
    letters.length >= 4 &&
    !/\d/.test(t) &&
    letters === letters.toUpperCase() &&
    /[A-ZÀ-Þ]/.test(letters)
  ) {
    return t;
  }
  return null;
}

// ---- Titre du document ------------------------------------------------------------

const GENERIC_TITLE = /^(cv|c\.v\.?|curriculum vitae|curriculum|r[ée]sum[ée]|resume)$/i;

/**
 * Titre du document, répété dans l'intertitre de CHAQUE extrait. Sans lui,
 * seul l'extrait qui contient le nom d'une personne répondait à « Yasmine
 * El Amrani … » : ses expériences et ses compétences, plus bas dans le CV,
 * étaient introuvables par son nom.
 *
 * La première ligne du document quand elle a l'allure d'un titre (un nom, un
 * intitulé), sinon le nom du fichier sans extension.
 */
export function documentTitle(name: string, pages: PageText[]): string | null {
  const firstText = pages.map((p) => normalizeText(p.text)).find(Boolean) ?? "";
  const firstLine = firstText.split("\n").find((l) => l.trim()) ?? "";
  const line = (firstLine.trim().match(MARKDOWN_HEADING)?.[1] ?? firstLine).trim();
  const digits = line.replace(/\D/g, "").length;
  const looksLikeTitle =
    line.length > 0 &&
    line.length <= 90 &&
    !GENERIC_TITLE.test(line) &&
    !/[.;,:]$/.test(line) &&
    !/@|https?:|www\./i.test(line) &&
    digits <= line.length / 4;
  if (looksLikeTitle) return line;
  const stem = (name ?? "").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[-_]+/g, " ").trim();
  return stem || null;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

/** « Titre › Section », ou l'un des deux seul quand l'autre manque ou le répète. */
function label(title: string | null, section: string | null): string | null {
  if (!title) return section;
  if (!section || fold(section) === fold(title)) return title;
  return `${title} › ${section}`;
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

/**
 * Bornes [start, end[ des extraits d'un texte normalisé.
 *
 * `breaks` : positions des intertitres. Quand l'un d'eux tombe dans la seconde
 * moitié de la fenêtre, on coupe JUSTE AVANT et l'extrait suivant commence
 * exactement sur l'intertitre, sans chevauchement : sinon le début de
 * l'extrait suivant retombait dans la section précédente, dont il héritait
 * l'intertitre (le passage sur Hajar était étiqueté « Yasmine El Amrani »).
 */
export function splitRanges(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
  breaks: number[] = [],
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    let atHeading = false;
    if (end < text.length) {
      const brk = breaks.filter((b) => b > start + size / 2 && b < end).at(-1);
      if (brk !== undefined) {
        end = brk;
        atHeading = true;
      } else {
        const window = text.slice(start, end);
        for (const sep of SEPARATORS) {
          const at = window.lastIndexOf(sep);
          if (at > size / 2) {
            end = start + at + sep.length;
            break;
          }
        }
      }
    }
    ranges.push({ start, end });
    if (end >= text.length) break;
    start = atHeading ? end : Math.max(overlapStart(text, end, overlap), start + 1);
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
 * Avec `title` (voir documentTitle), chaque intertitre devient « Titre › Section ».
 */
export function chunkPages(pages: PageText[], title: string | null = null): Chunk[] {
  const chunks: Chunk[] = [];
  let carried: string | null = null;

  for (const { page, text: raw } of pages) {
    const text = normalizeText(raw);
    if (!text) continue;
    const headings = headingPositions(text);
    const breaks = headings.map((h) => h.pos);

    for (const { start, end } of splitRanges(text, CHUNK_SIZE, CHUNK_OVERLAP, breaks)) {
      const content = text.slice(start, end).trim();
      if (!content) continue;
      // Intertitre en vigueur au début de l'extrait ; à défaut, le premier qu'il contient.
      const before = headings.filter((h) => h.pos <= start).at(-1);
      const inside = headings.find((h) => h.pos > start && h.pos < end);
      const heading = before?.title ?? (inside && !carried ? inside.title : carried);
      chunks.push({ content, page, heading: label(title, heading ?? null) });
    }
    carried = headings.at(-1)?.title ?? carried;
  }
  return chunks;
}

/** Raccourci pour un texte brut sans pagination. */
export function chunkText(text: string): Chunk[] {
  return chunkPages([{ page: null, text }]);
}
