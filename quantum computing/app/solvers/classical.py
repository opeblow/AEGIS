from __future__ import annotations

from app.formulations.qubo import QUBOInstance
from app.problems.route_problem import (
    Selection,
    allocate_amount,
    feasibility_violations,
    objective_value,
    selection_from_mask,
    selection_sort_key,
)
from app.schemas.output import ExecutionMetadata, SolverResult
from app.schemas.problem import TransactionRouteProblem


class ClassicalSolver:
    name = "classical"

    def __init__(self, exact_max_routes: int = 20, beam_width: int = 4096) -> None:
        self.exact_max_routes = exact_max_routes
        self.beam_width = beam_width

    def solve(self, problem: TransactionRouteProblem, instance: QUBOInstance) -> SolverResult:
        if len(problem.routes) <= self.exact_max_routes:
            best = self._exact(problem, instance)
            algorithm = "exhaustive binary enumeration"
            deterministic = True
        else:
            best = self._beam(problem, instance)
            algorithm = "deterministic beam search heuristic"
            deterministic = True
        selected = selection_from_mask(problem, best)
        violations = feasibility_violations(problem, selected)
        allocations: list = []
        if not violations:
            allocations = [
                {"route_id": problem.routes[index].id, "amount": amount}
                for index, amount in allocate_amount(problem, selected)
            ]
        selected_variables = {
            f"x{index}": 1 if index in selected.indices else 0
            for index in range(len(problem.routes))
        }
        return SolverResult(
            problem_id=problem.problem_id or "unassigned",
            solver_type="classical",
            feasible=not violations,
            selected_variables=selected_variables,
            selected_routes=[problem.routes[i].id for i in selected.indices],
            allocations=allocations,
            objective_value=objective_value(problem, selected),
            energy=float(instance.route_energy(selected.indices)),
            constraint_violations=violations,
            formulation_metadata=instance.formulation.metadata,
            execution_metadata=ExecutionMetadata(
                backend="local-cpu",
                algorithm=algorithm,
                deterministic=deterministic,
                note=(
                    "Classical baseline solves the same route-selection objective and constraints."
                ),
            ),
            confidence=1.0 if not violations else 0.0,
        )

    def _exact(self, problem: TransactionRouteProblem, instance: QUBOInstance) -> int:
        best_mask = 0
        best_key: tuple[object, ...] | None = None
        for mask in range(1 << len(problem.routes)):
            selection = selection_from_mask(problem, mask)
            violations = feasibility_violations(problem, selection)
            objective = objective_value(problem, selection)
            key = (
                0 if not violations else 1,
                len(violations),
                objective,
                selection_sort_key(problem, selection),
            )
            if best_key is None or key < best_key:
                best_mask = mask
                best_key = key
        return best_mask

    def _beam(self, problem: TransactionRouteProblem, instance: QUBOInstance) -> int:
        routes = problem.routes
        required = {
            index
            for index, route in enumerate(routes)
            if route.id in problem.constraints.required_route_ids
        }
        candidates = [Selection(tuple(sorted(required)))]
        order = sorted(
            range(len(routes)),
            key=lambda index: (
                0 if routes[index].available else 1,
                float(routes[index].cost + problem.transaction_amount * routes[index].risk),
                -float(routes[index].capacity),
                index,
            ),
        )
        for index in order:
            expanded = []
            for selection in candidates:
                if index not in selection.indices:
                    expanded.append(Selection(selection.indices + (index,)))
            candidates.extend(expanded)
            candidates = sorted(
                set(candidates),
                key=lambda selection: (
                    len(feasibility_violations(problem, selection)),
                    objective_value(problem, selection),
                    selection_sort_key(problem, selection),
                ),
            )[: self.beam_width]
        best = min(
            candidates,
            key=lambda selection: (
                0 if not feasibility_violations(problem, selection) else 1,
                len(feasibility_violations(problem, selection)),
                objective_value(problem, selection),
                selection_sort_key(problem, selection),
            ),
        )
        mask = sum(1 << index for index in best.indices)
        return mask
