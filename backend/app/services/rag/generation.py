"""Answer generation over retrieved context, provider-agnostic (OpenAI/Mistral).

Reuses the LangChain chat-model factory from ``app.services.nlp.llm``. Answers
follow the language of the question (French or English, detected by a stopword
heuristic). When no LLM provider is configured the module degrades to
deterministic, templated answers built from the retrieved data — the assistant
stays functional offline, consistent with the rest of the system.
"""

from __future__ import annotations

import json
import logging

from app.services.nlp import llm as llm_module
from app.services.rag.language import detect_language

logger = logging.getLogger(__name__)

# Guardrails baked into every prompt: answer in the user's language, ground
# every claim in the provided context, cite sources, and say "I don't know"
# instead of guessing.
_LANG_INSTRUCTION = {
    "fr": "Réponds en français.",
    "en": "Answer in English.",
}

_NO_ANSWER_SENTENCE = {
    "fr": "Je ne trouve pas cette information dans les documents disponibles.",
    "en": "I cannot find this information in the available documents.",
}

_PROMPTS: dict[str, str] = {
    "candidate_search": (
        "Tu es l'assistant RH de PHOSBOUCRAA. Voici des profils de candidats "
        "retrouvés par recherche sémantique pour la requête d'un recruteur.\n"
        "Requête: {query}\n\nProfils (JSON):\n{context}\n\n"
        "Résume les candidats les plus pertinents et pourquoi "
        "(compétences, expérience, formation). Base-toi UNIQUEMENT sur ces "
        "données. Si aucun profil ne correspond, dis-le clairement. "
        "{lang_instruction}"
    ),
    "matching_explanation": (
        "Tu es l'assistant RH de PHOSBOUCRAA. Explique pourquoi ce "
        "candidat a obtenu ce score de matching pour cette offre de stage.\n"
        "Question: {query}\n\nDonnées de l'affectation (JSON):\n{context}\n\n"
        "Le score final est une moyenne pondérée des composantes 'semantic', "
        "'skills' et 'education' du score_breakdown. Appuie CHAQUE affirmation "
        "sur les chiffres du score_breakdown — n'invente aucune qualité ou "
        "lacune qui n'y figure pas. {lang_instruction}"
    ),
    "policy_qa": (
        "Tu es l'assistant RH de PHOSBOUCRAA. Réponds à la question "
        "en te basant UNIQUEMENT sur les extraits de documents ci-dessous.\n"
        "Question: {query}\n\nExtraits (JSON, avec source_document):\n{context}\n\n"
        "Cite pour chaque élément de réponse le document source (nom du "
        "document). Si les extraits ne permettent pas de répondre, réponds "
        'exactement: "{no_answer}" — ne complète jamais avec des '
        "connaissances externes. {lang_instruction}"
    ),
}


def generate_answer(intent: str, query: str, results: list[dict] | dict | None) -> str:
    """Produce a grounded natural-language answer in the query's language."""
    lang = detect_language(query)
    if not results:
        return _empty_answer(intent, lang)

    if llm_module.is_enabled():
        try:
            prompt = _PROMPTS[intent].format(
                query=query,
                context=json.dumps(results, ensure_ascii=False, indent=2)[:12000],
                lang_instruction=_LANG_INSTRUCTION[lang],
                no_answer=_NO_ANSWER_SENTENCE[lang],
            )
            response = llm_module._build_llm().invoke(prompt)
            return getattr(response, "content", str(response)).strip()
        except Exception as exc:  # pragma: no cover - network failures
            logger.warning("LLM generation failed, using template: %s", exc)

    return _template_answer(intent, results, lang)


def _empty_answer(intent: str, lang: str = "fr") -> str:
    if intent == "policy_qa":
        return _NO_ANSWER_SENTENCE[lang]
    if intent == "matching_explanation":
        return (
            "Affectation introuvable ou sans détail de score."
            if lang == "fr"
            else "Assignment not found or missing a score breakdown."
        )
    return (
        "Aucun résultat ne correspond à cette recherche."
        if lang == "fr"
        else "No results match this search."
    )


# Per-language strings for the deterministic (no-LLM) answers.
_T = {
    "fr": {
        "top_candidates": "Candidats les plus pertinents :",
        "similarity": "similarité",
        "unknown_level": "niveau inconnu",
        "years_exp": "an(s) d'expérience",
        "skills": "Compétences",
        "no_skills": "aucune compétence détectée",
        "score_for": "Score de {score} pour {name} sur l'offre « {title} » :",
        "semantic": "Similarité sémantique",
        "skill_coverage": "Couverture des compétences",
        "weight": "poids",
        "matched": "acquises",
        "missing": "manquantes",
        "none": "aucune",
        "education_fit": "Adéquation formation",
        "candidate": "candidat",
        "required": "requis",
        "unknown": "inconnu",
        "unspecified": "non spécifié",
        "extracts": "Extraits pertinents des documents :",
    },
    "en": {
        "top_candidates": "Most relevant candidates:",
        "similarity": "similarity",
        "unknown_level": "unknown level",
        "years_exp": "year(s) of experience",
        "skills": "Skills",
        "no_skills": "no skills detected",
        "score_for": "Score of {score} for {name} on the offer “{title}”:",
        "semantic": "Semantic similarity",
        "skill_coverage": "Skill coverage",
        "weight": "weight",
        "matched": "matched",
        "missing": "missing",
        "none": "none",
        "education_fit": "Education fit",
        "candidate": "candidate",
        "required": "required",
        "unknown": "unknown",
        "unspecified": "unspecified",
        "extracts": "Relevant document extracts:",
    },
}


def _template_answer(intent: str, results: list[dict] | dict, lang: str = "fr") -> str:
    """Deterministic fallback answer when no LLM provider is configured."""
    t = _T[lang]

    if intent == "candidate_search":
        lines = [t["top_candidates"]]
        for r in results:
            skills = ", ".join(r["skills"][:8]) or t["no_skills"]
            lines.append(
                f"- {r['name']} ({t['similarity']} {r['similarity']:.0%}) — "
                f"{r['education_level'] or t['unknown_level']}, "
                f"{r['years_experience']:.0f} {t['years_exp']}. "
                f"{t['skills']} : {skills}."
            )
        return "\n".join(lines)

    if intent == "matching_explanation":
        b = results.get("score_breakdown") or {}
        weights = b.get("weights", {})
        cand, offer = results["candidate"], results["offer"]
        matched = sorted(set(cand["skills"]) & set(offer["required_skills"]))
        missing = sorted(set(offer["required_skills"]) - set(cand["skills"]))
        header = t["score_for"].format(
            score=f"{results['match_score']:.0%}", name=cand["name"], title=offer["title"]
        )
        return (
            f"{header}\n"
            f"- {t['semantic']} : {b.get('semantic', 0):.0%} "
            f"({t['weight']} {weights.get('semantic', '?')})\n"
            f"- {t['skill_coverage']} : {b.get('skills', 0):.0%} "
            f"({t['weight']} {weights.get('skills', '?')}) — "
            f"{t['matched']} : {', '.join(matched) or t['none']} ; "
            f"{t['missing']} : {', '.join(missing) or t['none']}\n"
            f"- {t['education_fit']} : {b.get('education', 0):.0%} "
            f"({t['weight']} {weights.get('education', '?')}) — "
            f"{t['candidate']} : {cand['education_level'] or t['unknown']}, "
            f"{t['required']} : {offer['min_education_level'] or t['unspecified']}"
        )

    # policy_qa: quote the best chunks with their sources rather than generate.
    lines = [t["extracts"]]
    for r in results:
        lines.append(f"- [{r['source_document']}] {r['text'][:400].strip()}…")
    return "\n".join(lines)
