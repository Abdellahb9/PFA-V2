// Skill normalisation + a small synonym map so candidate and offer skills use
// the same canonical vocabulary (this is what gives "semantic-ish" matching
// without embeddings). Also a regex fallback extractor if Groq is unavailable.

export type SkillCategory = "technical" | "soft" | "language" | "domain";

// canonical -> { category, surface forms }
const GAZETTEER: Record<string, { category: SkillCategory; forms: string[] }> = {
  python: { category: "technical", forms: ["python", "py"] },
  java: { category: "technical", forms: ["java"] },
  javascript: { category: "technical", forms: ["javascript", "js", "node", "nodejs"] },
  typescript: { category: "technical", forms: ["typescript", "ts"] },
  "c++": { category: "technical", forms: ["c++", "cpp"] },
  sql: { category: "technical", forms: ["sql", "postgresql", "postgres", "mysql"] },
  "machine learning": { category: "technical", forms: ["machine learning", "ml", "apprentissage automatique", "scikit-learn", "sklearn"] },
  "deep learning": { category: "technical", forms: ["deep learning", "reseaux de neurones", "neural networks"] },
  nlp: { category: "technical", forms: ["nlp", "traitement du langage", "spacy", "transformers"] },
  "data science": { category: "technical", forms: ["data science", "science des donnees", "pandas", "numpy"] },
  "data analysis": { category: "technical", forms: ["data analysis", "analyse de donnees", "power bi", "tableau"] },
  react: { category: "technical", forms: ["react", "react.js", "reactjs"] },
  docker: { category: "technical", forms: ["docker", "conteneurisation", "containerization"] },
  kubernetes: { category: "technical", forms: ["kubernetes", "k8s"] },
  git: { category: "technical", forms: ["git", "github", "gitlab"] },
  linux: { category: "technical", forms: ["linux", "unix", "bash"] },
  automation: { category: "domain", forms: ["automatisme", "automation", "automate", "plc", "scada"] },
  "electrical engineering": { category: "domain", forms: ["genie electrique", "electrical engineering", "electrotechnique"] },
  "mechanical engineering": { category: "domain", forms: ["genie mecanique", "mechanical engineering", "mecanique"] },
  "industrial engineering": { category: "domain", forms: ["genie industriel", "industrial engineering"] },
  "process engineering": { category: "domain", forms: ["genie des procedes", "process engineering"] },
  maintenance: { category: "domain", forms: ["maintenance", "gmao"] },
  chemistry: { category: "domain", forms: ["chimie", "chemistry"] },
  quality: { category: "domain", forms: ["qualite", "quality", "iso 9001", "qhse"] },
  "supply chain": { category: "domain", forms: ["supply chain", "logistique", "logistics"] },
  "project management": { category: "domain", forms: ["gestion de projet", "project management", "pmp", "agile", "scrum"] },
  finance: { category: "domain", forms: ["finance", "comptabilite", "accounting"] },
  hr: { category: "domain", forms: ["ressources humaines", "rh", "human resources", "hr"] },
  teamwork: { category: "soft", forms: ["travail en equipe", "teamwork", "esprit d'equipe"] },
  communication: { category: "soft", forms: ["communication"] },
  leadership: { category: "soft", forms: ["leadership", "encadrement"] },
  french: { category: "language", forms: ["francais", "french"] },
  english: { category: "language", forms: ["anglais", "english"] },
  arabic: { category: "language", forms: ["arabe", "arabic"] },
};

export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// surface-form (normalized) -> canonical
const SYNONYM_INDEX = new Map<string, string>();
for (const [canonical, { forms }] of Object.entries(GAZETTEER)) {
  for (const f of forms) SYNONYM_INDEX.set(normalize(f), canonical);
}

/** Map an arbitrary skill string to its canonical form (or a cleaned fallback). */
export function canonicalize(skill: string): string {
  const n = normalize(skill);
  return SYNONYM_INDEX.get(n) ?? n;
}

export function categoryOf(canonical: string): SkillCategory {
  return GAZETTEER[canonical]?.category ?? "technical";
}

/** Regex fallback: find known skills in free text (used if Groq is disabled). */
export function extractSkills(text: string): string[] {
  const n = normalize(text);
  const found = new Set<string>();
  for (const [form, canonical] of SYNONYM_INDEX) {
    if (form && n.includes(form)) found.add(canonical);
  }
  return [...found];
}

// ---- Filières ---------------------------------------------------------------
//
// Les offres portent une filière libre (« Informatique », « Génie électrique »)
// et les candidats une autre (« Génie informatique et réseaux »,
// « Électromécanique »). Aucune entrée du gazetteer ne couvrait « informatique »,
// la filière la plus fréquente : les deux vocabulaires ne se rejoignaient jamais.
// Cette table les ramène à une filière canonique commune.

/** Filière canonique -> formes rencontrées (FR/EN), comparées après normalize(). */
const FIELD_ALIASES: Record<string, string[]> = {
  informatique: [
    "informatique", "genie informatique", "computer science", "computer engineering",
    "it", "developpement", "developpement logiciel", "genie logiciel", "software engineering",
    "systemes d'information", "systemes d information", "reseaux", "reseaux informatiques",
    "telecommunications", "telecom",
  ],
  "data science": [
    "data science", "science des donnees", "data", "big data", "intelligence artificielle",
    "ia", "ai", "machine learning", "apprentissage automatique", "data analysis",
    "analyse de donnees", "statistique", "statistiques",
  ],
  "genie electrique": [
    "genie electrique", "electrical engineering", "electrotechnique", "electricite",
    "electronique", "automatisme", "automatique", "electromecanique", "genie electromecanique",
  ],
  "genie des procedes": [
    "genie des procedes", "process engineering", "genie chimique", "chemical engineering",
    "chimie", "chimie industrielle", "chemistry",
  ],
  "genie mecanique": ["genie mecanique", "mechanical engineering", "mecanique"],
  "genie industriel": ["genie industriel", "industrial engineering", "productique"],
  "genie civil": ["genie civil", "civil engineering", "btp"],
  qualite: ["qualite", "quality", "qhse", "hse", "iso 9001", "hygiene securite environnement"],
  maintenance: ["maintenance", "maintenance industrielle", "gmao"],
  logistique: ["logistique", "supply chain", "logistics", "achats"],
  finance: ["finance", "comptabilite", "accounting", "audit", "controle de gestion"],
  rh: ["ressources humaines", "gestion des ressources humaines", "human resources", "rh", "hr"],
};

/** Libellé affichable d'une filière canonique. */
export const FIELD_LABELS: Record<string, string> = {
  informatique: "Informatique",
  "data science": "Data Science",
  "genie electrique": "Génie électrique",
  "genie des procedes": "Génie des procédés",
  "genie mecanique": "Génie mécanique",
  "genie industriel": "Génie industriel",
  "genie civil": "Génie civil",
  qualite: "Qualité",
  maintenance: "Maintenance",
  logistique: "Logistique",
  finance: "Finance",
  rh: "Ressources humaines",
};

export const KNOWN_FIELDS = Object.keys(FIELD_ALIASES);

// Toutes les formes, de la plus longue à la plus courte : « science des donnees »
// doit l'emporter sur « data » quand les deux figurent dans le texte.
const FIELD_FORMS: { form: string; field: string }[] = Object.entries(FIELD_ALIASES)
  .flatMap(([field, forms]) => forms.map((f) => ({ form: normalize(f), field })))
  .sort((a, b) => b.form.length - a.form.length);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Filière canonique d'un texte libre, ou null.
 * Correspondance sur MOT ENTIER : « mecanique » ne doit pas sortir de
 * « electromecanique », ni « ia » de « specialisation ».
 */
export function resolveField(text: string | null | undefined): string | null {
  if (!text) return null;
  const n = normalize(text.replace(/[’`]/g, "'"));
  if (!n) return null;
  for (const { form, field } of FIELD_FORMS) {
    if (new RegExp(`(^|[^a-z0-9])${escapeRe(form)}([^a-z0-9]|$)`).test(n)) return field;
  }
  return null;
}
