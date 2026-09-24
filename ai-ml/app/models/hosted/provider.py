"""Hosted model provider.

An adapter placeholder for an externally-hosted model endpoint. It is not
enabled by default and, crucially, it REFUSES to construct unless credentials
(DEPLOYED_MODEL_URL / API key) are configured in the environment. This keeps the
service honest: no unseen external integration, no silent network calls, no
hard-coded secrets.
"""

from __future__ import annotations

import os
from typing import NoReturn

from app.core.errors import AIServiceError
from app.models.base import ModelProvider
from app.schemas.context import DealIntelligenceContext
from app.schemas.output import DealSummary, EvidenceItem, ProviderMeta, QueryAnswer


def _not_connected() -> NoReturn:
    raise AIServiceError(
        "AI_PROVIDER_ERROR",
        "Hosted model provider is not connected.",
    )


class HostedModelProvider(ModelProvider):
    provider = "hosted"
    version = "unconfigured"

    def __init__(self) -> None:
        url = os.environ.get("DEPLOYED_MODEL_URL", "").strip()
        if not url or not os.environ.get("DEPLOYED_MODEL_API_KEY", "").strip():
            raise AIServiceError(
                "AI_PROVIDER_ERROR",
                "Hosted model provider requested but DEPLOYED_MODEL_URL / "
                "DEPLOYED_MODEL_API_KEY are not configured.",
            )

    def generate_deal_summary(
        self, context: DealIntelligenceContext, key_facts: list[EvidenceItem]
    ) -> DealSummary:
        _not_connected()

    def generate_negotiation_summary(
        self, context: DealIntelligenceContext, facts: dict
    ) -> str:
        _not_connected()

    def generate_readiness_explanation(
        self, required: int, satisfied: int, outstanding: int, blocked: bool
    ) -> str:
        _not_connected()

    def answer_question(
        self,
        context: DealIntelligenceContext,
        question: str,
        deterministic_answer: str,
        evidence: list[str],
        within_scope: bool,
        confidence: float,
    ) -> QueryAnswer:
        _not_connected()