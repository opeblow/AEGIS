"""Deterministic requirement-readiness explanation.

Readiness is computed from the backend's authoritative requirement list. The
AI does NOT decide "satisfied" — the backend's requirement status is the source
of truth. This service only explains what the deterministic counts mean.
"""

from __future__ import annotations

from typing import Optional

from app.models.base import ModelProvider
from app.schemas.context import (
    ApprovalWorkflowContextInfo,
    DealIntelligenceContext,
    RequirementContextInfo,
)
from app.schemas.output import ReadinessExplanation


def _readiness_counts(
    requirements: list[RequirementContextInfo],
) -> tuple[int, int, int]:
    required = sum(1 for r in requirements if r.required)
    satisfied = sum(
        1 for r in requirements if r.required and r.status == "SATISFIED"
    )
    outstanding = required - satisfied
    return required, satisfied, outstanding


def _blocked_by_approval(approval: Optional[ApprovalWorkflowContextInfo]) -> bool:
    if not approval:
        return False
    return approval.workflow_status in ("APPROVED", "COMPLETED")


def compute_readiness_explanation(
    context: DealIntelligenceContext,
    provider: ModelProvider,
    approval: Optional[ApprovalWorkflowContextInfo] = None,
) -> ReadinessExplanation:
    requirements = context.requirements
    required, satisfied, outstanding = _readiness_counts(requirements)
    blocked = outstanding > 0 or _blocked_by_approval(approval)
    explanation = provider.generate_readiness_explanation(
        required, satisfied, outstanding, blocked
    )
    return ReadinessExplanation(
        required=required,
        satisfied=satisfied,
        outstanding=outstanding,
        blocked=blocked,
        explanation=explanation,
    )