// Langue d'une question (français / anglais) : heuristique par mots-outils.
// Sans dépendance, déterministe, suffisante pour des questions courtes. En cas
// d'égalité : français (public principal).

export type Lang = "fr" | "en";

const FR_WORDS = new Set(
  "le la les un une des du de et est sont quelle quel quels quelles pourquoi comment combien avec pour dans qui que quoi sur pas plus trouve cherche moi mon ma mes ce cette ces son sa ses stage durée politique règle candidat compétence expérience était être avoir fait ans an mois".split(
    " ",
  ),
);
const EN_WORDS = new Set(
  "the a an and is are was were what which why how much many with for in on who that this these those find search show me my of to from do does can could should would internship policy rule candidate skill experience years year months".split(
    " ",
  ),
);

export function detectLanguage(text: string): Lang {
  const lower = (text ?? "").toLowerCase();
  const words = lower.match(/[a-zà-ÿ']+/g) ?? [];
  let fr = words.filter((w) => FR_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  // Les accents sont un signal fort du français — comptés après passage en
  // minuscules, sinon une question en capitales n'en marquait aucun.
  fr += (lower.match(/[àâçéèêëîïôùûüÿœ]/g) ?? []).length;
  return en > fr ? "en" : "fr";
}
