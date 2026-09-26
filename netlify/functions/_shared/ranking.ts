// Classement des candidats pour une filière, une offre ou un jeu de compétences.
//
// Pourquoi ce module existe : l'assistant répondait à « qui est le meilleur en
// Data Science ? » avec search_candidates, c'est-à-dire un rang PLEIN-TEXTE —
// le degré de recouvrement entre les mots de la question et le texte du CV. Ça
// mesure une ressemblance lexicale, pas une adéquation : un CV qui répète
// « data » passe devant un profil plus solide. Le modèle « triait » ensuite ces
// résultats à vue, différemment d'une fois sur l'autre.
//
// Ici le classement est DÉTERMINISTE et réutilise exactement le moteur de la
// page Affectation IA (compositeScore). Le modèle n'a plus qu'à l'expliquer.
//
// Module pur : aucune E/S. Les données arrivent de db.ts, ce qui le rend
// entièrement testable hors ligne.
import {
  compositeScore,
  levelRank,
  round4,
  type CandidateProfile,
  type OfferProfile,
} from "./scoring";
import { canonicalize, FIELD_LABELS, KNOWN_FIELDS, normalize, resolveField } from "./skills";

// ---- Données d'entrée ----------------------------------------------------------

export interface ApplicantRecord {
  candidateId: number;
  applicationId: number;
  name: string;
  /** Statut de la candidature (parsed, under_review, assigned). */
  status: string;
  educationLevel: string | null;
  fieldOfStudy: string | null;
  yearsExperience: number;
  /** Compétence canonique normalisée -> poids. */
  skills: Map<string, number>;
}

export interface OfferRecord {
  offerId: number;
  title: string;
  field: string | null;
  minEducationLevel: string | null;
  skills: { skill: string; weight: number; required: boolean }[];
}

export interface RankRequest {
  field?: string | null;
  /** Titre (ou id) d'une offre précise. */
  offer?: string | null;
  skills?: string[] | null;
  minEducationLevel?: string | null;
}

// ---- Profil de référence -----------------------------------------------------

export interface FieldProfile {
  /** Ce contre quoi on classe, en clair, pour la réponse. */
  label: string;
  canonicalField: string | null;
  /** Critère -> importance. Inclut éventuellement la pseudo-compétence de filière. */
  criteria: Map<string, number>;
  /** Critères dont l'absence doit être signalée. */
  required: Set<string>;
  minEducationLevel: string | null;
  /** Offres dont le profil est tiré (vide si profil de repli). */
  basedOnOffers: string[];
}

export type ProfileResult =
  | { ok: true; profile: FieldProfile }
  | { ok: false; error: string; known: string[] };

/** Profil de repli quand aucune offre ouverte ne porte la filière demandée. */
const FIELD_SKILLS: Record<string, string[]> = {
  informatique: ["python", "java", "javascript", "sql", "git", "linux", "docker"],
  "data science": ["python", "data science", "machine learning", "sql", "data analysis", "deep learning"],
  "genie electrique": ["electrical engineering", "automation", "maintenance"],
  "genie des procedes": ["process engineering", "chemistry", "quality"],
  "genie mecanique": ["mechanical engineering", "maintenance"],
  "genie industriel": ["industrial engineering", "project management", "supply chain", "quality"],
  "genie civil": ["project management"],
  qualite: ["quality", "project management"],
  maintenance: ["maintenance", "automation", "electrical engineering", "mechanical engineering"],
  logistique: ["supply chain", "data analysis"],
  finance: ["finance", "data analysis"],
  rh: ["hr", "communication"],
};

/** Préfixe de la pseudo-compétence représentant la filière d'études. */
const FIELD_KEY = "field:";
const fieldKey = (canonical: string) => `${FIELD_KEY}${canonical}`;

/** Clé comparable à `skills.normalized` en base. */
const skillKey = (s: string) => normalize(canonicalize(s));

/** Libellé humain d'un critère (pseudo-compétence de filière incluse). */
export function criterionLabel(key: string): string {
  if (key.startsWith(FIELD_KEY)) {
    const f = key.slice(FIELD_KEY.length);
    return `filière ${FIELD_LABELS[f] ?? f}`;
  }
  return key;
}

function offerField(o: OfferRecord): string | null {
  // Le champ `field` d'abord : le titre « Stage Développement IA / NLP » contient
  // « IA » alors que l'offre relève de la filière Informatique.
  return resolveField(o.field) ?? resolveField(o.title);
}

function findOffer(needle: string, offers: OfferRecord[]): OfferRecord | undefined {
  const asId = Number(needle);
  if (Number.isInteger(asId) && asId > 0) {
    const byId = offers.find((o) => o.offerId === asId);
    if (byId) return byId;
  }
  const n = normalize(needle);
  return (
    offers.find((o) => normalize(o.title) === n) ??
    offers.find((o) => normalize(o.title).includes(n) || n.includes(normalize(o.title)))
  );
}

/** Le niveau le plus PERMISSIF parmi plusieurs exigences (aucune offre n'est plus stricte). */
function mostPermissiveLevel(levels: (string | null)[]): string | null {
  let best: { level: string; rank: number } | null = null;
  for (const l of levels) {
    const r = levelRank(l);
    if (l && r !== null && (best === null || r < best.rank)) best = { level: l, rank: r };
  }
  return best?.level ?? null;
}

export function buildFieldProfile(req: RankRequest, offers: OfferRecord[]): ProfileResult {
  const criteria = new Map<string, number>();
  const required = new Set<string>();
  let label = "";
  let canonicalField: string | null = null;
  let minEducationLevel: string | null = null;
  let basedOnOffers: string[] = [];

  const put = (key: string, weight: number, isRequired: boolean) => {
    criteria.set(key, Math.max(criteria.get(key) ?? 0, weight));
    if (isRequired) required.add(key);
  };

  if (req.offer?.trim()) {
    // Offre précise : ses compétences EXACTEMENT, pour retomber sur le même
    // classement que la page Affectation IA — pas de pseudo-compétence ajoutée.
    const offer = findOffer(req.offer, offers);
    if (!offer) {
      return {
        ok: false,
        error: `Offre introuvable parmi les offres ouvertes : « ${req.offer} ».`,
        known: offers.map((o) => o.title),
      };
    }
    for (const s of offer.skills) put(s.skill, s.weight, s.required);
    label = offer.title;
    canonicalField = offerField(offer);
    minEducationLevel = offer.minEducationLevel;
    basedOnOffers = [offer.title];
  } else if (req.field?.trim()) {
    canonicalField = resolveField(req.field);
    if (!canonicalField) {
      return {
        ok: false,
        error: `Filière non reconnue : « ${req.field} ».`,
        known: KNOWN_FIELDS.map((f) => FIELD_LABELS[f] ?? f),
      };
    }
    const matching = offers.filter((o) => offerField(o) === canonicalField);
    if (matching.length) {
      // Ancré dans ce que l'entreprise recrute réellement pour cette filière.
      for (const o of matching) for (const s of o.skills) put(s.skill, s.weight, s.required);
      minEducationLevel = mostPermissiveLevel(matching.map((o) => o.minEducationLevel));
      basedOnOffers = matching.map((o) => o.title);
    } else {
      for (const s of FIELD_SKILLS[canonicalField] ?? []) put(skillKey(s), 0.8, false);
    }
    // La filière d'études entre dans le calcul comme n'importe quel critère :
    // pas de nouvelle formule, et son absence apparaît dans les manques.
    put(fieldKey(canonicalField), 1, true);
    label = FIELD_LABELS[canonicalField] ?? canonicalField;
  }

  const explicit = (req.skills ?? []).map((s) => s.trim()).filter(Boolean);
  for (const s of explicit) put(skillKey(s), 1, true);
  if (explicit.length) {
    const list = explicit.join(", ");
    label = label ? `${label} + ${list}` : `compétences : ${list}`;
  }

  if (req.minEducationLevel?.trim()) minEducationLevel = req.minEducationLevel.trim();

  if (!criteria.size) {
    return {
      ok: false,
      error: "Aucun critère exploitable : précisez une filière, une offre ou des compétences.",
      known: KNOWN_FIELDS.map((f) => FIELD_LABELS[f] ?? f),
    };
  }

  return {
    ok: true,
    profile: { label, canonicalField, criteria, required, minEducationLevel, basedOnOffers },
  };
}

// ---- Classement --------------------------------------------------------------

export interface RankedApplicant {
  rank: number;
  candidate_id: number;
  name: string;
  status: string;
  score: number;
  skills_coverage: number;
  education_fit: number;
  matched: string[];
  missing: string[];
  field_of_study: string | null;
  education_level: string | null;
  years_experience: number;
}

export interface RankingResult {
  profile: string;
  based_on_offers: string[];
  min_education_level: string | null;
  /** Candidats distincts évalués. */
  evaluated: number;
  results: RankedApplicant[];
}

/**
 * Classe le vivier contre le profil.
 *
 * Ne sortent QUE des données utiles à l'évaluation : ni email, ni téléphone, ni
 * texte de CV. Le texte brut contient l'âge (« 22 ans ») et d'autres attributs
 * protégés ; le classement ne les voit jamais.
 */
export function rankApplicants(
  profile: FieldProfile,
  pool: ApplicantRecord[],
  topK = 5,
): RankingResult {
  const target: OfferProfile = {
    offerId: 0,
    title: profile.label,
    departmentName: "",
    slots: 0,
    skills: profile.criteria,
    minEducationLevel: profile.minEducationLevel,
  };

  const best = new Map<number, RankedApplicant & { eduRank: number }>();

  for (const a of pool) {
    const skills = new Map(a.skills);
    if (profile.canonicalField && resolveField(a.fieldOfStudy) === profile.canonicalField) {
      skills.set(fieldKey(profile.canonicalField), 1);
    }

    const candidate: CandidateProfile = {
      candidateId: a.candidateId,
      applicationId: a.applicationId,
      name: a.name,
      skills,
      educationLevel: a.educationLevel,
    };
    const { score, breakdown } = compositeScore(candidate, target);

    // Plancher : aucun critère couvert = aucune raison d'apparaître dans un
    // classement « des meilleurs ». Le niveau d'études seul ne suffit pas.
    if (breakdown.skills <= 0) continue;

    const row = {
      rank: 0,
      candidate_id: a.candidateId,
      name: a.name,
      status: a.status,
      score,
      skills_coverage: breakdown.skills,
      education_fit: breakdown.education,
      matched: [...profile.criteria.keys()].filter((k) => skills.has(k)).map(criterionLabel),
      missing: [...profile.required].filter((k) => !skills.has(k)).map(criterionLabel),
      field_of_study: a.fieldOfStudy,
      education_level: a.educationLevel,
      years_experience: round4(Number(a.yearsExperience) || 0),
      eduRank: levelRank(a.educationLevel) ?? 0,
    };

    // Un candidat peut avoir plusieurs candidatures : on garde la meilleure.
    const prev = best.get(a.candidateId);
    if (!prev || row.score > prev.score) best.set(a.candidateId, row);
  }

  const evaluatedIds = new Set(pool.map((a) => a.candidateId));

  const ranked = [...best.values()]
    .sort(
      (x, y) =>
        y.score - x.score ||
        y.eduRank - x.eduRank ||
        y.years_experience - x.years_experience ||
        x.name.localeCompare(y.name),
    )
    .slice(0, Math.max(1, topK))
    .map(({ eduRank: _eduRank, ...r }, i) => ({ ...r, rank: i + 1 }));

  return {
    profile: profile.label,
    based_on_offers: profile.basedOnOffers,
    min_education_level: profile.minEducationLevel,
    evaluated: evaluatedIds.size,
    results: ranked,
  };
}
