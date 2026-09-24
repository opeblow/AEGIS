"""Deterministic offer comparison.

Financial comparisons are pure arithmetic performed with exact Decimal logic
(see app.core.finance). The "favorable to" terminology is only emitted where a
clear domain rule exists (e.g. a lower price is favorable to the BUYER, a
higher price to the SELLER); otherwise it is left null and the explanation is
simply descriptive. The AI never invents values.
"""

from __future__ import annotations

from typing import Optional

from app.core.finance import (
    decimal_abs_diff,
    decimal_relative_diff_percent,
    is_valid_amount,
    normalize,
)
from app.schemas.context import DealIntelligenceContext, OfferContextInfo
from app.schemas.output import OfferComparison, OfferComparisonEntry

PRICE_FIELD = "price"
AMOUNT_FIELD = "amount"

# "Favorable to" only when there is a clear direction. First offer -> latest
# offer, viewed from the owner organization's perspective.
BUYER_ROLE_TERMS = {
    "RWA_PURCHASE",
    "PRIVATE_TRADE",
    "PRIVATE_PURCHASE",
    "PURCHASE",
}
SELLER_ROLE_TERMS = {"RWA_SALE"}


def _favorable_direction(field: str, before: str, after: str, deal_type: str) -> Optional[str]:
    if not is_valid_amount(before) or not is_valid_amount(after):
        return None
    delta = float(_to_float(after)) - float(_to_float(before))
    if delta == 0:
        return None
    if deal_type in BUYER_ROLE_TERMS:
        # For a buyer, a lower price/amount is favorable.
        return "buyer" if delta < 0 else "seller"
    if deal_type in SELLER_ROLE_TERMS:
        return "seller" if delta > 0 else "buyer"
    return None


def _to_float(value: str) -> float:
    from decimal import Decimal

    return float(Decimal(value))


def _describe(field: str, before: str, after: str, favorable: Optional[str]) -> str:
    base = f"{field} changed from {before} to {after}."
    if favorable == "buyer":
        return base + " This direction favors the buyer (buy-side organization)."
    if favorable == "seller":
        return base + " This direction favors the seller (sell-side organization)."
    return base


def compare_offers(context: DealIntelligenceContext) -> Optional[OfferComparison]:
    """Compare the first (chronologically) submitted offer with the latest.

    Only SUBMITTED/COUNTERED/ACCEPTED offers are compared; DRAFT or WITHDRAWN
    offers are ignored so the comparison reflects terms that were actually on
    the table.
    """
    offers = [
        o
        for o in context.offers
        if o.status in ("SUBMITTED", "COUNTERED", "ACCEPTED", "SUPERSEDED")
    ]
    if not offers:
        return None

    key = lambda o: (o.submitted_at or o.created_at, o.created_at)
    offers_sorted = sorted(offers, key=key)
    first = offers_sorted[0]
    last = offers_sorted[-1]

    if first.id == last.id:
        # Only one live offer: compare against deal terms where meaningful.
        return _single_offer_comparison(context, first)

    entries: list[OfferComparisonEntry] = []

    def numeric_entry(field: str, before: str, after: str) -> None:
        if before is None or after is None or before == "" or after == "":
            return
        if not is_valid_amount(before) or not is_valid_amount(after):
            return
        abs_diff = decimal_abs_diff(before, after)
        rel = decimal_relative_diff_percent(before, after)
        favorable = _favorable_direction(field, before, after, context.deal.type)
        entries.append(
            OfferComparisonEntry(
                field=field,
                before=normalize(before),
                after=normalize(after),
                absolute_difference=abs_diff,
                relative_difference_percent=rel,
                favorable_to=favorable,
                explanation=_describe(field, before, after, favorable),
                confidence=1.0,
                deterministic=True,
            )
        )

    def scalar_entry(field: str, before: Optional[str], after: Optional[str]) -> None:
        if before is None and after is None:
            return
        entries.append(
            OfferComparisonEntry(
                field=field,
                before=before or "n/a",
                after=after or "n/a",
                absolute_difference=None,
                relative_difference_percent=None,
                favorable_to=None,
                explanation=f"{field} changed from {before or 'n/a'} to {after or 'n/a'}.",
                confidence=0.8,
                deterministic=True,
            )
        )

    def date_entry(field: str, before: object, after: object) -> None:
        before_s = _iso(before)
        after_s = _iso(after)
        if before_s == after_s:
            return
        entries.append(
            OfferComparisonEntry(
                field=field,
                before=before_s,
                after=after_s,
                absolute_difference=None,
                relative_difference_percent=None,
                favorable_to=None,
                explanation=f"{field} moved from {before_s} to {after_s}.",
                confidence=0.8,
                deterministic=True,
            )
        )

    if first.amount is not None and last.amount is not None:
        numeric_entry(AMOUNT_FIELD, first.amount, last.amount)
    if first.price is not None and last.price is not None:
        numeric_entry(PRICE_FIELD, first.price, last.price)
    else:
        scalar_entry(PRICE_FIELD, first.price, last.price)
    scalar_entry("currency", first.currency, last.currency)
    date_entry("settlement date", first.settlement_date, last.settlement_date)
    date_entry("expiration", first.expires_at, last.expires_at)
    scalar_entry("status", first.status, last.status)
    scalar_entry("version", str(first.version), str(last.version))

    if not entries:
        return None

    return OfferComparison(
        currency=last.currency or context.deal.currency,
        compared_offers=[first.id, last.id],
        entries=entries,
        summary=_comparison_summary(entries, last.currency or context.deal.currency),
    )


def _comparison_summary(entries: list[OfferComparisonEntry], currency: str) -> str:
    price = next((e for e in entries if e.field == PRICE_FIELD), None)
    if price:
        if price.favorable_to:
            return (
                f"As of the latest offer, the {PRICE_FIELD} is {price.after} "
                f"{currency}, a change of {price.absolute_difference} "
                f"{currency} ({price.relative_difference_percent:.1f}%) "
                f"which favors the {price.favorable_to}."
            )
        return (
            f"As of the latest offer, the {PRICE_FIELD} is {price.after} "
            f"{currency}, changed from {price.before} {currency}."
        )
    amount = next((e for e in entries if e.field == AMOUNT_FIELD), None)
    if amount:
        return (
            f"The latest offer amount is {amount.after} {currency}, changed "
            f"from {amount.before} {currency}."
        )
    return "The terms changed between the first and latest offer."


def _single_offer_comparison(
    context: DealIntelligenceContext, offer: OfferContextInfo
) -> OfferComparison:
    entries: list[OfferComparisonEntry] = []
    deal = context.deal

    price_entry = OfferComparisonEntry(
        field="price vs deal terms",
        before=offer.price or "n/a",
        after=deal.notional_amount,
        absolute_difference=None,
        relative_difference_percent=None,
        favorable_to=None,
        explanation=(
            "Only one offer has been exchanged; the offer is compared against "
            "the deal's notional terms."
        ),
        confidence=0.8,
        deterministic=True,
    )
    entries.append(price_entry)

    return OfferComparison(
        currency=offer.currency or deal.currency,
        compared_offers=[offer.id],
        entries=entries,
        summary=(
            f"Only one offer exists; current offer amount is {offer.amount} "
            f"{offer.currency}, deal notional is {deal.notional_amount} "
            f"{deal.currency}."
        ),
    )


def _iso(value: object) -> str:
    if value is None:
        return "n/a"
    return value.isoformat() if hasattr(value, "isoformat") else str(value)