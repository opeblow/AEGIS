import pytest

from app.pipelines.orchestrator import analyze
from app.services.compare import compare_offers


def test_compare_two_offers(canonical_context):
    comparison = compare_offers(canonical_context)
    assert comparison is not None
    assert comparison.compared_offers == ["offer-1", "offer-2"]
    price = next(e for e in comparison.entries if e.field == "price")
    assert price.before == "1400000"
    assert price.after == "1550000"
    assert price.absolute_difference == "150000"
    assert price.relative_difference_percent == pytest.approx(10.71428, abs=0.001)
    assert price.favorable_to == "seller"
    assert "USD" in comparison.summary


def test_compare_single_offer():
    from tests.conftest import make_context

    ctx = make_context(offers=1)
    comparison = compare_offers(ctx)
    assert comparison is not None
    assert comparison.compared_offers == ["offer-1"]


def test_compare_no_offers():
    from tests.conftest import make_context

    ctx = make_context(offers=0)
    assert compare_offers(ctx) is None


def test_image_field_never_a_float(canonical_context):
    comparison = compare_offers(canonical_context)
    for entry in comparison.entries:
        if entry.absolute_difference is not None:
            assert not isinstance(entry.absolute_difference, float)


def test_analysis_includes_comparison(canonical_context):
    result = analyze(canonical_context)
    assert result.offer_comparison is not None
    assert result.offer_comparison.compared_offers == ["offer-1", "offer-2"]