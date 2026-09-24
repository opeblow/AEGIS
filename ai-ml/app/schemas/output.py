"""Structured intelligence output schemas.

Every non-deterministic result carries confidence, evidence, the model/provider
that produced it, and a "deterministic_or_model" label so a consumer can tell
exactly what kind of logic produced the claim. Money values always travel as
string representations of exact dollars/cents, never floats.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

DeterministicOrModel = Literal["deterministic", "model"]
Severity = Literal["info", "low", "medium", "high"]
ChangeType = Literal["added", "removed", "modified", "status_modified"]
Significance = Literal["none", "minor", "moderate", "material"]


class OutputBase(BaseModel):
    """All output schemas tolerate a small amount of forward compatibility."""

    model_config = ConfigDict(extra="allow")


class EvidenceItem(OutputBase):
    label: str
    value: str


class ProviderMeta(OutputBase):
    provider: str
    version: str


class OfferComparisonEntry(OutputBase):
    field: str
    before: str
    after: str
    absolute_difference: Optional[str] = None
    relative_difference_percent: Optional[float] = None
    favorable_to: Optional[str] = None
    explanation: str
    confidence: float
    deterministic: bool = True


class OfferComparison(OutputBase):
    currency: str
    compared_offers: list[str] = Field(default_factory=list)
    entries: list[OfferComparisonEntry] = Field(default_factory=list)
    summary: str


class DealChange(OutputBase):
    field: str
    before: str
    after: str
    change_type: ChangeType
    significance: Significance
    source: str
    confidence: float
    deterministic: bool = True
    ai_interpretation: Optional[str] = None


class RiskFlag(OutputBase):
    category: str
    severity: Severity
    explanation: str
    evidence: list[str] = Field(default_factory=list)
    confidence: float
    deterministic_or_model: DeterministicOrModel = "deterministic"
    requires_review: bool = True
    finding: str = "Potential issue detected"


class RiskBlockerSignals(OutputBase):
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    blockers: list[RiskFlag] = Field(default_factory=list)


class DocumentFinding(OutputBase):
    document_id: str
    document_type: str
    title: str
    finding_type: str
    finding: str
    confidence: float
    requires_review: bool = True
    evidence: list[str] = Field(default_factory=list)
    label: Literal["AI finding", "Potential issue", "Requires review"] = (
        "AI finding"
    )


class ReadinessExplanation(OutputBase):
    required: int
    satisfied: int
    outstanding: int
    blocked: bool
    explanation: str
    caveat: str = (
        "Deterministic backend requirements remain authoritative; AI only "
        "explains readiness, it never decides satisfaction."
    )


class NegotiationConcession(OutputBase):
    field: str
    from_value: str
    to_value: str
    direction: str


class NegotiationSummary(OutputBase):
    summary: str
    major_concessions: list[NegotiationConcession] = Field(default_factory=list)
    changed_terms: list[str] = Field(default_factory=list)
    unresolved_points: list[str] = Field(default_factory=list)
    latest_counterparty_position: str = ""
    timeline: list[str] = Field(default_factory=list)
    possible_blockers: list[str] = Field(default_factory=list)


class DealSummary(OutputBase):
    summary: str
    key_facts: list[EvidenceItem] = Field(default_factory=list)
    model_summary: bool = False


class DealIntelligenceResult(OutputBase):
    deal_id: str
    summary: DealSummary
    offer_comparison: Optional[OfferComparison] = None
    changes: list[DealChange] = Field(default_factory=list)
    risk_flags: list[RiskFlag] = Field(default_factory=list)
    blockers: list[RiskFlag] = Field(default_factory=list)
    document_findings: list[DocumentFinding] = Field(default_factory=list)
    readiness_explanation: Optional[ReadinessExplanation] = None
    negotiation: Optional[NegotiationSummary] = None
    confidence: float = 0.5
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    model: ProviderMeta
    version: str
    input_hash: str
    ai_warning: str = (
        "AI output is advisory only. It cannot approve, settle, or mutate "
        "authoritative transaction state."
    )


class QueryAnswer(OutputBase):
    deal_id: str
    question: str
    answer: str
    evidence: list[str] = Field(default_factory=list)
    within_scope: bool
    confidence: float
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    model: ProviderMeta
    version: str
    ai_warning: str = "This is an AI-generated interpretation; it is advisory."