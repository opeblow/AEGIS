from app.services.risk import detect_risk_blockers


def test_blockers_none_for_clean_canonical(canonical_context):
    signals = detect_risk_blockers(canonical_context)
    assert signals.blockers == []
    # A pending FIN_TRACE approval is overdue only when the due date passes;
    # in the fixture it is in the future, so no overdue flag.
    assert all(r.requires_review is False or r.category != "approval" for r in signals.risk_flags)


def test_negative_notional_is_blocker():
    from tests.conftest import make_context

    ctx = make_context()
    ctx.deal.notional_amount = "-500000.00"
    signals = detect_risk_blockers(ctx)
    assert any(b.category == "data_quality" for b in signals.blockers)


def test_money_conflict_raises_risk():
    from tests.conftest import make_context

    ctx = make_context()
    ctx.offers[1].amount = "9999999.99"
    ctx.offers[1].price = "9999999.99"
    signals = detect_risk_blockers(ctx)
    assert any(r.category == "conflicts" for r in signals.risk_flags)


def test_overdue_approval_flagged():
    from datetime import datetime, timedelta, timezone
    from tests.conftest import make_context

    ctx = make_context()
    if ctx.approval:
        req = ctx.approval.requests[1]
        req.status = "PENDING"
        req.due_at = datetime.now(timezone.utc) - timedelta(days=1)
    signals = detect_risk_blockers(ctx)
    assert any(r.category == "approval" and r.severity == "high" for r in signals.risk_flags)


def test_reconciliation_mismatch_surfaces():
    from tests.conftest import make_context

    ctx = make_context()
    if ctx.reconciliation:
        ctx.reconciliation.mismatch_reason = "Expected 1550000 got 1500000"
    signals = detect_risk_blockers(ctx)
    assert any(r.category == "reconciliation" for r in signals.risk_flags)