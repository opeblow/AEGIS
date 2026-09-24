from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.schemas.problem import StrictModel, TransactionRouteProblem

SolverName = Literal["classical", "simulator", "real_hardware"]


class OptimizeRequest(StrictModel):
    problem: TransactionRouteProblem
    solver: SolverName | None = None


class FormulateRequest(StrictModel):
    problem: TransactionRouteProblem


class CompareRequest(StrictModel):
    problem: TransactionRouteProblem
    quantum_solver: SolverName | None = None


class ProblemIdRequest(StrictModel):
    problem_id: str = Field(min_length=1, max_length=128)
