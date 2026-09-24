from __future__ import annotations

from app.evaluation.runner import evaluate
from app.schemas.evaluation import EvaluationRequest


def test_built_in_evaluation_is_reproducible() -> None:
    first = evaluate(EvaluationRequest(include_builtins=True))
    second = evaluate(EvaluationRequest(include_builtins=True))
    assert first.total == 9
    assert first.passed == 9
    assert first.failed == 0
    assert first.reproducible is True
    assert [case.name for case in first.cases] == [case.name for case in second.cases]


def test_invalid_evaluation_cases_are_rejected() -> None:
    report = evaluate(
        EvaluationRequest(
            include_builtins=False,
            invalid_cases=[
                {
                    "transaction_amount": 100,
                    "routes": [],
                }
            ],
        )
    )
    assert report.total == 1
    assert report.passed == 1
    assert report.failed == 0
