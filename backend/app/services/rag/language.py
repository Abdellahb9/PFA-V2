"""Query-language detection (French / English) for bilingual answers.

A lightweight stopword heuristic — no dependency, deterministic, and good
enough for short assistant queries. Ties default to French (primary audience).

Contrepartie serverless : ``detectLanguage`` dans
``netlify/functions/_shared/rag.ts``. Les deux listes de mots ont déjà divergé
une fois (« était » n'existe que côté Python) : toute modification de l'une doit
être reportée sur l'autre, ou les deux déploiements répondront dans des langues
différentes à la même question.
"""

from __future__ import annotations

import re

Language = str  # "fr" | "en"

_FR_WORDS = frozenset(
    "le la les un une des du de et est sont quelle quel quels quelles pourquoi "
    "comment combien avec pour dans qui que quoi sur pas plus trouve cherche "
    "moi mon ma mes ce cette ces son sa ses stage durée politique règle "
    "candidat compétence expérience était être avoir fait ans an mois".split()
)
_EN_WORDS = frozenset(
    "the a an and is are was were what which why how much many with for in on "
    "who that this these those find search show me my of to from do does can "
    "could should would internship policy rule candidate skill experience "
    "years year months".split()
)


def detect_language(text: str) -> Language:
    """Return ``"fr"`` or ``"en"`` for a short natural-language query."""
    words = re.findall(r"[a-zà-ÿ']+", text.lower())
    fr = sum(1 for w in words if w in _FR_WORDS)
    en = sum(1 for w in words if w in _EN_WORDS)
    # Accented characters are a strong French signal.
    fr += sum(1 for c in text if c in "àâçéèêëîïôùûüÿœ")
    return "en" if en > fr else "fr"
