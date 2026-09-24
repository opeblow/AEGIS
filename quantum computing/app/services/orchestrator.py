from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

from app.core.config import settings
from app.core.errors import (
    InputTooLargeError,
    InvalidProblemError,
    ProblemNotFoundError,
    SolverUnavailableError,
)
from app.formulations.qubo import QUBOInstance, build_qubo
from app.problems.route_problem import feasibility_violations
from app.schemas.output import ComparisonResponse, ProblemRecord, QUBOFormulation, SolverResult
from app.schemas.problem import TransactionRouteProblem
from app.services.store import ProblemStore
from app.solvers.registry import SolverRegistry


@dataclass(frozen=True)
class PreparedProblem:
    problem: TransactionRouteProblem
    problem_id: str
    instance: QUBOInstance


class OptimizationService:
    def __init__(
        self,
        store: ProblemStore | None = None,
        registry: SolverRegistry | None = None,
    ) -> None:
        self.store = store or ProblemStore()
        self.registry = registry or SolverRegistry()

    def formulate(self, problem: TransactionRouteProblem) -> QUBOFormulation:
        prepared = self._prepare(problem)
        self.store.put(prepared.problem)
        return prepared.instance.formulation

    def optimize(
        self,
        problem: TransactionRouteProblem,
        solver_name: str | None = None,
    ) -> SolverResult:
        prepared = self._prepare(problem)
        self.store.put(prepared.problem)
        name = solver_name or settings().solver
        result = self._solve(prepared, name)
        self.store.put_result(prepared.problem_id, result)
        return result

    def compare(
        self,
        problem: TransactionRouteProblem,
        quantum_solver: str | None = None,
    ) -> ComparisonResponse:
        prepared = self._prepare(problem)
        self.store.put(prepared.problem)
        classical = self._solve(prepared, "classical")
        quantum_name = quantum_solver or "simulator"
        quantum = self._solve(prepared, quantum_name)
        self.store.put_result(prepared.problem_id, quantum)
        delta = quantum.objective_value - classical.objective_value
        better = self._better_solver(classical, quantum)
        if classical.feasible != quantum.feasible:
            claim = "Feasibility differs; the result is not evidence of quantum advantage."
        elif classical.objective_value == quantum.objective_value:
            claim = "Both solvers returned the same observed objective; no advantage is claimed."
        else:
            claim = "Observed solver results differ; no general performance claim is made."
        return ComparisonResponse(
            problem_id=prepared.problem_id,
            classical=classical,
            quantum=quantum,
            objective_delta=delta,
            better_solver=better,
            same_feasibility=classical.feasible == quantum.feasible,
            claim=claim,
        )

    def get_problem(self, problem_id: str) -> ProblemRecord:
        problem = self.store.get(problem_id)
        if problem is None:
            raise ProblemNotFoundError(problem_id)
        return ProblemRecord(
            problem_id=problem_id,
            problem=problem,
            latest_result=self.store.get_result(problem_id),
        )

    def _prepare(self, problem: TransactionRouteProblem) -> PreparedProblem:
        self._assert_boundary(problem)
        instance = build_qubo(problem)
        maximum = settings().max_variables
        actual = instance.formulation.metadata.num_binary_variables
        if actual > maximum:
            raise InvalidProblemError(
                f"QUBO has {actual} binary variables; the configured limit is {maximum}."
            )
        problem_id = self.store.put(problem)
        instance.formulation.problem_id = problem_id
        return PreparedProblem(problem=problem, problem_id=problem_id, instance=instance)

    def _solve(self, prepared: PreparedProblem, solver_name: str) -> SolverResult:
        try:
            return self.registry.solve(
                prepared.problem,
                prepared.instance,
                solver_name,
            )
        except KeyError as exc:
            raise SolverUnavailableError(solver_name) from exc

    @staticmethod
    def _better_solver(
        classical: SolverResult,
        quantum: SolverResult,
    ) -> Literal["classical", "quantum", "tie", "not_comparable"]:
        if not classical.feasible or not quantum.feasible:
            if classical.feasible != quantum.feasible:
                return "classical" if classical.feasible else "quantum"
            return "not_comparable"
        if quantum.objective_value < classical.objective_value:
            return "quantum"
        if classical.objective_value < quantum.objective_value:
            return "classical"
        return "tie"

    @staticmethod
    def _assert_boundary(problem: TransactionRouteProblem) -> None:
        cfg = settings()
        raw = problem.model_dump_json().encode("utf-8")
        if len(raw) > cfg.max_problem_bytes:
            raise InputTooLargeError(cfg.max_problem_bytes)


def compare_results(
    classical: SolverResult,
    quantum: SolverResult,
) -> tuple[Decimal | None, str, bool]:
    delta = quantum.objective_value - classical.objective_value
    if not classical.feasible or not quantum.feasible:
        if classical.feasible != quantum.feasible:
            return delta, "classical" if classical.feasible else "quantum", False
        return delta, "not_comparable", classical.feasible == quantum.feasible
    if quantum.objective_value < classical.objective_value:
        return delta, "quantum", True
    if classical.objective_value < quantum.objective_value:
        return delta, "classical", True
    return delta, "tie", True


def result_is_feasible(problem: TransactionRouteProblem, result: SolverResult) -> bool:
    return result.feasible and not feasibility_violations(problem, _selection_from_result(result))


def _selection_from_result(result: SolverResult):
    from app.problems.route_problem import Selection

    indices = tuple(
        index
        for index, value in result.selected_variables.items()
        if value == 1 and index.startswith("x") and index[1:].isdigit()
    )
    return Selection(tuple(sorted(int(index[1:]) for index in indices)))
