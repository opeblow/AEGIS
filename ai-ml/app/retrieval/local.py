"""Local document retrieval.

For the current (mock) provider this is a deterministic keyword-over-context
retriever: given a query, it returns the document snippets in the context whose
text contains the query terms, each with its own score. It exists so the
pipeline has a retrieval seam that a hosted provider could later back with an
embedding index without callers changing.
"""

from __future__ import annotations

import re
from typing import Iterable

from app.schemas.context import DocumentContextInfo

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "for", "is", "are", "on",
    "in", "this", "that", "with", "from", "by", "at", "be", "it", "as",
}


def tokenize(text: str) -> list[str]:
    return [
        w
        for w in re.findall(r"[a-zA-Z0-9]{2,}", text.lower())
        if w not in STOPWORDS
    ]


class LocalRetriever:
    def __init__(self, documents: Iterable[DocumentContextInfo]) -> None:
        self._docs = list(documents)
        self._index = {
            doc.id: set(tokenize(doc.text or "")) for doc in self._docs
        }

    def search(self, query: str, limit: int = 3) -> list[dict]:
        terms = set(tokenize(query))
        if not terms:
            return []
        scored: list[tuple[float, DocumentContextInfo]] = []
        for doc in self._docs:
            tokens = self._index.get(doc.id, set())
            if not tokens:
                continue
            hits = len(terms & tokens)
            if hits == 0:
                continue
            score = hits / len(terms)
            scored.append((score, doc))
        scored.sort(key=lambda t: (-t[0], t[1].id))
        return [
            {
                "document_id": doc.id,
                "title": doc.title,
                "score": round(score, 4),
                "snippet": _snippet(doc.text or "", limit_chars=140),
            }
            for score, doc in scored[:limit]
        ]


def _snippet(text: str, limit_chars: int = 140) -> str:
    if not text:
        return ""
    if len(text) <= limit_chars:
        return text
    return text[:limit_chars] + "…"