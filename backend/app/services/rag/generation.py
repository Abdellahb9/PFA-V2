"""Answer generation over retrieved context, provider-agnostic (OpenAI/Mistral).

Reuses the LangChain chat-model factory from ``app.services.nlp.llm``. When no
LLM provider is configured the module degrades to deterministic, templated
French answers built from the retrieved data — the assistant stays functional
offline, consistent with the rest of the system.
"""

from __future__ import annotations

import json
import logging

from app.services.nlp import llm as llm_module

logger = logging.getLogger(__name__)

# Guardrails baked into every prompt: answer in French, ground every claim in
# the provided context, cite sources, and say "je ne sais pas" instead of guessing.
_PROMPTS: dict[str, str] = {
    "candidate_search": (
        "Tu es l'assistant RH de PHOSBOUCRAA. Voici des profils de candidats "
        "retrouvés par recherche sémantique pour la requête d'un recruteur.\n"
        "Requête: {query}\n\nProfils (JSON):\n{context}\n\n"
        "Résume en français les candidats les plus pertinents et pourquoi "
        "(compétences, expérience, formation). Base-toi UNIQUEMENT sur ces "
        "données. Si aucun profil ne correspond, dis-le clairement."
    ),
    "matching_explanation": (
        "Tu es l'assistant RH de PHOSBOUCRAA. Explique en français pourquoi ce "
        "candidat a obtenu ce score de matching pour cette offre de stage.\n"
        "Question: {query}\n\nDonnées de l'affectation (JSON):\n{context}\n\n"
        "Le score final est une moyenne pondérée des composantes 'semantic', "
        "'skills' et 'education' du score_breakdown. Appuie CHAQUE affirmation "
        "sur les chiffres du score_breakdown — n'invente aucune qualité ou "
        "lacune qui n'y figure pas."
    ),
    "policy_qa": (
        "Tu es l'assistant RH de PHOSBOUCRAA. Réponds en français à la question "
        "en te basant UNIQUEMENT sur les extraits de documents ci-dessous.\n"
        "Question: {query}\n\nExtraits (JSON, avec source_document):\n{context}\n\n"
        "Cite pour chaque élément de réponse le document source (nom du "
        "document). Si les extraits ne permettent pas de répondre, réponds "
        'exactement: "Je ne trouve pas cette information dans les documents '
        'disponibles." — ne complète jamais avec des connaissances externes.'
    ),
}


def generate_answer(intent: str, query: str, results: list[dict] | dict | None) -> str:
    """Produce a grounded natural-language answer for the given skill."""
    if not results:
        return _empty_answer(intent)

    if llm_module.is_enabled():
        try:
            prompt = _PROMPTS[intent].format(
                query=query,
                context=json.dumps(results, ensure_ascii=False, indent=2)[:12000],
            )
            response = llm_module._build_llm().invoke(prompt)
            return getattr(response, "content", str(response)).strip()
        except Exception as exc:  # pragma: no cover - network failures
            logger.warning("LLM generation failed, using template: %s", exc)

    return _template_answer(intent, results)


def _empty_answer(intent: str) -> str:
    if intent == "policy_qa":
        return "Je ne trouve pas cette information dans les documents disponibles."
    if intent == "matching_explanation":
        return "Affectation introuvable ou sans détail de score."
    return "Aucun résultat ne correspond à cette recherche."


def _template_answer(intent: str, results: list[dict] | dict) -> str:
    """Deterministic fallback answer when no LLM provider is configured."""
    if intent == "candidate_search":
        lines = ["Candidats les plus pertinents :"]
        for r in results:
            skills = ", ".join(r["skills"][:8]) or "aucune compétence détectée"
            lines.append(
                f"- {r['name']} (similarité {r['similarity']:.0%}) — "
                f"{r['education_level'] or 'niveau inconnu'}, "
                f"{r['years_experience']:.0f} an(s) d'expérience. "
                f"Compétences : {skills}."
            )
        return "\n".join(lines)

    if intent == "matching_explanation":
        b = results.get("score_breakdown") or {}
        weights = b.get("weights", {})
        cand, offer = results["candidate"], results["offer"]
        matched = sorted(set(cand["skills"]) & set(offer["required_skills"]))
        missing = sorted(set(offer["required_skills"]) - set(cand["skills"]))
        return (
            f"Score de {results['match_score']:.0%} pour {cand['name']} sur "
            f"l'offre « {offer['title']} » :\n"
            f"- Similarité sémantique : {b.get('semantic', 0):.0%} "
            f"(poids {weights.get('semantic', '?')})\n"
            f"- Couverture des compétences : {b.get('skills', 0):.0%} "
            f"(poids {weights.get('skills', '?')}) — "
            f"acquises : {', '.join(matched) or 'aucune'} ; "
            f"manquantes : {', '.join(missing) or 'aucune'}\n"
            f"- Adéquation formation : {b.get('education', 0):.0%} "
            f"(poids {weights.get('education', '?')}) — "
            f"candidat : {cand['education_level'] or 'inconnu'}, "
            f"requis : {offer['min_education_level'] or 'non spécifié'}"
        )

    # policy_qa: quote the best chunks with their sources rather than generate.
    lines = ["Extraits pertinents des documents :"]
    for r in results:
        lines.append(f"- [{r['source_document']}] {r['text'][:400].strip()}…")
    return "\n".join(lines)
