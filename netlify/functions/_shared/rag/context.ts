// Mise au budget d'une charge utile d'outil avant qu'elle n'atteigne le modèle.
//
// Contrat : le résultat est TOUJOURS du JSON valide et tient dans le budget.
// Quand il faut raccourcir un texte, on garde le passage où se trouvent les
// termes de la question — et non ses N premiers caractères, qui laissaient
// souvent la réponse dans la partie coupée.
import { MAX_TOOL_RESULT_CHARS } from "./config";

const TEXT_FIELDS = ["text", "chunk_text", "content", "cv_text", "description"];

/** Mots porteurs de sens d'une requête, en minuscules et sans accents. */
function terms(query: string): string[] {
  return [
    ...new Set(
      (query ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4),
    ),
  ];
}

/**
 * Fenêtre de `width` caractères centrée sur la plus forte densité de termes.
 * Sans terme reconnu, le début du texte.
 */
export function focusText(text: string, query: string, width: number): string {
  if (text.length <= width) return text;
  const folded = text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  // NFD peut allonger la chaîne : on ramène les positions à l'échelle du texte.
  const scale = text.length / folded.length;
  const hits: number[] = [];
  for (const t of terms(query)) {
    // Racine courte : « stagiaires » doit retrouver « stage ».
    const stem = t.slice(0, Math.max(4, t.length - 3));
    let i = folded.indexOf(stem);
    while (i !== -1) {
      hits.push(Math.floor(i * scale));
      i = folded.indexOf(stem, i + stem.length);
    }
  }
  let start = 0;
  if (hits.length) {
    hits.sort((a, b) => a - b);
    let best = 0;
    for (const h of hits) {
      const s = Math.max(0, Math.min(h - Math.floor(width / 3), text.length - width));
      const count = hits.filter((x) => x >= s && x < s + width).length;
      if (count > best) {
        best = count;
        start = s;
      }
    }
  }
  const end = Math.min(text.length, start + width);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

/** Sérialise une charge utile d'outil dans le budget de contexte. */
export function toolResultContent(
  payload: unknown,
  budget = MAX_TOOL_RESULT_CHARS,
  query = "",
): string {
  const fits = (v: unknown) => JSON.stringify(v).length <= budget;
  if (fits(payload)) return JSON.stringify(payload);

  const clone = { ...(payload as Record<string, unknown>) };
  // La liste la plus VOLUMINEUSE : un classement porte `based_on_offers` avant
  // `results`, et c'est `results` qu'il faut rogner.
  const listKey = Object.keys(clone)
    .filter((k) => Array.isArray(clone[k]))
    .sort((a, b) => JSON.stringify(clone[b]).length - JSON.stringify(clone[a]).length)[0];
  if (!listKey) return JSON.stringify({ erreur: "Résultat trop volumineux pour le contexte." });

  const items = [...(clone[listKey] as unknown[])];
  const trim = (width: number) =>
    items.map((it) => {
      if (!it || typeof it !== "object") return it;
      const rec = { ...(it as Record<string, unknown>) };
      for (const field of TEXT_FIELDS) {
        if (typeof rec[field] === "string" && (rec[field] as string).length > width) {
          rec[field] = focusText(rec[field] as string, query, width);
        }
      }
      return rec;
    });

  // 1) Raccourcir les textes avant de sacrifier des éléments.
  for (const width of [700, 500, 350, 250]) {
    clone[listKey] = trim(width);
    if (fits(clone)) return JSON.stringify(clone);
  }

  // 2) Retirer des éléments en partant de la fin (les moins pertinents).
  let kept = trim(250);
  while (kept.length > 1) {
    kept = kept.slice(0, -1);
    clone[listKey] = kept;
    clone.tronque = true;
    if (fits(clone)) return JSON.stringify(clone);
  }
  clone[listKey] = [];
  clone.tronque = true;
  const last = JSON.stringify(clone);
  return last.length <= budget
    ? last
    : JSON.stringify({ erreur: "Résultat trop volumineux pour le contexte." });
}
