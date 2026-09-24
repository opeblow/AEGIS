from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import Field

from app.schemas.problem import StrictModel, TransactionRouteProblem


class QUBOVariable(StrictModel):
    name: str
    kind: Literal["route", "slack"]
    index: int
    route_id: str | None = None


class QUBOTerm(StrictModel):
    term_type: Literal["linear", "quadratic", "constant"]
    variables: list[str] = Field(default_factory=list)
    coefficient: Decimal
    description: str


class FormulationMetadata(StrictModel):
    formulation_type: Literal["QUBO"]
    num_binary_variables: int
    num_route_variables: int
    num_slack_variables: int
    num_constraints: int
    precision_scale: int
    penalty_coefficient: Decimal
    constraint_encoding: str = "bounded binary slack registers"


class QUBOFormulation(StrictModel):
    problem_id: str
    formulation_type: Literal["QUBO"] = "QUBO"
    variables: list[QUBOVariable]
    linear: dict[str, Decimal]
    quadratic: dict[str, Decimal]
    offset: Decimal
    objective_terms: list[QUBOTerm]
    penalty_terms: list[QUBOTerm]
    metadata: FormulationMetadata
    ising: dict[str, object]


class RouteAllocation(StrictModel):
    route_id: str
    amount: Decimal


class ExecutionMetadata(StrictModel):
    backend: str
    algorithm: str
    deterministic: bool
    seed: int | None = None
    shots: int | None = None
    layers: int | None = None
    statevector_variables: int | None = None
    fallback: str | None = None
    provider: str | None = None
    hardware_backend: str | None = None
    execution_date: str | None = None
    qubits: int | None = None
    note: str | None = None


class SolverResult(StrictModel):
    problem_id: str
    solver_type: str
    feasible: bool
    selected_variables: dict[str, int]
    selected_routes: list[str]
    allocations: list[RouteAllocation]
    objective_value: Decimal
    energy: float
    constraint_violations: list[str]
    formulation_metadata: FormulationMetadata
    execution_metadata: ExecutionMetadata
    confidence: float | None = None


class ClassicalResult(SolverResult):
    pass


class QuantumResult(SolverResult):
    pass


class ComparisonResponse(StrictModel):
    problem_id: str
    classical: SolverResult
    quantum: SolverResult
    objective_delta: Decimal | None
    better_solver: Literal["classical", "quantum", "tie", "not_comparable"]
    same_feasibility: bool
    claim: str


class ProblemRecord(StrictModel):
    problem_id: str
    problem: TransactionRouteProblem
    latest_result: SolverResult | None = None


class HealthResponse(StrictModel):
    status: Literal["ok", "degraded"]
    service: str
    environment: str
    version: str
    configured_solver: str
    credential_configured: bool


class ReadyResponse(StrictModel):
    status: Literal["ready", "not_ready"]
    service: str
    solver: str
    local_simulation_available: bool
    real_hardware_configured: bool


class ErrorDetail(StrictModel):
    code: str
    message: str
    request_id: str | None = None
    details: object | None = None


class ErrorResponse(StrictModel):
    error: ErrorDetail
