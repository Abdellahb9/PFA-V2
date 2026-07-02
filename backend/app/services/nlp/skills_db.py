"""Skill dictionary + normalisation used by the extraction pipeline.

A curated, bilingual (FR/EN) gazetteer of skills relevant to OCP/PHOSBOUCRAA
internships (engineering, IT, chemistry, management). Each canonical skill maps
to a list of surface forms / synonyms that may appear in a CV.
"""

from __future__ import annotations

import unicodedata

from app.models.skill import SkillCategory

# canonical_name -> (category, [synonyms / surface forms])
SKILL_GAZETTEER: dict[str, tuple[SkillCategory, list[str]]] = {
    # --- Programming / IT ---
    "python": (SkillCategory.TECHNICAL, ["python", "py"]),
    "java": (SkillCategory.TECHNICAL, ["java"]),
    "javascript": (SkillCategory.TECHNICAL, ["javascript", "js", "node", "nodejs"]),
    "typescript": (SkillCategory.TECHNICAL, ["typescript", "ts"]),
    "c++": (SkillCategory.TECHNICAL, ["c++", "cpp"]),
    "sql": (SkillCategory.TECHNICAL, ["sql", "postgresql", "postgres", "mysql"]),
    "machine learning": (
        SkillCategory.TECHNICAL,
        ["machine learning", "ml", "apprentissage automatique", "scikit-learn", "sklearn"],
    ),
    "deep learning": (
        SkillCategory.TECHNICAL,
        ["deep learning", "réseaux de neurones", "neural networks"],
    ),
    "nlp": (SkillCategory.TECHNICAL, ["nlp", "traitement du langage", "spacy", "transformers"]),
    "data science": (
        SkillCategory.TECHNICAL,
        ["data science", "science des données", "pandas", "numpy"],
    ),
    "data analysis": (
        SkillCategory.TECHNICAL,
        ["data analysis", "analyse de données", "power bi", "tableau"],
    ),
    "react": (SkillCategory.TECHNICAL, ["react", "react.js", "reactjs"]),
    "fastapi": (SkillCategory.TECHNICAL, ["fastapi"]),
    "docker": (SkillCategory.TECHNICAL, ["docker", "conteneurisation", "containerization"]),
    "kubernetes": (SkillCategory.TECHNICAL, ["kubernetes", "k8s"]),
    "git": (SkillCategory.TECHNICAL, ["git", "github", "gitlab"]),
    "linux": (SkillCategory.TECHNICAL, ["linux", "unix", "bash"]),
    # --- Engineering / industry ---
    "automation": (SkillCategory.DOMAIN, ["automatisme", "automation", "automate", "plc", "scada"]),
    "electrical engineering": (
        SkillCategory.DOMAIN,
        ["génie électrique", "electrical engineering", "électrotechnique"],
    ),
    "mechanical engineering": (
        SkillCategory.DOMAIN,
        ["génie mécanique", "mechanical engineering", "mécanique"],
    ),
    "industrial engineering": (
        SkillCategory.DOMAIN,
        ["génie industriel", "industrial engineering"],
    ),
    "process engineering": (SkillCategory.DOMAIN, ["génie des procédés", "process engineering"]),
    "maintenance": (SkillCategory.DOMAIN, ["maintenance", "ged", "gmao"]),
    "chemistry": (SkillCategory.DOMAIN, ["chimie", "chemistry", "chimie analytique"]),
    "quality": (SkillCategory.DOMAIN, ["qualité", "quality", "iso 9001", "qhse"]),
    "supply chain": (SkillCategory.DOMAIN, ["supply chain", "logistique", "logistics"]),
    "project management": (
        SkillCategory.DOMAIN,
        ["gestion de projet", "project management", "pmp", "agile", "scrum"],
    ),
    "finance": (
        SkillCategory.DOMAIN,
        ["finance", "comptabilité", "accounting", "contrôle de gestion"],
    ),
    "marketing": (SkillCategory.DOMAIN, ["marketing", "communication"]),
    "hr": (SkillCategory.DOMAIN, ["ressources humaines", "rh", "human resources", "hr"]),
    # --- Soft skills ---
    "teamwork": (SkillCategory.SOFT, ["travail en équipe", "teamwork", "esprit d'équipe"]),
    "communication": (
        SkillCategory.SOFT,
        ["communication", "communication écrite", "communication orale"],
    ),
    "leadership": (SkillCategory.SOFT, ["leadership", "encadrement"]),
    "problem solving": (SkillCategory.SOFT, ["résolution de problèmes", "problem solving"]),
    "autonomy": (SkillCategory.SOFT, ["autonomie", "autonomy"]),
    # --- Languages ---
    "french": (SkillCategory.LANGUAGE, ["français", "french", "francais"]),
    "english": (SkillCategory.LANGUAGE, ["anglais", "english"]),
    "arabic": (SkillCategory.LANGUAGE, ["arabe", "arabic"]),
    "spanish": (SkillCategory.LANGUAGE, ["espagnol", "spanish"]),
}


def normalize(text: str) -> str:
    """Lower-case, strip accents and collapse whitespace for robust matching."""
    text = text.strip().lower()
    text = "".join(c for c in unicodedata.normalize("NFD", text) if unicodedata.category(c) != "Mn")
    return " ".join(text.split())


# Pre-compute a normalized-synonym -> canonical map for fast lookup.
_SYNONYM_INDEX: dict[str, str] = {}
for canonical, (_cat, synonyms) in SKILL_GAZETTEER.items():
    for syn in synonyms:
        _SYNONYM_INDEX[normalize(syn)] = canonical


def category_of(canonical: str) -> SkillCategory:
    """Return the category of a canonical skill (defaults to TECHNICAL)."""
    entry = SKILL_GAZETTEER.get(canonical)
    return entry[0] if entry else SkillCategory.TECHNICAL


def extract_skills(text: str) -> dict[str, float]:
    """Find known skills in free text.

    Returns canonical_skill -> confidence weight in (0, 1]. The weight grows
    (capped) with the number of mentions, as a simple proxy for proficiency.
    """
    norm = normalize(text)
    found: dict[str, float] = {}
    for syn_norm, canonical in _SYNONYM_INDEX.items():
        if syn_norm and syn_norm in norm:
            occurrences = norm.count(syn_norm)
            weight = min(1.0, 0.6 + 0.2 * occurrences)
            found[canonical] = max(found.get(canonical, 0.0), weight)
    return found
