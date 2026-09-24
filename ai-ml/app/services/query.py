"""Constrained natural-language query engine.

Queries are answered ONLY against the structured context passed in from the
backend — never by asking a model, never by reaching into other deals, never
from raw document text. Modes (money, dates, parties, parties_side, count,
statuses, negotiation) are matched with keyword patterns. Anything outside the
known modes gets an explicit OUT_OF_SCOPE answer so the query surface is small
and auditable.

The question text is treated as untrusted input: it is never concatenated into
an instruction for a downstream model, and any instruction-sounding language is
neutralized (see app.services.security).
"""

from __future__ import annotations

import re
from typing import Optional

from app.models.base import ModelProvider
from app.schemas.context import DealIntelligenceContext
from app.schemas.output import QueryAnswer

_AMOUNT_KEYWORDS = ("amount", "price", "notional", "money", "dollar", "usd", "how much")
_DATE_KEYWORDS = ("when", "date", "settlement date", "expires", "expiration", "close")
_PARTIES_KEYWORDS = ("party", "who", "counterparty", "organization", "involved")
_SIDE_KEYWORDS = ("side", "buyer", "seller", "buy-side", "sell-side")
_COUNT_KEYWORDS = ("how many", "count", "number of")
_STATUS_KEYWORDS = ("status", "approved", "pending", "submitted", "state", "accepted")
_NEGOTIATION_KEYWORDS = ("negotiat", "concession", "haggling", "counter")


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def _answer_money(context: DealIntelligenceContext) -> tuple[str, list[str]]:
    deal = context.deal
    values = [
        ("deal notional", deal.notional_amount, deal.currency),
    ]
    if deal.settled_amount:
        values.append(("settled amount", deal.settled_amount, deal.currency))
    live = [
        o
        for o in context.offers
        if o.status in ("SUBMITTED", "COUNTERED", "ACCEPTED")
    ]
    if live:
        latest = sorted(
            live, key=lambda o: (o.submitted_at or o.created_at, o.created_at)
        )[-1]
        values.append(("latest offer amount", latest.amount, latest.currency))
    lines = " ".join(
        f"{label}: {amount} {currency};" for label, amount, currency in values
    )
    evidence = [
        f"deal.notional={deal.notional_amount} {deal.currency}",
        f"offers_count={len(live)}",
    ]
    return lines, evidence


def _answer_date(context: DealIntelligenceContext) -> tuple[str, list[str]]:
    deal = context.deal
    parts = []
    evidence = []
    if deal.settlement_date is not None:
        parts.append(
            f"settlement date {deal.settlement_date.date().isoformat()}"
        )
        evidence.append(f"deal.settlement_date={deal.settlement_date.isoformat()}")
    if deal.expires_at is not None:
        parts.append(f"expires {deal.expires_at.date().isoformat()}")
        evidence.append(f"deal.expires_at={deal.expires_at.isoformat()}")
    if not parts:
        return "No schedule dates are set on the deal.", evidence
    return "Key dates: " + "; ".join(parts) + ".", evidence


def _answer_parties(context: DealIntelligenceContext) -> tuple[str, list[str]]:
    org_ids = {
        o.created_by_organization_id
        for o in context.offers
        if o.created_by_organization_id
    }
    org_ids.update(
        o.recipient_organization_id for o in context.offers if o.recipient_organization_id
    )
    if context.negotiation_events:
        org_ids.update(
            e.actor_organization_id
            for e in context.negotiation_events
            if e.actor_organization_id
        )
    viewer = context.viewer_organization_id
    parties = sorted(org_ids) if org_ids else [viewer]
    return (
        f"Parties visible in context: viewer={viewer}; "
        + ", ".join(parties)
        + ".",
        [f"viewer_organization_id={viewer}", f"parties={parties}"],
    )


def _answer_side(context: DealIntelligenceContext) -> tuple[str, list[str]]:
    viewer = context.viewer_organization_id
    owner = context.organization_id or viewer
    side = "buyer" if viewer == owner else "seller"
    return (
        f"From the viewer's perspective ({viewer}) this is the {side} side "
        f"(viewer organization).",
        [f"viewer={viewer}", f"owner={owner}"],
    )


def _answer_count(context: DealIntelligenceContext) -> tuple[str, list[str]]:
    counts = {
        "offers": len(context.offers),
        "documents": len(context.documents),
        "requirements": len(context.requirements),
    }
    return (
        "Counts: " + ", ".join(f"{k}={v}" for k, v in counts.items()) + ".",
        [f"counts={counts}"],
    )


def _answer_status(context: DealIntelligenceContext) -> tuple[str, list[str]]:
    marks = [
        f"deal={context.deal.status}",
        f"offers=[{', '.join(o.status for o in context.offers)}]",
        f"documents=[{', '.join(d.status for d in context.documents)}]",
        f"requirements=[{', '.join(r.status for r in context.requirements)}]",
    ]
    return "Statuses: " + "; ".join(marks) + ".", marks


def _answer_negotiation(context: DealIntelligenceContext) -> tuple[str, list[str]]:
    ones = [
        (o.id, o.status, o.amount, o.currency)
        for o in context.offers
    ]
    evidence = [
        f"offers_total={len(context.offers)}",
        f"negotiation_events={len(context.negotiation_events)}",
    ]
    if not ones:
        return "Negotiation history is empty.", evidence
    return (
        "Offers: "
        + "; ".join(
            f"{oid}({status}, {amount or 'n/a'} {currency or 'n/a'})"
            for oid, status, amount, currency in ones
        )
        + ".",
        evidence,
    )


_QUERY_FUNC = {
    "money": _answer_money,
    "dates": _answer_date,
    "parties": _answer_parties,
    "side": _answer_side,
    "count": _answer_count,
    "statuses": _answer_status,
    "negotiation": _answer_negotiation,
}


def _mode_for(question: str) -> Optional[str]:
    q = _normalize(question)
    if any(k in q for k in _AMOUNT_KEYWORDS):
        return "money"
    if any(k in q for k in _SIDE_KEYWORDS):
        return "side"
    if any(k in q for k in _DATE_KEYWORDS):
        return "dates"
    if any(k in q for k in _PARTIES_KEYWORDS):
        return "parties"
    if any(k in q for k in _COUNT_KEYWORDS):
        return "count"
    if any(k in q for k in _NEGOTIATION_KEYWORDS):
        return "negotiation"
    if any(k in q for k in _STATUS_KEYWORDS):
        return "statuses"
    return None


def answer_question(
    context: DealIntelligenceContext,
    question: str,
    provider: ModelProvider,
) -> QueryAnswer:
    mode = _mode_for(question)
    if mode is None:
        return provider.answer_question(
            context,
            question,
            deterministic_answer=(
                "This question is outside the scope of the deal-intelligence "
                "advisory tool. I can only answer about the current deal's "
                "amounts, dates, parties, counts, statuses, and negotiation "
                "history."
            ),
            evidence=[],
            within_scope=False,
            confidence=0.0,
        )
    answer_text, evidence = _QUERY_FUNC[mode](context)
    return provider.answer_question(
        context,
        question,
        deterministic_answer=answer_text,
        evidence=evidence,
        within_scope=True,
        confidence=0.8,
    )