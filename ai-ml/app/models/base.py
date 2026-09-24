"""Model provider abstraction.

Aegis Deal Intelligence is intentionally NOT hard-wired to a single model
vendor. Providers implement this interface; the running provider is selected by
`MODEL_PROVIDER` configuration. Today the only shipped provider is the
deterministic MOCK provider (no credentials required). A hosted provider can be
added behind the same interface without touching callers.

Provider outputs are advisory. They never mutate transaction state.
"""

from __future__ import annotations

import abc
from typing import Optional, Protocol

from app.schemas.context import DealIntelligenceContext
from app.schemas.output import (
    DealSummary,
    EvidenceItem,
    QueryAnswer,
)


class ProviderMeta(Protocol):
    provider: str
    version: str


class ModelProvider(abc.ABC):
    provider: str
    version: str

    @property
    def meta(self) -> dict:
        return {"provider": self.provider, "version": self.version}

    @abc.abstractmethod
    def generate_deal_summary(
        self,
        context: DealIntelligenceContext,
        key_facts: list[EvidenceItem],
    ) -> DealSummary:
        """Human-friendly deal summary from supplied, already-validated facts."""

    @abc.abstractmethod
    def generate_negotiation_summary(
        self,
        context: DealIntelligenceContext,
        facts: dict,
    ) -> str:
        """Narrative explanation of the negotiation history."""

    @abc.abstractmethod
    def generate_readiness_explanation(
        self,
        required: int,
        satisfied: int,
        outstanding: int,
        blocked: bool,
    ) -> str:
        """Hunan-friendly explanation of a DETERMINISTIC readiness count."""

    @abc.abstractmethod
    def answer_question(
        self,
        context: DealIntelligenceContext,
        question: str,
        deterministic_answer: str,
        evidence: list[str],
        within_scope: bool,
        confidence: float,
    ) -> QueryAnswer:
        """Wrap a deterministic/answer into a model-labeled QueryAnswer."""


class ProviderFactory:
    def create(self, name: str) -> ModelProvider:
        from app.models.mock.provider import MockModelProvider

        if name in ("mock", "MockModelProvider"):
            return MockModelProvider()
        if name == "hosted":
            from app.models.hosted.provider import HostedModelProvider

            return HostedModelProvider()
        raise ValueError(f"Unknown model provider: {name!r}")


_default_factory: Optional[ProviderFactory] = None


def get_provider_factory() -> ProviderFactory:
    global _default_factory
    if _default_factory is None:
        _default_factory = ProviderFactory()
    return _default_factory