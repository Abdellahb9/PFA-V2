"""Unit tests for RAG intent classification and answer templating (no DB)."""

from __future__ import annotations

from app.services.rag.generation import _empty_answer, _template_answer
from app.services.rag.router import classify_intent


def test_assignment_id_forces_matching_explanation():
    assert classify_intent("n'importe quoi", assignment_id=42) == "matching_explanation"


def test_candidate_search_keywords():
    assert (
        classify_intent("Trouve-moi un candidat Python avec 3 ans d'expérience")
        == "candidate_search"
    )
    assert classify_intent("find candidates who know react") == "candidate_search"


def test_matching_explanation_keywords():
    assert classify_intent("Pourquoi ce score de matching ?") == "matching_explanation"


def test_policy_keywords():
    assert classify_intent("Quelle est la durée maximale d'un stage ?") == "policy_qa"
    assert classify_intent("Quelle est la politique de gratification ?") == "policy_qa"


def test_no_keywords_defaults_to_policy_qa():
    # Offline (no LLM configured): ambiguous queries fall back to policy_qa.
    assert classify_intent("bonjour") == "policy_qa"


def test_empty_answers_per_intent():
    assert "documents" in _empty_answer("policy_qa")
    assert "Affectation" in _empty_answer("matching_explanation")
    assert "Aucun" in _empty_answer("candidate_search")


def test_template_answer_candidate_search():
    results = [
        {
            "type": "candidate",
            "candidate_id": 1,
            "name": "Amina El Idrissi",
            "education_level": "Bac+5",
            "field_of_study": "Informatique",
            "years_experience": 3.0,
            "skills": ["python", "sql"],
            "similarity": 0.87,
        }
    ]
    answer = _template_answer("candidate_search", results)
    assert "Amina El Idrissi" in answer
    assert "python" in answer


def test_template_answer_matching_explanation_grounds_in_breakdown():
    result = {
        "type": "matching_explanation",
        "match_score": 0.78,
        "score_breakdown": {
            "semantic": 0.8,
            "skills": 0.7,
            "education": 1.0,
            "weights": {"semantic": 0.5, "skills": 0.35, "education": 0.15},
        },
        "candidate": {
            "name": "Yassine B.",
            "education_level": "Bac+5",
            "skills": ["python", "docker"],
        },
        "offer": {
            "title": "Stage Data",
            "min_education_level": "Bac+3",
            "required_skills": ["python", "sql"],
        },
    }
    answer = _template_answer("matching_explanation", result)
    assert "78%" in answer
    assert "python" in answer  # matched skill
    assert "sql" in answer  # missing skill


def test_detect_language():
    from app.services.rag.language import detect_language

    assert detect_language("Quelle est la durée maximale d'un stage ?") == "fr"
    assert detect_language("Trouve-moi des candidats avec 3 ans d'expérience") == "fr"
    assert detect_language("What is the maximum duration of an internship?") == "en"
    assert detect_language("Find candidates who know react with 2 years of experience") == "en"
    # Ambiguous input defaults to French (primary audience).
    assert detect_language("python sql docker") == "fr"


def test_empty_answers_english():
    assert "I cannot find" in _empty_answer("policy_qa", "en")
    assert "Assignment not found" in _empty_answer("matching_explanation", "en")
    assert "No results" in _empty_answer("candidate_search", "en")


def test_template_answer_candidate_search_english():
    results = [
        {
            "type": "candidate",
            "candidate_id": 1,
            "name": "Amina El Idrissi",
            "education_level": "Bac+5",
            "field_of_study": "Informatique",
            "years_experience": 3.0,
            "skills": ["python", "sql"],
            "similarity": 0.87,
        }
    ]
    answer = _template_answer("candidate_search", results, "en")
    assert "Most relevant candidates" in answer
    assert "year(s) of experience" in answer
