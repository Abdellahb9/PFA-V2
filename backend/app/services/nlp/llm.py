"""Optional LLM-based structured extraction via LangChain.

When an OpenAI/Mistral API key is configured, this module asks an LLM to pull
clean structured fields out of a CV (name, education, field, experience, skills).
When no provider is configured it returns ``None`` and the caller falls back to
the deterministic spaCy + gazetteer pipeline — so the system runs fully offline.
"""

from __future__ import annotations

import json
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

_EXTRACTION_PROMPT = """You are an HR assistant. Extract structured data from the
following CV text. Respond with a strict JSON object only, using these keys:
- "first_name" (string)
- "last_name" (string)
- "email" (string or null)
- "phone" (string or null)
- "education_level" (e.g. "Bac+5", "Master", "Ingénieur" or null)
- "field_of_study" (string or null)
- "university" (string or null)
- "years_experience" (number)
- "skills" (array of short skill keywords, lowercase)

CV text:
\"\"\"
{cv_text}
\"\"\"
"""


def is_enabled() -> bool:
    """Whether an LLM provider is configured."""
    if settings.LLM_PROVIDER == "openai":
        return bool(settings.OPENAI_API_KEY)
    if settings.LLM_PROVIDER == "mistral":
        return bool(settings.MISTRAL_API_KEY)
    return False


class LLMConfigurationError(RuntimeError):
    """The provider is declared but cannot be built — a deployment mistake.

    Distinct from a transient network failure: callers degrade gracefully on the
    latter, but must let this one surface. Swallowing it is how the assistant
    spent its whole life silently answering from templates while reporting a
    working LLM.
    """


def build_llm():
    """Instantiate the configured LangChain chat model.

    Raises :class:`LLMConfigurationError` when the provider is misconfigured or
    its optional dependency is missing.
    """
    if settings.LLM_PROVIDER == "openai":
        try:
            from langchain_openai import ChatOpenAI
        except ImportError as exc:  # dépendance optionnelle absente
            raise LLMConfigurationError(
                "LLM_PROVIDER=openai requires the 'langchain-openai' package "
                "(pip install -r backend/requirements.txt)."
            ) from exc
        if not settings.OPENAI_API_KEY:
            raise LLMConfigurationError("LLM_PROVIDER=openai requires OPENAI_API_KEY.")
        return ChatOpenAI(model="gpt-4o-mini", api_key=settings.OPENAI_API_KEY, temperature=0)

    if settings.LLM_PROVIDER == "mistral":
        try:
            # ChatMistralAI n'existe PAS dans langchain_community.chat_models :
            # l'import historique levait AttributeError à chaque appel.
            from langchain_mistralai import ChatMistralAI
        except ImportError as exc:
            raise LLMConfigurationError(
                "LLM_PROVIDER=mistral requires the 'langchain-mistralai' package "
                "(pip install -r backend/requirements.txt)."
            ) from exc
        if not settings.MISTRAL_API_KEY:
            raise LLMConfigurationError("LLM_PROVIDER=mistral requires MISTRAL_API_KEY.")
        return ChatMistralAI(
            model="mistral-small-latest",
            api_key=settings.MISTRAL_API_KEY,
            temperature=0,
        )

    raise LLMConfigurationError(f"Unsupported LLM provider: {settings.LLM_PROVIDER}")


# Conservé pour les appelants historiques ; `build_llm` est le nom public.
_build_llm = build_llm


def extract_structured(cv_text: str) -> dict | None:
    """Return structured CV fields via the LLM, or None on failure/disabled."""
    if not is_enabled():
        return None
    try:
        llm = build_llm()
        prompt = _EXTRACTION_PROMPT.format(cv_text=cv_text[:6000])
        response = llm.invoke(prompt)
        content = getattr(response, "content", str(response))
        # Be tolerant of markdown fences around the JSON.
        content = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
        return json.loads(content)
    except Exception as exc:  # pragma: no cover - network/parse failures
        logger.warning("LLM extraction failed, falling back to spaCy: %s", exc)
        return None
