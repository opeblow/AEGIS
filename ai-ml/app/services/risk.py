"""Deterministic risk and blocker detection.

Risk signals are computed from explicit, auditable rules over the structured
context. No invented values, no probabilistic guesses. Anything downstream that
wants an interpretive label must add it with `deterministic_or_model`,
`confidence`, and `requires_review` so a human always knows the provenance.
"""

from __future__ import annotations

from typing import Optional

from app.core.finance import has_decimal_overlap, money_conflicts
from app.schemas.context import (
    ApprovalWorkflowContextInfo,
    DealIntelligenceContext,
    OfferContextInfo,
)
from app.schemas.output import RiskFlag, RiskBlockerSignals

RISK_RULE_SET = (
    "Expiring valuable deal",
    "Offer expires before it can be accepted",
    "Approval request is overdue",
    "Money conflict between deal and latest offer",
    "Money conflict within approval workflow",
    "High-risk deal type",
)


def _optional_date(value: object) -> bool:
    return value is not None


def _latest_live_offer(context: DealIntelligenceContext) -> Optional[OfferContextInfo]:
    live = [
        o
        for o in context.offers
        if o.status in ("SUBMITTED", "COUNTERED", "ACCEPTED")
    ]
    if not live:
        return None
    key = lambda o: (o.created_at, o.id)
    return sorted(live, key=key)[-1]


def _expiring(deal_expiry, offer_expiry) -> list[RiskFlag]:
    flags: list[RiskFlag] = []
    if deal_expiry is not None:
        flags.append(
            RiskFlag(
                category="timing",
                severity="medium",
                explanation=f"The deal expires {deal_expiry.date().isoformat()}.",
                evidence=[f"Deal expires_at={deal_expiry.isoformat()}"],
                confidence=1.0,
                deterministic_or_model="deterministic",
                requires_review=False,
            )
        )
    if offer_expiry is not None:
        flags.append(
            RiskFlag(
                category="timing",
                severity="medium",
                explanation=(
                    f"The latest offer expires {offer_expiry.date().isoformat()} "
                    "and cannot be accepted after that point."
                ),
                evidence=[f"Offer expires_at={offer_expiry.isoformat()}"],
                confidence=1.0,
                deterministic_or_model="deterministic",
                requires_review=False,
            )
        )
    return flags


def _overdue_approval(approval: Optional[ApprovalWorkflowContextInfo]) -> list[RiskFlag]:
    flags: list[RiskFlag] = []
    if not approval:
        return flags
    for req in approval.requests:
        if req.status in ("PENDING", "AWAITING_RESPONSE") and req.due_at is not None:
            flags.append(
                RiskFlag(
                    category="approval",
                    severity="high",
                    explanation=(
                        f"Approval request seq {req.sequence} is due "
                        f"{req.due_at.date().isoformat()} and has not been "
                        "responded to."
                    ),
                    evidence=[
                        f"approval_request_id={req.id}",
                        f"due_at={req.due_at.isoformat()}",
                    ],
                    confidence=1.0,
                    deterministic_or_model="deterministic",
                    requires_review=False,
                )
            )
    return flags


def _money_conflicts(context: DealIntelligenceContext) -> list[RiskFlag]:
    flags: list[RiskFlag] = []
    deal = context.deal
    latest = _latest_live_offer(context)
    if deal.notional_amount and latest and latest.amount:
        if money_conflicts(latest.amount, deal.notional_amount):
            flags.append(
                RiskFlag(
                    category="conflicts",
                    severity="high",
                    explanation=(
                        f"The latest offer amount {latest.amount} "
                        f"{latest.currency} conflicts with the deal notional "
                        f"{deal.notional_amount} {deal.currency}."
                    ),
                    evidence=[
                        f"offer={latest.id} amount={latest.amount}",
                        f"deal notional={deal.notional_amount}",
                    ],
                    confidence=1.0,
                    deterministic_or_model="deterministic",
                    requires_review=False,
                    finding="Money conflict between deal and latest offer",
                )
            )

    if (
        context.settlement
        and context.settlement.amount
        and has_decimal_overlap(context.settlement.amount)
        and deal.notional_amount
        and money_conflicts(context.settlement.amount, deal.notional_amount)
    ):
        flags.append(
            RiskFlag(
                category="conflicts",
                severity="high",
                explanation=(
                    f"Settlement amount {context.settlement.amount} "
                    f"{context.settlement.currency} conflicts with deal "
                    f"notional {deal.notional_amount} {deal.currency}."
                ),
                evidence=[
                    f"settlement={context.settlement.id}",
                    f"settlement amount={context.settlement.amount}",
                ],
                confidence=1.0,
                deterministic_or_model="deterministic",
                requires_review=False,
                finding="Money conflict between settlement and deal terms",
            )
        )

    # Requirement money conflicts: detected inside requirement processor and
    # surfaced here through the reconciliation lens.
    if context.reconciliation and context.reconciliation.mismatch_reason:
        flags.append(
            RiskFlag(
                category="reconciliation",
                severity="high",
                explanation=(
                    "Reconciliation did not match: "
                    f"{context.reconciliation.mismatch_reason}"
                ),
                evidence=[f"reconciliation={context.reconciliation.id}"],
                confidence=1.0,
                deterministic_or_model="deterministic",
                requires_review=True,
                finding="Reconciliation mismatch remains unresolved",
            )
        )
    return flags


def _high_risk_deal_type(context: DealIntelligenceContext) -> list[RiskFlag]:
    flags: list[RiskFlag] = []
    risky = {"RWA", "PRIVATE_LOAN", "OTC_DERIVATIVE"}
    deal_type = (context.deal.type or "").upper()
    if not deal_type:
        return flags
    if not any(t in deal_type for t in risky):
        return flags
    flags.append(
        RiskFlag(
            category="deal_type",
            severity="high",
            explanation=(
                f"Deal type '{deal_type}' is a high-risk, non-standard "
                "financial instrument; the system marks it for extra "
                "oversight."
            ),
            evidence=[f"deal.type={deal_type}"],
            confidence=1.0,
            deterministic_or_model="deterministic",
            requires_review=True,
        )
    )
    return flags


def _blocker_rules(context: DealIntelligenceContext) -> list[RiskFlag]:
    """True blockers: conditions that currently prevent approval/settlement."""
    blockers: list[RiskFlag] = []
    deal = context.deal

    if deal.notional_amount and has_decimal_overlap(
        deal.notional_amount
    ) and deal.notional_amount.startswith("-"):
        blockers.append(
            RiskFlag(
                category="data_quality",
                severity="high",
                explanation="The deal's notional amount is negative.",
                evidence=[f"deal.notional_amount={deal.notional_amount}"],
                confidence=1.0,
                deterministic_or_model="deterministic",
                requires_review=True,
                finding="Negative deal notional blocks execution",
            )
        )

    latest = _latest_live_offer(context)
    if latest and latest.amount:
        if has_decimal_overlap(latest.amount) and latest.amount.startswith("-"):
            blockers.append(
                RiskFlag(
                    category="data_quality",
                    severity="high",
                    explanation="The latest offer amount is negative.",
                    evidence=[f"offer={latest.id} amount={latest.amount}"],
                    confidence=1.0,
                    deterministic_or_model="deterministic",
                    requires_review=True,
                    finding="Negative offer amount blocks execution",
                )
            )

    if (
        deal.settled_amount
        and has_decimal_overlap(deal.settled_amount)
        and deal.notional_amount
        and money_conflicts(deal.settled_amount, deal.notional_amount)
    ):
        blockers.append(
            RiskFlag(
                category="conflicts",
                severity="high",
                explanation=(
                    f"The settled amount {deal.settled_amount} differs from the "
                    f"deal notional {deal.notional_amount}."
                ),
                evidence=[
                    f"settled_amount={deal.settled_amount}",
                    f"notional_amount={deal.notional_amount}",
                ],
                confidence=1.0,
                deterministic_or_model="deterministic",
                requires_review=True,
                finding="Settled amount conflicts with notional",
            )
        )

    return blockers


def detect_risk_blockers(
    context: DealIntelligenceContext,
) -> RiskBlockerSignals:
    risk_flags: list[RiskFlag] = []
    risk_flags.extend(_expiring(context.deal.expires_at, None))
    risk_flags.extend(_overdue_approval(context.approval))
    risk_flags.extend(_money_conflicts(context))
    risk_flags.extend(_high_risk_deal_type(context))
    blockers = _blocker_rules(context)
    return RiskBlockerSignals(risk_flags=risk_flags, blockers=blockers)