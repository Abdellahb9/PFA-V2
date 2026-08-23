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

_MAX_CONTEXT_CHARS = 12000

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
                context=_context_json(results),
                lang_instruction=_LANG_INSTRUCTION[lang],
                no_answer=_NO_ANSWER_SENTENCE[lang],
            )
            response = llm_module.build_llm().invoke(prompt)
            return getattr(response, "content", str(response)).strip()
        except llm_module.LLMConfigurationError:
            # Déploiement fautif, pas incident réseau : le masquer derrière un
            # gabarit a laissé cette branche muette pendant toute sa vie.
            raise
        except Exception as exc:  # pragma: no cover - network failures
            logger.warning("LLM generation failed, using template: %s", exc)

    return _template_answer(intent, results, lang)


def _context_json(results: list[dict] | dict) -> str:
    """Sérialise le contexte en restant sous la limite SANS casser le JSON.

    Tronquer la chaîne sérialisée produisait un JSON invalide (coupure au milieu
    d'une valeur) : on retire des éléments entiers.
    """
    dump = json.dumps(results, ensure_ascii=False, indent=2)
    if len(dump) <= _MAX_CONTEXT_CHARS or not isinstance(results, list):
        return dump
    kept = list(results)
    while len(kept) > 1:
        kept = kept[:-1]
        dump = json.dumps(kept, ensure_ascii=False, indent=2)
        if len(dump) <= _MAX_CONTEXT_CHARS:
            return dump
    return dump


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


def _pct(value: object) -> str:
    """Pourcentage tolérant : ``None``, texte ou Decimal ne doivent pas lever.

    ``score_breakdown`` est un JSONB nullable et non validé : une valeur stockée
    en texte ("0.8") faisait remonter un ``ValueError`` jusqu'à l'API. Comme la
    voie LLM était elle-même hors service, ce gabarit est le SEUL chemin réel —
    il ne peut pas se permettre de planter sur une donnée inattendue.
    """
    try:
        return f"{float(value):.0%}"  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "?"


def _num(value: object) -> str:
    try:
        return f"{float(value):.0f}"  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return "?"


def _template_answer(intent: str, results: list[dict] | dict, lang: str = "fr") -> str:
    """Deterministic fallback answer when no LLM provider is configured."""
    t = _T[lang]

    if intent == "candidate_search":
        lines = [t["top_candidates"]]
        for r in results:
            skills = ", ".join(r.get("skills") or [])[:400] or t["no_skills"]
            lines.append(
                f"- {r.get('name') or t['unknown']} ({t['similarity']} {_pct(r.get('similarity'))}) — "
                f"{r.get('education_level') or t['unknown_level']}, "
                f"{_num(r.get('years_experience'))} {t['years_exp']}. "
                f"{t['skills']} : {skills}."
            )
        return "\n".join(lines)

    if intent == "matching_explanation":
        b = results.get("score_breakdown") or {}
        weights = b.get("weights") or {}
        cand = results.get("candidate") or {}
        offer = results.get("offer") or {}
        cand_skills = set(cand.get("skills") or [])
        required = set(offer.get("required_skills") or [])
        matched = sorted(cand_skills & required)
        missing = sorted(required - cand_skills)
        header = t["score_for"].format(
            score=_pct(results.get("match_score")),
            name=cand.get("name") or t["unknown"],
            title=offer.get("title") or t["unspecified"],
        )
        return (
            f"{header}\n"
            f"- {t['semantic']} : {_pct(b.get('semantic', 0))} "
            f"({t['weight']} {weights.get('semantic', '?')})\n"
            f"- {t['skill_coverage']} : {_pct(b.get('skills', 0))} "
            f"({t['weight']} {weights.get('skills', '?')}) — "
            f"{t['matched']} : {', '.join(matched) or t['none']} ; "
            f"{t['missing']} : {', '.join(missing) or t['none']}\n"
            f"- {t['education_fit']} : {_pct(b.get('education', 0))} "
            f"({t['weight']} {weights.get('education', '?')}) — "
            f"{t['candidate']} : {cand.get('education_level') or t['unknown']}, "
            f"{t['required']} : {offer.get('min_education_level') or t['unspecified']}"
        )

    # policy_qa: quote the best chunks with their sources rather than generate.
    lines = [t["extracts"]]
    for r in results:
        text = (r.get("text") or "")[:400].strip()
        lines.append(f"- [{r.get('source_document') or t['unknown']}] {text}…")
    return "\n".join(lines)
