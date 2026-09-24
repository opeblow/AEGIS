"""MOCK model provider.

The default provider. It is fully deterministic: every "model" output is a
template-rendered statement built from the validated structured context. It
exists so the whole intelligence pipeline runs and is testable with no model
credentials, and it is explicitly labeled MOCK so consumers can never mistake
it for a learned model.

Nothing here invokes a network, a GPU, or an external vendor.
"""

from __future__ import annotations

from app.models.base import ModelProvider
from app.schemas.context import DealIntelligenceContext
from app.schemas.output import (
    DealSummary,
    EvidenceItem,
    ProviderMeta,
    QueryAnswer,
)

MOCK_CONFIDENCE = 0.5  # model-bound summary is inherently less certain


class MockModelProvider(ModelProvider):
    provider = "mock"
    version = "aegis-mock-v1"

    def _deal_headline(self, context: DealIntelligenceContext) -> str:
        deal = context.deal
        return (
            f"{deal.type} deal '{deal.name}' ({deal.currency}) is currently "
            f"{deal.status.lower()}."
        )

    def generate_deal_summary(
        self,
        context: DealIntelligenceContext,
        key_facts: list[EvidenceItem],
    ) -> DealSummary:
        facts = "; ".join(f"{f.label}: {f.value}" for f in key_facts)
        summary = (
            f"{self._deal_headline(context)} Notional {context.deal.notional_amount} "
            f"{context.deal.currency}."
        )
        if key_facts:
            summary += f" Key facts: {facts}."
        return DealSummary(
            summary=summary,
            key_facts=key_facts,
            model_summary=True,
        )

    def generate_negotiation_summary(
        self,
        context: DealIntelligenceContext,
        facts: dict,
    ) -> str:
        offers = len(context.offers)
        if offers == 0:
            return "No offers have been exchanged yet."
        concession_rows = facts.get("concessions", [])
        changed = facts.get("changed_terms", [])
        parts = [
            f"{offers} offer(s) have been exchanged across the negotiation."
        ]
        if concession_rows:
            names = ", ".join(
                f"{r['field']} ({r['from_value']} -> {r['to_value']})"
                for r in concession_rows[:5]
            )
            parts.append(f"Concessions observed: {names}.")
        if changed:
            parts.append("Changed terms: " + ", ".join(changed[:5]) + ".")
        return " ".join(parts)

    def generate_readiness_explanation(
        self,
        required: int,
        satisfied: int,
        outstanding: int,
        blocked: bool,
    ) -> str:
        if required == 0:
            return "No requirements are configured, so requirement readiness is not blocking."
        if blocked:
            return (
                f"{outstanding} requirement(s) remain outstanding out of "
                f"{required} required before approval can proceed."
            )
        return (
            f"All {satisfied} of {required} required requirements are satisfied."
        )

    def answer_question(
        self,
        context: DealIntelligenceContext,
        question: str,
        deterministic_answer: str,
        evidence: list[str],
        within_scope: bool,
        confidence: float,
    ) -> QueryAnswer:
        return QueryAnswer(
            deal_id=context.deal_id,
            question=question,
            answer=deterministic_answer,
            evidence=evidence,
            within_scope=within_scope,
            confidence=confidence,
            model=ProviderMeta(**self.meta),
            version="1",
        )