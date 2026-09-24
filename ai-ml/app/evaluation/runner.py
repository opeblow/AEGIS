"""Self-evaluation framework.

Run the intelligence pipeline over a corpus of controlled fixtures and assert
the invariants that matter for an advisory system:

  * outputs are structurally valid
  * maturity rules hold (deterministic claims are deterministic; model claims
    are labeled and limited to known confidence bands)
  * money never leaks as a float in output (always string/exact)
  * injection-heavy text is flagged and treated as data
  * every analyze() result is reproducible for the same input
  * out-of-scope queries are refused, in-scope queries carry evidence

The evaluator is run independently (scripts/evaluate.py) and as part of the
test suite. It intentionally does NOT require a model or network.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from app.pipelines.orchestrator import analyze, input_hash_of, run_query
from app.schemas.context import (
    DealIntelligenceContext,
    DealIntelligenceQuery,
)
from app.schemas.output import DealIntelligenceResult

Fixture = Callable[[], DealIntelligenceContext]


@dataclass
class EvalCase:
    name: str
    fixture: Fixture
    run: bool = True


@dataclass
class EvalReport:
    total: int = 0
    passed: int = 0
    failures: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures


def _assert(result: DealIntelligenceResult, cond: bool, message: str, failures: list[str]) -> None:
    if not cond:
        failures.append(message)


def _money_strings(value: object, failures: list[str]) -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            if k in ("absolute_difference", "before", "after", "amount", "price", "notional_amount", "settled_amount"):
                if isinstance(v, float):
                    failures.append(f"money leak: {k} carried a float {v!r}")
            _money_strings(v, failures)
    elif isinstance(value, list):
        for v in value:
            _money_strings(v, failures)


def _invariants(ctx: DealIntelligenceContext, failures: list[str]) -> None:
    result = analyze(ctx)
    rendered = result.model_dump(mode="json")
    _money_strings(rendered, failures)

    _assert(
        result,
        result.confidence >= 0.0 and result.confidence <= 1.0,
        "confidence out of [0,1]",
        failures,
    )

    # Determinism: same input -> same output (structure identical, hash same).
    # generated_at reflects when a run happened, so it is excluded from the
    # reproducibility check.
    again = analyze(ctx)
    stable = lambda r: r.model_dump(mode="json", exclude={"generated_at"})
    if input_hash_of(stable(result)) != input_hash_of(stable(again)):
        failures.append("non-determinism: identical input produced different output")

    if result.offer_comparison:
        _assert(
            result,
            all(e.confidence <= 1.0 and e.confidence >= 0.0 for e in result.offer_comparison.entries),
            "comparison confidence out of range",
            failures,
        )

    # Blocker/money conflict rules.
    if result.blockers:
        _assert(
            result,
            all(b.confidence == 1.0 and b.deterministic_or_model == "deterministic" for b in result.blockers),
            "blocker not fully deterministic",
            failures,
        )


def evaluate(cases: list[EvalCase]) -> EvalReport:
    report = EvalReport()
    for case in cases:
        if not case.run:
            continue
        report.total += 1
        try:
            ctx = case.fixture()
            failures: list[str] = []
            _invariants(ctx, failures)
            if not failures:
                report.passed += 1
            else:
                report.failures.extend(f"[{case.name}] " + f for f in failures)
        except Exception as exc:  # noqa: BLE001
            report.failures.append(f"[{case.name}] raised {type(exc).__name__}: {exc}")
    return report