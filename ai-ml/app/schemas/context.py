"""Authorized deal-context schema.

The AI/ML service NEVER queries the production database. The backend collects
only the fields it has explicitly authorized for the request and sends them
here. Every numeric monetary field travels as a string so that deterministic
finance work downstream can use exact Decimal arithmetic.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    """Base for all context models: extra fields from the backend are
    rejected so a malformed or over-broad payload cannot slip through."""

    model_config = ConfigDict(extra="forbid")


class DealContextInfo(StrictModel):
    id: str
    reference: str
    type: str
    status: str
    name: str
    description: Optional[str] = None
    currency: str
    notional_amount: str = Field(min_length=1)
    settled_amount: Optional[str] = None
    settlement_date: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    version: int
    created_at: datetime
    updated_at: datetime


class OfferContextInfo(StrictModel):
    id: str
    status: str
    version: int
    parent_offer_id: Optional[str] = None
    currency: str
    amount: str = Field(min_length=1)
    price: Optional[str] = None
    settlement_date: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    submitted_at: Optional[datetime] = None
    created_at: datetime
    created_by_organization_id: str
    recipient_organization_id: str


class DocumentContextInfo(StrictModel):
    id: str
    document_type: str
    title: str
    status: str
    version: int
    chain_id: str
    supersedes_id: Optional[str] = None
    original_filename: Optional[str] = None
    size_bytes: Optional[int] = None
    sha256: Optional[str] = None
    submitted_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    # Optional extracted text. Never self-prompting: this is DATA fed to the
    # intelligence layer, treated as untrusted content.
    text: Optional[str] = None


class RequirementContextInfo(StrictModel):
    id: str
    requirement_type: str
    title: str
    description: Optional[str] = None
    status: str
    required: bool
    due_at: Optional[datetime] = None
    assigned_organization_id: Optional[str] = None
    satisfied_at: Optional[datetime] = None
    created_at: datetime


class ApprovalWorkflowContextInfo(StrictModel):
    workflow_status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    requests: list["ApprovalRequestContextInfo"] = Field(default_factory=list)


class ApprovalRequestContextInfo(StrictModel):
    id: str
    approver_role: Optional[str] = None
    sequence: int
    required: bool
    status: str
    due_at: Optional[datetime] = None
    responded_at: Optional[datetime] = None


class SettlementContextInfo(StrictModel):
    id: str
    provider: str
    provider_reference: Optional[str] = None
    status: str
    amount: str = Field(min_length=1)
    currency: str
    asset_identifier: Optional[str] = None
    submitted_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    failure_reason: Optional[str] = None
    created_at: datetime


class ReconciliationContextInfo(StrictModel):
    id: str
    status: str
    expected_amount: Optional[str] = None
    actual_amount: Optional[str] = None
    expected_currency: Optional[str] = None
    actual_currency: Optional[str] = None
    mismatch_reason: Optional[str] = None
    checked_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None


class NegotiationEventContextInfo(StrictModel):
    id: str
    event_type: str
    offer_id: Optional[str] = None
    deal_id: str
    actor_organization_id: Optional[str] = None
    reason: Optional[str] = None
    created_at: datetime


class DealIntelligenceContext(StrictModel):
    """The explicit, deliberately-constructed AI context. Only fields the
    backend authorized for this request appear here."""

    deal_id: str
    organization_id: str
    viewer_organization_id: str
    deal: DealContextInfo
    offers: list[OfferContextInfo] = Field(default_factory=list)
    documents: list[DocumentContextInfo] = Field(default_factory=list)
    requirements: list[RequirementContextInfo] = Field(default_factory=list)
    approval: Optional[ApprovalWorkflowContextInfo] = None
    settlement: Optional[SettlementContextInfo] = None
    reconciliation: Optional[ReconciliationContextInfo] = None
    negotiation_events: list[NegotiationEventContextInfo] = Field(
        default_factory=list
    )
    client_version: str = "1.0"


class DealIntelligenceQuery(StrictModel):
    deal_id: str
    organization_id: str
    viewer_organization_id: str
    question: str = Field(min_length=1, max_length=512)
    deal: DealContextInfo
    offers: list[OfferContextInfo] = Field(default_factory=list)
    documents: list[DocumentContextInfo] = Field(default_factory=list)
    requirements: list[RequirementContextInfo] = Field(default_factory=list)
    approval: Optional[ApprovalWorkflowContextInfo] = None
    settlement: Optional[SettlementContextInfo] = None
    reconciliation: Optional[ReconciliationContextInfo] = None
    negotiation_events: list[NegotiationEventContextInfo] = Field(
        default_factory=list
    )
    client_version: str = "1.0"


ApprovalWorkflowContextInfo.model_rebuild()