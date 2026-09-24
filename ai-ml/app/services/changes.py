"""Deterministic change detection.

Compares a previous offer vs the current offer, and document versions where
structured extraction supports it. Significance is only computed from explicit
deterministic rules; anything interpretive carries an `ai_interpretation` label
and is clearly identified as AI-generated.
"""

from __future__ import annotations

from typing import Optional

from app.core.finance import (
    decimal_relative_diff_percent,
    is_valid_amount,
    normalize,
)
from app.schemas.context import (
    DealIntelligenceContext,
    DocumentContextInfo,
    OfferContextInfo,
)
from app.schemas.output import DealChange

MATERIAL_THRESHOLD = 0.20  # 20% relative move on a money field
MODERATE_THRESHOLD = 0.05


def _significance_for(
    field: str, before: str | None, after: str | None
) -> str:
    if field in ("amount", "price") and before and after:
        if is_valid_amount(before) and is_valid_amount(after):
            rel = decimal_relative_diff_percent(before, after)
            if rel is None:
                return "material"
            if abs(rel) >= MATERIAL_THRESHOLD:
                return "material"
            if abs(rel) >= MODERATE_THRESHOLD:
                return "moderate"
            return "minor"
    if field == "status":
        return "moderate"
    return "minor"


def _offer_diff(prev: OfferContextInfo, curr: OfferContextInfo) -> list[DealChange]:
    changes: list[DealChange] = []

    def add(field: str, before: object, after: object, change_type: str) -> None:
        b = _str(before)
        a = _str(after)
        if b == a:
            return
        changes.append(
            DealChange(
                field=field,
                before=b,
                after=a,
                change_type="modified",  # type: ignore[arg-type]
                significance=_significance_for(field, b, a),  # type: ignore[arg-type]
                source=f"offer:{curr.id}",
                confidence=1.0,
                deterministic=True,
            )
        )

    if prev.amount is not None and curr.amount is not None:
        add("amount", prev.amount, curr.amount, "modified")
    if prev.price is not None or curr.price is not None:
        add("price", prev.price, curr.price, "modified")
    add("currency", prev.currency, curr.currency, "modified")
    add("settlement_date", prev.settlement_date, curr.settlement_date, "modified")
    add("expires_at", prev.expires_at, curr.expires_at, "modified")
    add("status", prev.status, curr.status, "status_modified")
    return changes


def _document_diff(prev: DocumentContextInfo, curr: DocumentContextInfo) -> list[DealChange]:
    changes: list[DealChange] = []
    if prev.title != curr.title:
        changes.append(
            DealChange(
                field="title",
                before=prev.title,
                after=curr.title,
                change_type="modified",  # type: ignore[arg-type]
                significance="minor",
                source=f"document:{curr.id}.v{curr.version}",
                confidence=1.0,
                deterministic=True,
            )
        )
    if prev.status != curr.status:
        changes.append(
            DealChange(
                field="status",
                before=prev.status,
                after=curr.status,
                change_type="status_modified",  # type: ignore[arg-type]
                significance="minor",
                source=f"document:{curr.id}.v{curr.version}",
                confidence=1.0,
                deterministic=True,
            )
        )
    return changes


def detect_changes(context: DealIntelligenceContext) -> list[DealChange]:
    """Primary change list: offer-to-offer plus document supersession diffs."""
    changes: list[DealChange] = []

    submitted = [
        o for o in context.offers if o.status in ("SUBMITTED", "COUNTERED", "ACCEPTED")
    ]
    if len(submitted) >= 2:
        key = lambda o: (o.submitted_at or o.created_at, o.created_at)
        ordered = sorted(submitted, key=key)
        prev, curr = ordered[-2], ordered[-1]
        changes.extend(_offer_diff(prev, curr))

        # An order difference between the deal's latest offer amount and the
        # deal notional is a material change worth surfacing deterministically.
        if (
            curr.amount is not None
            and is_valid_amount(curr.amount)
            and is_valid_amount(context.deal.notional_amount)
            and curr.amount != context.deal.notional_amount
        ):
            changes.append(
                DealChange(
                    field="amount_vs_deal_notional",
                    before=context.deal.notional_amount,
                    after=curr.amount,
                    change_type="modified",  # type: ignore[arg-type]
                    significance=_significance_for(
                        "amount",
                        context.deal.notional_amount,
                        curr.amount,
                    ),  # type: ignore[arg-type]
                    source=f"offer:{curr.id}",
                    confidence=1.0,
                    deterministic=True,
                )
            )

    # Document supersession diffs.
    docs = [d for d in context.documents if d.supersedes_id]
    for d in docs:
        parent = next(
            (x for x in context.documents if x.id == d.supersedes_id), None
        )
        if parent:
            changes.extend(_document_diff(parent, d))

    return changes


def _str(value: object) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, str):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)