from __future__ import annotations

from time import perf_counter
from typing import cast

from pydantic import ValidationError

from app.schemas.evaluation import (
    EvaluationCase,
    EvaluationCaseResult,
    EvaluationReport,
    EvaluationRequest,
)
from app.schemas.problem import TransactionRouteProblem
from app.services.orchestrator import OptimizationService
from app.solvers.quantum_simulator import QuantumSimulatorSolver


def _problem(**values: object) -> TransactionRouteProblem:
    return TransactionRouteProblem.model_validate(values)


def built_in_cases() -> list[EvaluationCase]:
    return [
        EvaluationCase(
            name="small-deterministic",
            expected_feasible=True,
            problem=_problem(
                transaction_amount=100,
                routes=[
                    {
                        "id": "small-a",
                        "cost": 10,
                        "risk": 0.05,
                        "liquidity": 100,
                        "capacity": 100,
                        "available": True,
                    }
                ],
                constraints={"min_selected_routes": 1},
            ),
        ),
        EvaluationCase(
            name="multiple-route",
            expected_feasible=True,
            problem=_problem(
                transaction_amount=150,
                routes=[
                    {
                        "id": "multi-a",
                        "cost": 8,
                        "risk": 0.04,
                        "liquidity": 100,
                        "capacity": 100,
                        "available": True,
                    },
                    {
                        "id": "multi-b",
                        "cost": 12,
                        "risk": 0.06,
                        "liquidity": 100,
                        "capacity": 100,
                        "available": True,
                    },
                ],
                constraints={"min_selected_routes": 2, "max_selected_routes": 2},
            ),
        ),
        EvaluationCase(
            name="capacity-constrained",
            expected_feasible=True,
            problem=_problem(
                transaction_amount=180,
                routes=[
                    {
                        "id": "capacity-a",
                        "cost": 5,
                        "risk": 0.03,
                        "liquidity": 100,
                        "capacity": 100,
                        "available": True,
                    },
                    {
                        "id": "capacity-b",
                        "cost": 7,
                        "risk": 0.04,
                        "liquidity": 100,
                        "capacity": 100,
                        "available": True,
                    },
                    {
                        "id": "capacity-c",
                        "cost": 20,
                        "risk": 0.02,
                        "liquidity": 50,
                        "capacity": 50,
                        "available": True,
                    },
                ],
                constraints={"min_selected_routes": 3, "max_selected_routes": 3},
            ),
        ),
        EvaluationCase(
            name="risk-constrained",
            expected_feasible=True,
            problem=_problem(
                transaction_amount=100,
                routes=[
                    {
                        "id": "risk-low",
                        "cost": 12,
                        "risk": 0.05,
                        "liquidity": 50,
                        "capacity": 50,
                        "available": True,
                    },
                    {
                        "id": "risk-high",
                        "cost": 4,
                        "risk": 0.20,
                        "liquidity": 50,
                        "capacity": 50,
                        "available": True,
                    },
                ],
                constraints={
                    "min_selected_routes": 2,
                    "max_selected_routes": 2,
                    "max_risk": 0.15,
                },
            ),
        ),
        EvaluationCase(
            name="infeasible-capacity",
            expected_feasible=False,
            problem=_problem(
                transaction_amount=100,
                routes=[
                    {
                        "id": "infeasible-a",
                        "cost": 1,
                        "risk": 0.01,
                        "liquidity": 50,
                        "capacity": 50,
                        "available": True,
                    }
                ],
                constraints={"min_selected_routes": 1},
            ),
        ),
        EvaluationCase(
            name="larger-optimization",
            expected_feasible=True,
            problem=_problem(
                transaction_amount=10,
                routes=[
                    {
                        "id": f"large-{index}",
                        "cost": index + 1,
                        "risk": 0.01 * (index + 1),
                        "liquidity": 1,
                        "capacity": 1,
                        "available": True,
                    }
                    for index in range(10)
                ],
                constraints={"min_selected_routes": 10, "max_selected_routes": 10},
            ),
        ),
    ]


def built_in_invalid_cases() -> list[dict[str, object]]:
    return [
        {
            "transaction_amount": 100,
            "routes": [
                {
                    "id": "duplicate",
                    "cost": 1,
                    "risk": 0.1,
                    "liquidity": 100,
                    "capacity": 100,
                    "available": True,
                },
                {
                    "id": "duplicate",
                    "cost": 2,
                    "risk": 0.1,
                    "liquidity": 100,
                    "capacity": 100,
                    "available": True,
                },
            ],
        },
        {
            "transaction_amount": 100,
            "routes": [
                {
                    "id": "invalid",
                    "cost": 1,
                    "risk": 0.1,
                    "liquidity": 100,
                    "capacity": 100,
                    "available": True,
                }
            ],
            "unknown_field": True,
        },
        {
            "transaction_amount": -1,
            "routes": [
                {
                    "id": "invalid-amount",
                    "cost": 1,
                    "risk": 0.1,
                    "liquidity": 100,
                    "capacity": 100,
                    "available": True,
                }
            ],
        },
    ]


def evaluate(
    request: EvaluationRequest,
    service: OptimizationService | None = None,
) -> EvaluationReport:
    optimizer = service or OptimizationService()
    cases = list(request.cases)
    invalid_cases = list(request.invalid_cases)
    if request.include_builtins:
        cases = built_in_cases() + cases
        invalid_cases = built_in_invalid_cases() + invalid_cases

    report = EvaluationReport(
        total=len(cases) + len(invalid_cases),
        passed=0,
        failed=0,
        reproducible=True,
        seed=cast(QuantumSimulatorSolver, optimizer.registry._solvers["simulator"]).seed,
    )
    for case in cases:
        result = _evaluate_valid_case(optimizer, case)
        report.cases.append(result)
        if result.status == "passed":
            report.passed += 1
        else:
            report.failed += 1
            report.failures.append(f"[{case.name}] {result.error}")

    for index, payload in enumerate(invalid_cases):
        result = _evaluate_invalid_case(payload, index)
        report.cases.append(result)
        if result.status == "passed":
            report.passed += 1
        else:
            report.failed += 1
            report.failures.append(f"[invalid-case-{index}] {result.error}")

    report.reproducible = all(case.status == "passed" for case in report.cases)
    return report


def _evaluate_valid_case(
    optimizer: OptimizationService,
    case: EvaluationCase,
) -> EvaluationCaseResult:
    started = perf_counter()
    try:
        first = optimizer.compare(case.problem)
        second = optimizer.compare(case.problem)
        runtime_ms = (perf_counter() - started) * 1000
        stable = _stable(first) == _stable(second)
        expected = case.expected_feasible
        feasibility_matches = expected is None or (
            first.classical.feasible == expected and first.quantum.feasible == expected
        )
        passed = stable and feasibility_matches
        error = None if passed else "non-reproducible or unexpected feasibility result"
        return EvaluationCaseResult(
            name=case.name,
            status="passed" if passed else "failed",
            classical_solver=first.classical.solver_type,
            quantum_solver=first.quantum.solver_type,
            classical_feasible=first.classical.feasible,
            quantum_feasible=first.quantum.feasible,
            classical_objective=str(first.classical.objective_value),
            quantum_objective=str(first.quantum.objective_value),
            classical_selected_routes=first.classical.selected_routes,
            quantum_selected_routes=first.quantum.selected_routes,
            classical_constraint_violations=first.classical.constraint_violations,
            quantum_constraint_violations=first.quantum.constraint_violations,
            classical_runtime_ms=runtime_ms / 2,
            quantum_runtime_ms=runtime_ms / 2,
            runtime_ms=runtime_ms,
            error=error,
        )
    except Exception as exc:
        return EvaluationCaseResult(
            name=case.name,
            status="failed",
            runtime_ms=(perf_counter() - started) * 1000,
            error=f"{type(exc).__name__}: {exc}",
        )


def _evaluate_invalid_case(
    payload: dict[str, object],
    index: int,
) -> EvaluationCaseResult:
    started = perf_counter()
    try:
        TransactionRouteProblem.model_validate(payload)
    except ValidationError:
        return EvaluationCaseResult(
            name=f"invalid-case-{index}",
            status="passed",
            runtime_ms=(perf_counter() - started) * 1000,
        )
    except Exception as exc:
        return EvaluationCaseResult(
            name=f"invalid-case-{index}",
            status="failed",
            runtime_ms=(perf_counter() - started) * 1000,
            error=f"{type(exc).__name__}: {exc}",
        )
    return EvaluationCaseResult(
        name=f"invalid-case-{index}",
        status="failed",
        runtime_ms=(perf_counter() - started) * 1000,
        error="invalid payload was accepted",
    )


def _stable(comparison) -> tuple[object, ...]:
    return (
        tuple(comparison.classical.selected_routes),
        comparison.classical.objective_value,
        comparison.classical.feasible,
        tuple(comparison.quantum.selected_routes),
        comparison.quantum.objective_value,
        comparison.quantum.feasible,
    )
