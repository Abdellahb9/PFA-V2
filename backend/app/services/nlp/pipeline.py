"""End-to-end CV profiling pipeline (spaCy + gazetteer + optional LLM).

Given raw CV text, produces a structured ``ParsedProfile`` containing personal
info, education metadata, detected skills (with weights) and a semantic
embedding ready for the matching engine.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from functools import lru_cache

from app.core.config import settings
from app.services.nlp import llm
from app.services.nlp.embeddings import embed_text_cached
from app.services.nlp.skills_db import extract_skills

logger = logging.getLogger(__name__)

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_EXPERIENCE_RE = re.compile(r"(\d+)\+?\s*(?:ans|years|an)\b", re.IGNORECASE)

# Higher-education institutions. spaCy NER misses these (e.g. "ENSA Agadir"),
# so we scan the text directly with two patterns:
#  - generic French terms, case-insensitive;
#  - distinctive Moroccan acronyms, CASE-SENSITIVE + word-bounded, to avoid
#    matching common words (e.g. "est", "emmi").
_UNIV_GENERIC_RE = re.compile(
    r"(?P<inst>"
    r"(?:universit[ée]|facult[ée](?:\s+des\s+sciences[\w\s'’.-]*)?|"
    r"[ée]cole\s+(?:nationale|sup[ée]rieure|polytechnique|mohammadia|d['’]ing[ée]nieurs)[\w\s'’.-]*|"
    r"institut\s+(?:national|sup[ée]rieur)[\w\s'’.-]*)"
    r"[\w\s'’.&,\-]{0,40}"
    r")",
    re.IGNORECASE,
)
_UNIV_ACRONYM_RE = re.compile(
    r"\b(?P<inst>(?:ENSAM|ENSIAS|ENSEM|ENSET|ENSA|ENCG|EHTP|ESITH|INPT|FSJES|FST|"
    r"EMINES|EMSI|EHEC|ENA)"
    r"[\w\s'’.&,\-]{0,40})",
)

# Surface forms -> canonical education level.
_EDU_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"bac\s*\+\s*5|bac\+5|master\s*2|ing[ée]nieur|engineer", re.I), "Bac+5"),
    (re.compile(r"bac\s*\+\s*4|bac\+4|master\s*1", re.I), "Bac+4"),
    (re.compile(r"bac\s*\+\s*3|bac\+3|licence|bachelor", re.I), "Bac+3"),
    (re.compile(r"bac\s*\+\s*2|bac\+2|dut|bts", re.I), "Bac+2"),
    (re.compile(r"doctorat|ph\.?d", re.I), "Doctorat"),
]

_FIELD_KEYWORDS = {
    "informatique": "Informatique",
    "computer science": "Informatique",
    "génie informatique": "Génie informatique",
    "data": "Data Science",
    "génie électrique": "Génie électrique",
    "génie mécanique": "Génie mécanique",
    "génie industriel": "Génie industriel",
    "génie des procédés": "Génie des procédés",
    "chimie": "Chimie",
    "gestion": "Gestion",
    "finance": "Finance",
    "logistique": "Logistique",
}


@dataclass
class ParsedProfile:
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    education_level: str | None = None
    field_of_study: str | None = None
    university: str | None = None
    years_experience: float = 0.0
    skills: dict[str, float] = field(default_factory=dict)
    embedding: list[float] = field(default_factory=list)


@lru_cache
def _get_nlp():
    """Load the French spaCy model (used for PERSON / ORG entities)."""
    import spacy

    try:
        return spacy.load(settings.SPACY_MODEL_FR)
    except OSError:  # pragma: no cover - model not downloaded
        logger.warning("spaCy model %s not found; using blank pipeline", settings.SPACY_MODEL_FR)
        return spacy.blank("fr")


def _detect_education_level(text: str) -> str | None:
    for pattern, label in _EDU_PATTERNS:
        if pattern.search(text):
            return label
    return None


def _detect_field(text: str) -> str | None:
    low = text.lower()
    for kw, label in _FIELD_KEYWORDS.items():
        if kw in low:
            return label
    return None


def _detect_experience(text: str) -> float:
    matches = [int(m) for m in _EXPERIENCE_RE.findall(text)]
    return float(max(matches)) if matches else 0.0


def detect_university(text: str) -> str | None:
    """Find a higher-education institution name via the gazetteer regexes."""
    m = _UNIV_GENERIC_RE.search(text) or _UNIV_ACRONYM_RE.search(text)
    if not m:
        return None
    # Keep a single clean line, trimmed of trailing separators/whitespace.
    value = re.split(r"[\n\r;|•]", m.group("inst"))[0]
    value = re.sub(r"\s+", " ", value).strip(" ,.-'’")
    return value[:200] or None


def _extract_person_and_org(text: str) -> tuple[str | None, str | None, str | None]:
    """Use spaCy NER to guess the candidate name and university."""
    nlp = _get_nlp()
    doc = nlp(text[:4000])  # first page is enough for header info
    first = last = university = None
    for ent in doc.ents:
        if ent.label_ in {"PER", "PERSON"} and first is None:
            parts = ent.text.split()
            if len(parts) >= 2:
                first, last = parts[0], " ".join(parts[1:])
        elif ent.label_ in {"ORG", "LOC"} and university is None:
            low = ent.text.lower()
            if any(k in low for k in ("universit", "école", "ecole", "institut", "faculté")):
                university = ent.text
    return first, last, university


def parse_cv(text: str) -> ParsedProfile:
    """Run the full pipeline and return a structured profile."""
    profile = ParsedProfile()

    # 1) Try the optional LLM extractor first (best quality when available).
    structured = llm.extract_structured(text)
    if structured:
        profile.first_name = structured.get("first_name")
        profile.last_name = structured.get("last_name")
        profile.email = structured.get("email")
        profile.phone = structured.get("phone")
        profile.education_level = structured.get("education_level")
        profile.field_of_study = structured.get("field_of_study")
        profile.university = structured.get("university")
        try:
            profile.years_experience = float(structured.get("years_experience") or 0)
        except (TypeError, ValueError):
            profile.years_experience = 0.0
        # Re-normalise LLM skills through the gazetteer for consistency.
        llm_skill_text = " ".join(structured.get("skills") or [])
        profile.skills = extract_skills(text + " " + llm_skill_text)

    # 2) Deterministic fallbacks / enrichment from regex + spaCy.
    if not profile.email:
        m = _EMAIL_RE.search(text)
        profile.email = m.group(0) if m else None
    if not profile.phone:
        m = _PHONE_RE.search(text)
        profile.phone = m.group(0).strip() if m else None
    if not profile.education_level:
        profile.education_level = _detect_education_level(text)
    if not profile.field_of_study:
        profile.field_of_study = _detect_field(text)
    if not profile.years_experience:
        profile.years_experience = _detect_experience(text)
    if not profile.skills:
        profile.skills = extract_skills(text)
    if not profile.university:
        profile.university = detect_university(text)
    if not (profile.first_name and profile.last_name) or not profile.university:
        first, last, university = _extract_person_and_org(text)
        profile.first_name = profile.first_name or first
        profile.last_name = profile.last_name or last
        profile.university = profile.university or university

    # 3) Semantic embedding of the full CV for the matching engine (cached).
    profile.embedding = embed_text_cached(text)
    return profile


def build_offer_text(title: str, description: str | None, field_name: str | None,
                     skills: list[str]) -> str:
    """Compose a single text to embed for an internship offer."""
    parts = [title or "", description or "", field_name or "", " ".join(skills)]
    return " . ".join(p for p in parts if p)
