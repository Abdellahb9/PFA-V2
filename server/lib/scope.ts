// Filtre de périmètre, AVANT l'agent — entièrement déterministe.
//
// Deux couches, sans appel réseau :
//   1. voie rapide : salutations, remerciements et « que peux-tu faire ? »
//      reçoivent une réponse fixe, sans appel au modèle ;
//   2. filet déterministe : une demande de CLASSEMENT fondée sur un attribut
//      protégé est refusée, quoi que réponde ensuite le modèle.
// Tout le reste va à l'agent, dont les consignes traitent le hors-sujet.
//
// Un classifieur LLM (gpt-oss-20b) se tenait autrefois entre les deux : il
// coûtait un appel par message et refusait des questions légitimes (en
// production : « Quelle université de Babtich El Habib ? » → hors sujet).
import { normalize } from "./skills";
import type { AgentEvent } from "./assistant";

/**
 * « small_talk » : salutation, remerciement ou « que peux-tu faire ? ». Ces
 * messages allaient autrefois à l'agent, dont la règle de périmètre répondait…
 * par le refus hors sujet (« bonjour » → « Je ne traite que … »).
 * « off_topic » n'est plus décidé ici : c'est l'agent qui le prononce, avec la
 * phrase de REFUSALS.
 */
export type ScopeVerdict = "in" | "small_talk" | "off_topic" | "discriminatory";

export interface ScopeResult {
  verdict: ScopeVerdict;
  /** Origine de la décision — pour les journaux et les tests. */
  via: "fast_path" | "backstop" | "agent";
}

/**
 * Phrases de refus, en UN seul endroit : le prompt de l'agent les reprend pour
 * que filtre et agent refusent exactement de la même façon.
 */
export const REFUSALS: Record<Exclude<ScopeVerdict, "in" | "small_talk">, string> = {
  off_topic:
    "Je ne traite que les questions sur le recrutement des stagiaires : candidats, " +
    "CV, offres et affectations.",
  discriminatory:
    "Je ne peux pas classer des candidats selon ce critère : seules les compétences, " +
    "la formation et l'expérience sont prises en compte.",
};

// ---- 1. Voie rapide -----------------------------------------------------------

// Toutes les expressions portent sur le texte NORMALISÉ (sans accents, en
// minuscules), comme ailleurs dans le projet. Ce n'est pas un détail : le `\b`
// de JavaScript ne connaît que l'ASCII, donc `\b(âge)\b` ne matche JAMAIS
// « âge » — la frontière avant « â » n'existe pas pour le moteur.

const SMALL_TALK =
  /^\s*(bonjour|bonsoir|salut|salam|hello|hi|hey|merci( beaucoup)?|thanks|thank you|ok|okay|d'accord|parfait|super|top|genial|au revoir|bye)\s*[!.?]*\s*$/;

// « Que peux-tu faire ? » : une question sur l'assistant lui-même.
const CAPABILITIES =
  /^\s*((qu'est-ce que|que) (tu peux|peux-tu|tu sais|sais-tu) (faire|repondre)|(a )?quoi sers-tu|tu sers a quoi|comment (peux-tu|tu peux) m'aider|aide(-moi)?|help|what can you (do|answer)|how can you help( me)?)\s*[!.?]*\s*$/;

const THANKS = /^\s*(merci|thanks|thank you|ok|okay|d'accord|parfait|super|top|genial)\b/;
const BYE = /^\s*(au revoir|bye)\b/;
const ENGLISH = /^\s*(hello|hi|hey|thanks|thank you|bye|okay|help|what can|how can)\b/;

/** Réponse fixe à une formule de politesse ou à « que peux-tu faire ? ». */
export function smallTalkReply(message: string): string {
  const n = normalize(message ?? "").replace(/[’`]/g, "'");
  const en = ENGLISH.test(n);
  if (BYE.test(n)) return en ? "Goodbye!" : "Au revoir !";
  if (THANKS.test(n)) return en ? "You're welcome." : "Avec plaisir.";
  return en
    ? "Hello! I know every candidate, their CV, applications and results. I can count and list " +
        "candidates, summarise a profile, find who mentions a skill in their CV, rank candidates " +
        "for a field or an offer, list offers and bookings, and remember notes you give me. " +
        "What do you need?"
    : "Bonjour ! Je connais tous les candidats, leurs CV, leurs candidatures et leurs résultats. " +
        "Je peux compter et lister les candidats, résumer un profil, retrouver qui mentionne une " +
        "compétence dans son CV, classer des candidats pour une filière ou une offre, lister les " +
        "offres et les réservations, et retenir les notes que vous me donnez. Que voulez-vous savoir ?";
}

// ---- 2. Filet déterministe ----------------------------------------------------
//
// Il faut les DEUX : un verbe de sélection ET un attribut protégé. Sans le
// premier, « la candidate mentionne-t-elle une grossesse dans son CV ? » —
// question légitime — serait refusée.

const SELECTION =
  /\b(classe|classer|classez|classement|trie|trier|triez|filtre|filtrer|filtrez|choisis|choisir|choisissez|selectionne|selectionner|selectionnez|prefere|preferer|exclus|exclure|excluez|ecarte|ecarter|ecartez|elimine|eliminer|eliminez|garde|retiens|uniquement|seulement|que des|le plus|la plus|les plus|le moins|la moins|les moins|rank|sort|filter|only|prefer|exclude)\b/;

// Volontairement ABSENTS, car ils désignent aussi des critères légitimes :
//   « physique »  — une filière (« Bac en physique et chimie »)
//   « santé »     — un domaine de compétence (hygiène, santé, sécurité — QHSE)
//   « genre »     — « quel genre de profil »
//   « marie »     — un prénom ; seul le pluriel/féminin « mariés, mariée » reste
// Ces cas restent jugés par l'agent, dont les consignes interdisent ces critères.
const PROTECTED =
  /\b(age|ages|agee|agees|jeune|jeunes|vieux|vieille|sexe|homme|hommes|femme|femmes|fille|filles|garcon|garcons|religion|religions|religieux|religieuse|musulman\w*|chretien\w*|juif|juive|juifs|nationalite|nationalites|origine ethnique|pays d'origine|ethni\w*|maries|mariee|mariees|celibataires?|situation familiale|enceinte|enceintes|grossesse|handicap\w*|etat de sante|malad\w*|apparence|beaute|gender|women|men|male|female|religious|pregnan\w*|married|nationality|ethnic\w*|disab\w*)\b/;

/** Demande de classement fondée sur un critère protégé. Exporté pour les tests. */
export function isDiscriminatoryRequest(text: string): boolean {
  const n = normalize(text ?? "");
  return SELECTION.test(n) && PROTECTED.test(n);
}

// ---- Décision ------------------------------------------------------------------

export function classifyScope(message: string): ScopeResult {
  const text = (message ?? "").trim();
  const plain = normalize(text).replace(/[’`]/g, "'");
  if (SMALL_TALK.test(plain) || CAPABILITIES.test(plain)) {
    return { verdict: "small_talk", via: "fast_path" };
  }
  if (isDiscriminatoryRequest(text)) return { verdict: "discriminatory", via: "backstop" };
  return { verdict: "in", via: "agent" };
}

/**
 * Réponse fixe (refus ou politesse), au même format que l'agent : le client ne
 * voit aucune différence.
 */
export async function* cannedStream(
  verdict: Exclude<ScopeVerdict, "in">,
  message = "",
): AsyncGenerator<AgentEvent> {
  yield { type: "delta", text: verdict === "small_talk" ? smallTalkReply(message) : REFUSALS[verdict] };
  yield { type: "done" };
}
