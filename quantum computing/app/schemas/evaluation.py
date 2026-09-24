from __future__ import annotations

from typing import Any

from pydantic import Field

from app.schemas.problem import StrictModel, TransactionRouteProblem


class EvaluationCase(StrictModel):
    name: str = Field(min_length=1, max_length=128)
    problem: TransactionRouteProblem
    expected_feasible: bool | None = None


class EvaluationRequest(StrictModel):
    cases: list[EvaluationCase] = Field(default_factory=list, max_length=100)
    invalid_cases: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    include_builtins: bool = True


class EvaluationCaseResult(StrictModel):
    name: str
    status: str
    classical_solver: str | None = None
    quantum_solver: str | None = None
    classical_feasible: bool | None = None
    quantum_feasible: bool | None = None
    classical_objective: str | None = None
    quantum_objective: str | None = None
    classical_selected_routes: list[str] | None = None
    quantum_selected_routes: list[str] | None = None
    classical_constraint_violations: list[str] | None = None
    quantum_constraint_violations: list[str] | None = None
    classical_runtime_ms: float | None = None
    quantum_runtime_ms: float | None = None
    runtime_ms: float | None = None
    error: str | None = None


class EvaluationReport(StrictModel):
    total: int
    passed: int
    failed: int
    reproducible: bool
    seed: int
    cases: list[EvaluationCaseResult] = Field(default_factory=list)
    failures: list[str] = Field(default_factory=list)
