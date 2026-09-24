from app.models.mock.provider import MockModelProvider
from app.services.readiness import compute_readiness_explanation

PROVIDER = MockModelProvider()


def test_readiness_counts(canonical_context):
    expl = compute_readiness_explanation(canonical_context, PROVIDER)
    assert expl.required == 2
    assert expl.satisfied == 1
    assert expl.outstanding == 1
    assert expl.blocked is True


def test_readiness_all_satisfied(canonical_context):
    from tests.conftest import make_context

    ctx = make_context()
    for r in ctx.requirements:
        if r.required:
            r.status = "SATISFIED"
    expl = compute_readiness_explanation(ctx, PROVIDER)
    assert expl.satisfied == 2
    assert expl.outstanding == 0
    assert expl.blocked is False


def test_no_requirements_is_not_a_blocker(canonical_context):
    from tests.conftest import make_context

    ctx = make_context()
    ctx.requirements = []
    expl = compute_readiness_explanation(ctx, PROVIDER)
    assert expl.required == 0
    assert expl.blocked is False