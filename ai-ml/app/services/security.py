"""Prompt-injection defense.

Defense in depth. Even though the pipeline is deterministic-first and never
concatenates untrusted text into a model prompt, we still:

  * strip/handle delimiter injection attempts in any text that could reach a
    downstream model,
  * reject documents whose extracted text contains long runs of instruction
    syntax that are a hallmark of delegated-prompt attacks,
  * ensure document text is always treated as DATA, never instructions.

The API never echoes raw document text in error messages.
"""

from __future__ import annotations

import re

_INJECTION_PATTERNS = (
    re.compile(r"ignore (all )?(previous|prior|above) instructions", re.I),
    re.compile(r"\b(?:system|developer)\s*prompt\b", re.I),
    re.compile(r"<\|(?:im_start|im_end|system|user)\|>"),
    re.compile(r"forget\s+(?:everything|context)", re.I),
    re.compile(r"disregard\s+(?:all )?(?:the )?instructions", re.I),
    re.compile(r"you (?:are|act as) (?:now )?(?:a|the) ai", re.I),
    re.compile(r"ignore\s+(?:the )?(?:above|previous)\s+(?:text|content|prompt)", re.I),
    re.compile(r"role\s*[:=]\s*user", re.I),
)

_MAX_DOC_CHARS = 100_000


def sanitize_for_model(text: str) -> str:
    """Remove/replace characters that could terminate or escape the assumed
    context framing of a prompt before anything is passed to a model."""
    t = text
    t = re.sub(r"<\|(?:im_start|im_end|system|user)\|>", "", t)
    t = re.sub(r"<[/]?(?:system|user|assistant)>", "", t)
    # Cap size so no single document can blow the request budget.
    return t[:_MAX_DOC_CHARS]


def injection_score(text: str) -> float:
    """0.0..1.0 heuristic that huge runs of instruction-style text are
    delegating an attack. A high score means the document deserves extra
    review, never that it is discarded by default."""
    if not text:
        return 0.0
    score = 0.0
    for pattern in _INJECTION_PATTERNS:
        if pattern.search(text):
            score += 0.25
    return min(score, 1.0)


def classified_injection(text: str) -> bool:
    """Boolean used by document intelligence: is this text suspicious enough
    to warrant a 'requires review' flag?"""
    return injection_score(text) >= 0.5