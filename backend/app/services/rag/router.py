"""Intent routing: classify a query, run the matching skill, generate an answer."""

from __future__ import annotations

import logging
import re

from sqlalchemy.orm import Session

from app.services.nlp import llm as llm_module
from app.services.rag.generation import generate_answer
from app.services.rag.retriever import (
    get_score_breakdown,
    retrieve_candidates,
    retrieve_doc_chunks,
)

logger = logging.getLogger(__name__)

INTENTS = ("candidate_search", "matching_explanation", "policy_qa")

# Keyword heuristics (FR + EN); the LLM refines only when these are ambiguous.
_PATTERNS: dict[str, re.Pattern] = {
    "candidate_search": re.compile(
        r"\b(candidat|profil|cherche|trouve|recherch\w*|qui (a|sait|maitrise)|"
        r"candidate|find|search|experience|expérience|compétence|skill)\w*\b",
        re.IGNORECASE,
    ),
    "matching_explanation": re.compile(
        r"\b(score|matching|affectation|assignment|pourquoi|explique|explain|"
        r"justifi\w*|breakdown)\b",
        re.IGNORECASE,
    ),
    "policy_qa": re.compile(
        r"\b(politique|policy|procédure|process(us)?|règle|regle|rule|durée|duree|"
        r"convention|gratification|rémunération|remuneration|document|charte|"
        r"combien de (temps|mois|semaines)|comment (faire|demander|obtenir))\b",
        re.IGNORECASE,
    ),
}

_CLASSIFY_PROMPT = (
    "Classify this HR assistant query into exactly one category. Reply with the "
    "category name only.\nCategories: candidate_search (find/filter candidate "
    "profiles), matching_explanation (explain a candidate-offer matching score), "
    "policy_qa (question about internship policy/process documents).\n"
    "Query: {query}"
)


def classify_intent(query: str, assignment_id: int | None = None) -> str:
    """Pick the skill for a query: explicit id > keywords > LLM > policy_qa."""
    # An assignment id in the request is an unambiguous signal.
    if assignment_id is not None:
        return "matching_explanation"

    scores = {name: len(pat.findall(query)) for name, pat in _PATTERNS.items()}
    best = max(scores, key=scores.get)
    ranked = sorted(scores.values(), reverse=True)
    if ranked[0] > 0 and ranked[0] > ranked[1]:
        return best

    # Ambiguous or no keyword hit: one cheap LLM call when available.
    if llm_module.is_enabled():
        try:
            response = llm_module._build_llm().invoke(_CLASSIFY_PROMPT.format(query=query[:1000]))
            content = getattr(response, "content", "").strip().lower()
            for intent in INTENTS:
                if intent in content:
                    return intent
        except Exception as exc:  # pragma: no cover - network failures
            logger.warning("Intent classification via LLM failed: %s", exc)

    return best if ranked[0] > 0 else "policy_qa"


def answer_query(
    db: Session,
    query: str,
    assignment_id: int | None = None,
    min_years_experience: float | None = None,
    education_level: str | None = None,
    top_k: int = 5,
) -> dict:
    """Full assistant pipeline: classify -> retrieve -> generate."""
    intent = classify_intent(query, assignment_id)

    if intent == "matching_explanation":
        if assignment_id is None:
            from app.services.rag.language import detect_language

            answer = (
                "Précisez l'affectation concernée (assignment_id) pour "
                "obtenir l'explication du score."
                if detect_language(query) == "fr"
                else "Provide the assignment_id of the assignment to explain its score."
            )
            return {"intent": intent, "answer": answer, "sources": []}
        results = get_score_breakdown(db, assignment_id)
        sources = [results] if results else []
    elif intent == "candidate_search":
        results = retrieve_candidates(
            db,
            query,
            min_years_experience=min_years_experience,
            education_level=education_level,
            top_k=top_k,
        )
        sources = results
    else:  # policy_qa
        results = retrieve_doc_chunks(db, query, top_k=top_k)
        sources = results

    return {
        "intent": intent,
        "answer": generate_answer(intent, query, results),
        "sources": sources,
    }
