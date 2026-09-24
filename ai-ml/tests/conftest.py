"""Shared test fixtures: deterministic deal contexts across a realistic deal.

All dates/amounts are fixed so tests are reproducible and independent of
wall-clock time."""  # noqa: D200

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.schemas.context import (
    ApprovalRequestContextInfo,
    ApprovalWorkflowContextInfo,
    DealContextInfo,
    DealIntelligenceContext,
    DealIntelligenceQuery,
    DocumentContextInfo,
    NegotiationEventContextInfo,
    OfferContextInfo,
    ReconciliationContextInfo,
    RequirementContextInfo,
    SettlementContextInfo,
)


def _dt(year: int, month: int, day: int, hour: int = 12) -> datetime:
    return datetime(year, month, day, hour, tzinfo=timezone.utc)


def make_context(*, offers: int = 2, docs: int = 1) -> DealIntelligenceContext:
    deal = DealContextInfo(
        id="deal-1",
        reference="AEG-0001",
        type="PRIVATE_PURCHASE",
        status="NEGOTIATING",
        name="Warehouse Portfolio",
        description="Private purchase of a warehouse portfolio.",
        currency="USD",
        notional_amount="1500000.00",
        settled_amount=None,
        settlement_date=_dt(2026, 12, 15),
        expires_at=_dt(2026, 11, 30),
        version=3,
        created_at=_dt(2026, 1, 1),
        updated_at=_dt(2026, 9, 1),
    )

    offer_specs = [
        OfferContextInfo(
            id="offer-1",
            status="SUBMITTED",
            version=1,
            parent_offer_id=None,
            currency="USD",
            amount="1400000.00",
            price="1400000.00",
            settlement_date=_dt(2026, 12, 10),
            expires_at=_dt(2026, 10, 1),
            submitted_at=_dt(2026, 8, 1),
            created_at=_dt(2026, 8, 1),
            created_by_organization_id="org-seller",
            recipient_organization_id="org-buyer",
        ),
        OfferContextInfo(
            id="offer-2",
            status="COUNTERED",
            version=2,
            parent_offer_id="offer-1",
            currency="USD",
            amount="1550000.00",
            price="1550000.00",
            settlement_date=_dt(2026, 12, 20),
            expires_at=_dt(2026, 10, 20),
            submitted_at=_dt(2026, 8, 20),
            created_at=_dt(2026, 8, 20),
            created_by_organization_id="org-buyer",
            recipient_organization_id="org-seller",
        ),
    ]

    docs_specs = [
        DocumentContextInfo(
            id="doc-1",
            document_type="TERM_SHEET",
            title="Term sheet v1",
            status="REVIEWED",
            version=1,
            chain_id="chain-1",
            supersedes_id=None,
            original_filename="term.pdf",
            size_bytes=12000,
            sha256="a" * 64,
            submitted_at=_dt(2026, 7, 1),
            reviewed_at=_dt(2026, 7, 5),
            created_at=_dt(2026, 7, 1),
            text=(
                "This term sheet contemplates a purchase amount of $1,500,000 "
                "USD with a closing settlement scheduled for December. The "
                "buyer represents it is acquiring the portfolio free of any "
                "adverse interest."
            ),
        )
    ]

    requirements = [
        RequirementContextInfo(
            id="req-1",
            requirement_type="KYC",
            title="Buyer KYC",
            description="Identity verification of the buyer organization.",
            status="SATISFIED",
            required=True,
            due_at=_dt(2026, 9, 1),
            assigned_organization_id="org-buyer",
            satisfied_at=_dt(2026, 8, 10),
            created_at=_dt(2026, 7, 2),
        ),
        RequirementContextInfo(
            id="req-2",
            requirement_type="AML",
            title="Source of funds",
            description="Proof of funds for the notional amount.",
            status="PENDING",
            required=True,
            due_at=_dt(2026, 9, 15),
            assigned_organization_id="org-buyer",
            created_at=_dt(2026, 7, 2),
        ),
        RequirementContextInfo(
            id="req-3",
            requirement_type="LEGAL",
            title="Review opinions",
            description="Legal opinions on title.",
            status="SATISFIED",
            required=False,
            due_at=None,
            created_at=_dt(2026, 7, 2),
        ),
    ]

    approval = ApprovalWorkflowContextInfo(
        workflow_status="IN_PROGRESS",
        started_at=_dt(2026, 8, 1),
        completed_at=None,
        requests=[
            ApprovalRequestContextInfo(
                id="apr-1",
                approver_role="OWNER",
                sequence=1,
                required=True,
                status="APPROVED",
                due_at=None,
                responded_at=_dt(2026, 8, 25),
            ),
            ApprovalRequestContextInfo(
                id="apr-2",
                approver_role="FIN_TRACE",
                sequence=2,
                required=True,
                status="PENDING",
                due_at=_dt(2099, 10, 1),
                responded_at=None,
            ),
        ],
    )

    settlement = SettlementContextInfo(
        id="set-1",
        provider="canton-mock",
        provider_reference="PX-ABC123",
        status="PENDING",
        amount="1550000.00",
        currency="USD",
        asset_identifier="USD",
        submitted_at=_dt(2026, 9, 10),
        completed_at=None,
        failed_at=None,
        failure_reason=None,
        created_at=_dt(2026, 9, 10),
    )

    recon = ReconciliationContextInfo(
        id="rec-1",
        status="RESOLVED",
        expected_amount="1550000.00",
        actual_amount="1550000.00",
        expected_currency="USD",
        actual_currency="USD",
        mismatch_reason=None,
        checked_at=_dt(2026, 9, 11),
        resolved_at=_dt(2026, 9, 11),
    )

    negotiation_events = [
        NegotiationEventContextInfo(
            id="ev-1",
            event_type="OFFER_SUBMITTED",
            offer_id="offer-1",
            deal_id="deal-1",
            actor_organization_id="org-seller",
            created_at=_dt(2026, 8, 1),
        ),
        NegotiationEventContextInfo(
            id="ev-2",
            event_type="OFFER_COUNTERED",
            offer_id="offer-2",
            deal_id="deal-1",
            actor_organization_id="org-buyer",
            created_at=_dt(2026, 8, 20),
        ),
    ]

    return DealIntelligenceContext(
        deal_id="deal-1",
        organization_id="org-seller",
        viewer_organization_id="org-buyer",
        deal=deal,
        offers=offer_specs[:offers],
        documents=docs_specs[:docs],
        requirements=requirements,
        approval=approval,
        settlement=settlement,
        reconciliation=recon,
        negotiation_events=negotiation_events,
    )


def make_query(question: str) -> DealIntelligenceQuery:
    ctx = make_context()
    return DealIntelligenceQuery(
        deal_id=ctx.deal_id,
        organization_id=ctx.organization_id,
        viewer_organization_id=ctx.viewer_organization_id,
        question=question,
        deal=ctx.deal,
        offers=ctx.offers,
        documents=ctx.documents,
        requirements=ctx.requirements,
        approval=ctx.approval,
        settlement=ctx.settlement,
        reconciliation=ctx.reconciliation,
        negotiation_events=ctx.negotiation_events,
    )


@pytest.fixture
def canonical_context() -> DealIntelligenceContext:
    return make_context()


@pytest.fixture
def canonical_query() -> DealIntelligenceQuery:
    return make_query("What is the latest offer amount?")