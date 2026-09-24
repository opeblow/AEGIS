from app.models.mock.provider import MockModelProvider
from app.services.negotiation import compute_negotiation_summary

PROVIDER = MockModelProvider()


def test_negotiation_summary_builds(canonical_context):
    summary = compute_negotiation_summary(canonical_context, PROVIDER)
    assert summary.major_concessions
    assert summary.timeline
    assert "1550000" in summary.latest_counterparty_position


def test_no_offers_gives_empty_negotiation():
    from tests.conftest import make_context

    ctx = make_context(offers=0)
    summary = compute_negotiation_summary(ctx, PROVIDER)
    assert summary.summary
    assert summary.major_concessions == []
    assert summary.timeline == []