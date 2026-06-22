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
