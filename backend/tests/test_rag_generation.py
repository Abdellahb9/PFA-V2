"""Le gabarit déterministe et la configuration du fournisseur LLM.

Deux défauts se couvraient l'un l'autre : aucun fournisseur ne pouvait être
construit (dépendances absentes), et l'échec était avalé en `warning` puis
rabattu sur le gabarit. Le gabarit était donc le SEUL chemin réellement emprunté
— alors qu'il levait sur la moindre donnée inattendue, et que personne ne savait
que la génération LLM n'avait jamais fonctionné.
"""

from __future__ import annotations

import pytest

from app.services.nlp import llm as llm_module
from app.services.rag.generation import _template_answer, generate_answer


class TestTemplateRobustness:
    """Le gabarit ne doit jamais lever : il n'a aucun filet en dessous."""

    def test_missing_years_experience(self):
        results = [
            {
                "name": "A B",
                "education_level": None,
                "years_experience": None,
                "skills": [],
                "similarity": 0.5,
            }
        ]
        assert "A B" in _template_answer("candidate_search", results)

    def test_missing_match_score_and_breakdown(self):
        result = {
            "match_score": None,
            "score_breakdown": None,
            "candidate": {"name": "X", "education_level": None, "skills": []},
            "offer": {"title": "T", "min_education_level": None, "required_skills": []},
        }
        assert "X" in _template_answer("matching_explanation", result)

    def test_breakdown_values_stored_as_strings(self):
        # score_breakdown est un JSONB nullable et non validé : rien n'empêche
        # d'y trouver "0.8" plutôt que 0.8, ce qui faisait remonter un
        # ValueError jusqu'à l'API.
        result = {
            "match_score": 0.5,
            "score_breakdown": {"semantic": "0.8", "skills": 0.7, "education": 1.0},
            "candidate": {"name": "X", "education_level": "Bac+5", "skills": ["python"]},
            "offer": {"title": "T", "min_education_level": "Bac+3", "required_skills": ["python"]},
        }
        answer = _template_answer("matching_explanation", result)
        assert "80%" in answer
        assert "70%" in answer

    def test_chunk_without_text(self):
        answer = _template_answer("policy_qa", [{"source_document": "d", "text": None}])
        assert "[d]" in answer

    def test_empty_candidate_fields_do_not_crash(self):
        answer = _template_answer("candidate_search", [{}])
        assert answer  # une phrase, pas une exception


class TestProviderFailsLoudly:
    """Un fournisseur mal configuré doit se voir, pas se taire."""

    def test_unknown_provider_raises(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "LLM_PROVIDER", "acme", raising=False)
        with pytest.raises(llm_module.LLMConfigurationError):
            llm_module.build_llm()

    def test_missing_api_key_raises(self, monkeypatch):
        monkeypatch.setattr(llm_module.settings, "LLM_PROVIDER", "openai", raising=False)
        monkeypatch.setattr(llm_module.settings, "OPENAI_API_KEY", "", raising=False)
        with pytest.raises(llm_module.LLMConfigurationError):
            llm_module.build_llm()

    def test_generation_propagates_configuration_error(self, monkeypatch):
        """Le gabarit ne doit PAS masquer une erreur de déploiement."""
        monkeypatch.setattr(llm_module, "is_enabled", lambda: True)

        def boom():
            raise llm_module.LLMConfigurationError("paquet manquant")

        monkeypatch.setattr(llm_module, "build_llm", boom)
        with pytest.raises(llm_module.LLMConfigurationError):
            generate_answer("policy_qa", "quelle durée ?", [{"source_document": "d", "text": "x"}])

    def test_generation_still_degrades_on_network_error(self, monkeypatch):
        """En revanche une panne réseau reste rattrapée par le gabarit."""
        monkeypatch.setattr(llm_module, "is_enabled", lambda: True)

        def boom():
            raise TimeoutError("upstream indisponible")

        monkeypatch.setattr(llm_module, "build_llm", boom)
        answer = generate_answer(
            "policy_qa", "quelle durée ?", [{"source_document": "d", "text": "six mois"}]
        )
        assert "six mois" in answer


def test_context_json_stays_parsable_when_truncated():
    """Tronquer la chaîne sérialisée livrait un JSON invalide au modèle."""
    import json

    from app.services.rag.generation import _context_json

    results = [
        {"source_document": "politique.pdf", "chunk_index": i, "text": "x" * 1600}
        for i in range(20)
    ]
    dump = _context_json(results)
    json.loads(dump)  # ne doit pas lever
