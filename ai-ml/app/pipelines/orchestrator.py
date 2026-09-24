"""Intelligence pipeline orchestration.

Pulls the deterministic services together, applies the model provider for
language generation, computes an input-hash for provenance, and assembles the
final advisory DealIntelligenceResult. The pipeline itself is a pure function
of the (authorized) context, so identical inputs imply identical outputs unless
the model provider is genuinely non-deterministic.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import structlog

from app.core.config import settings
from app.core.errors import raise_ai_error
from app.models.base import ModelProvider, get_provider_factory
from app.schemas.context import DealIntelligenceContext, DealIntelligenceQuery
from app.schemas.output import (
    DealChange,
    DealIntelligenceResult,
    EvidenceItem,
    ProviderMeta,
    QueryAnswer,
)
from app.services.changes import detect_changes
from app.services.compare import compare_offers
from app.services.documents import analyze_documents
from app.services.negotiation import compute_negotiation_summary
from app.services.query import answer_question
from app.services.readiness import compute_readiness_explanation
from app.services.risk import detect_risk_blockers

logger = structlog.get_logger(__name__)


def _provider() -> ModelProvider:
    name = settings().model_provider
    try:
        return get_provider_factory().create(name)
    except ValueError:
        raise_ai_error(
            "AI_PROVIDER_ERROR", f"Unknown model provider: {name!r}"
        )
    raise AssertionError("unreachable")


def input_hash_of(*payloads: object) -> str:
    """Stable content hash over the payloads, used for provenance and later
    dedup/change detection."""
    digest = hashlib.sha256()
    for p in payloads:
        raw = json.dumps(
            p, sort_keys=True, default=_json_default
        ).encode("utf-8")
        digest.update(raw)
    return digest.hexdigest()[:48]


def _json_default(value: object) -> str:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc).isoformat()
    return str(value)


def _build_evidence(context: DealIntelligenceContext) -> list[EvidenceItem]:
    return [
        EvidenceItem(label="deal", value=context.deal.reference),
        EvidenceItem(label="type", value=context.deal.type),
        EvidenceItem(label="currency", value=context.deal.currency),
        EvidenceItem(
            label="notional", value=context.deal.notional_amount
        ),
        EvidenceItem(
            label="status", value=context.deal.status
        ),
    ]


def analyze(context: DealIntelligenceContext) -> DealIntelligenceResult:
    model = _provider()
    evidence = _build_evidence(context)
    comparison = compare_offers(context)
    changes = detect_changes(context)
    risk_signals = detect_risk_blockers(context)
    document_findings = analyze_documents(context)
    readiness = compute_readiness_explanation(context, model)
    negotiation = compute_negotiation_summary(context, model)

    summary = model.generate_deal_summary(context, evidence)

    result = DealIntelligenceResult(
        deal_id=context.deal_id,
        summary=summary,
        offer_comparison=comparison,
        changes=changes,
        risk_flags=risk_signals.risk_flags,
        blockers=risk_signals.blockers,
        document_findings=document_findings,
        readiness_explanation=readiness,
        negotiation=negotiation,
        confidence=_result_confidence(context, model),
        model=ProviderMeta(**model.meta),
        version=settings().analysis_version,
        input_hash=_input_hash(context),
    )
    return result


def _result_confidence(
    context: DealIntelligenceContext, model: ModelProvider
) -> float:
    """Deterministic rules are 1.0; anything model-bound is model-labeled and
    down-weighted so consumers never mistake advisory for authoritative."""
    non_deterministic = 0
    for change in _gather_changes(context):
        if not change.deterministic:
            non_deterministic += 1
    if model.provider == "mock":
        return 0.5
    if non_deterministic > 0:
        return 0.35
    return 1.0


def _gather_changes(context: DealIntelligenceContext) -> list[DealChange]:
    return detect_changes(context)


def _input_hash(context: DealIntelligenceContext) -> str:
    return input_hash_of(_context_payload(context))


def _context_payload(context: DealIntelligenceContext) -> dict:
    return context.model_dump(mode="json")


def run_query(
    context: DealIntelligenceQuery, model: ModelProvider | None = None
) -> QueryAnswer:
    provider = model or _provider()
    ctx = DealIntelligenceContext(
        deal_id=context.deal_id,
        organization_id=context.organization_id,
        viewer_organization_id=context.viewer_organization_id,
        deal=context.deal,
        offers=context.offers,
        documents=context.documents,
        requirements=context.requirements,
        approval=context.approval,
        settlement=context.settlement,
        reconciliation=context.reconciliation,
        negotiation_events=context.negotiation_events,
    )
    return answer_question(ctx, context.question, provider)