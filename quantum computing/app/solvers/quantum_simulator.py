from __future__ import annotations

import math
import random
from decimal import Decimal
from itertools import combinations
from time import perf_counter

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


class QuantumSimulatorSolver:
    """Local statevector simulation with an explicit feasibility decoder.

    The circuit is a deterministic, fixed-grid QAOA-like simulation: a uniform
    superposition, a diagonal QUBO cost phase, and a transverse-field mixer.
    The decoder is deliberately classical and deterministic so infeasible
    samples can never be presented as valid financial recommendations.
    """

    name = "simulator"

    def __init__(
        self,
        *,
        layers: int = 1,
        angle_grid: int = 3,
        shots: int = 2048,
        seed: int = 1729,
        max_statevector_routes: int = 8,
    ) -> None:
        self.layers = layers
        self.angle_grid = angle_grid
        self.shots = shots
        self.seed = seed
        self.max_statevector_routes = max_statevector_routes

    def solve(self, problem: TransactionRouteProblem, instance: QUBOInstance) -> SolverResult:
        started = perf_counter()
        route_count = len(problem.routes)
        if route_count <= self.max_statevector_routes:
            candidates = self._qaoa_candidates(problem, instance)
            backend = "local-statevector"
            algorithm = "QAOA-like transverse-field circuit simulation"
            statevector_variables = route_count
            fallback = None
            solver_type = "quantum_simulation"
        else:
            candidates = self._deterministic_candidates(problem, instance)
            backend = "local-cpu"
            algorithm = "deterministic quantum-inspired route search"
            statevector_variables = None
            fallback = "statevector limit exceeded; no quantum circuit executed"
            solver_type = "quantum-inspired classical optimization"

        ranked = sorted(
            candidates,
            key=lambda selection: self._rank(problem, instance, selection),
        )
        selected = ranked[0]
        violations = feasibility_violations(problem, selected)
        allocations: list = []
        if not violations:
            allocations = [
                {"route_id": problem.routes[index].id, "amount": amount}
                for index, amount in allocate_amount(problem, selected)
            ]
        selected_variables = {
            f"x{index}": 1 if index in selected.indices else 0 for index in range(route_count)
        }
        elapsed_ms = (perf_counter() - started) * 1000
        return SolverResult(
            problem_id=problem.problem_id or "unassigned",
            solver_type=solver_type,
            feasible=not violations,
            selected_variables=selected_variables,
            selected_routes=[problem.routes[i].id for i in selected.indices],
            allocations=allocations,
            objective_value=objective_value(problem, selected),
            energy=float(instance.route_energy(selected.indices)),
            constraint_violations=violations,
            formulation_metadata=instance.formulation.metadata,
            execution_metadata=ExecutionMetadata(
                backend=backend,
                algorithm=algorithm,
                deterministic=True,
                seed=self.seed,
                shots=self.shots if fallback is None else None,
                layers=self.layers if fallback is None else None,
                statevector_variables=statevector_variables,
                fallback=fallback,
                note=(
                    "Local quantum simulation only; no quantum hardware was used. "
                    f"Runtime {elapsed_ms:.3f} ms; deterministic feasibility decoder applied."
                    if fallback is None
                    else "No quantum circuit was executed for this instance."
                ),
            ),
            confidence=1.0
            if not violations and fallback is None
            else (0.8 if not violations else 0.0),
        )

    @staticmethod
    def _rank(
        problem: TransactionRouteProblem,
        instance: QUBOInstance,
        selection: Selection,
    ) -> tuple[float, int, float, Decimal, tuple[str, ...]]:
        violations = feasibility_violations(problem, selection)
        return (
            0.0 if not violations else 1.0,
            len(violations),
            float(instance.route_energy(selection.indices)),
            objective_value(problem, selection),
            selection_sort_key(problem, selection),
        )

    def _qaoa_candidates(
        self, problem: TransactionRouteProblem, instance: QUBOInstance
    ) -> list[Selection]:
        route_count = len(problem.routes)
        state_count = 1 << route_count

        def basis_energy(mask: int) -> float:
            indices = tuple(i for i in range(route_count) if mask & (1 << i))
            return float(instance.route_energy(indices))

        energies = [basis_energy(mask) for mask in range(state_count)]
        baseline = min(energies)
        spread = max(1.0, max(abs(value - baseline) for value in energies))
        angles = [(layer + 1) * math.pi / (self.angle_grid + 1) for layer in range(self.angle_grid)]
        candidates: dict[int, Selection] = {}
        rng = random.Random(self.seed)

        for gamma in angles:
            for beta in angles:
                amplitudes = [complex(1 / math.sqrt(state_count))] * state_count
                for _ in range(self.layers):
                    for mask, energy in enumerate(energies):
                        phase = (energy - baseline) / spread
                        amplitudes[mask] *= complex(
                            math.cos(gamma * phase), -math.sin(gamma * phase)
                        )
                    amplitudes = self._apply_mixer(amplitudes, route_count, beta)

                probabilities = [max(0.0, abs(value) ** 2) for value in amplitudes]
                total = sum(probabilities) or 1.0
                probabilities = [value / total for value in probabilities]
                for _ in range(self.shots):
                    draw = rng.random()
                    cumulative = 0.0
                    mask = state_count - 1
                    for candidate_mask, probability in enumerate(probabilities):
                        cumulative += probability
                        if draw <= cumulative:
                            mask = candidate_mask
                            break
                    candidates[mask] = selection_from_mask(problem, mask)
                candidates[0] = selection_from_mask(problem, 0)
                candidates[state_count - 1] = selection_from_mask(problem, state_count - 1)

        # Small instances use an exhaustive decoder after simulation. This is
        # explicit classical post-processing, not a claim about the circuit.
        if route_count <= 8:
            for mask in range(state_count):
                candidates[mask] = selection_from_mask(problem, mask)
        for selection in self._deterministic_candidates(problem, instance):
            mask = sum(1 << index for index in selection.indices)
            candidates[mask] = selection
        return list(candidates.values())

    @staticmethod
    def _apply_mixer(amplitudes: list[complex], route_count: int, beta: float) -> list[complex]:
        mixed = list(amplitudes)
        cosine = math.cos(beta)
        sine = math.sin(beta)
        for qubit in range(route_count):
            step = 1 << qubit
            for base in range(0, len(mixed), step * 2):
                for left in range(base, base + step):
                    right = left + step
                    a = mixed[left]
                    b = mixed[right]
                    mixed[left] = cosine * a - 1j * sine * b
                    mixed[right] = cosine * b - 1j * sine * a
        return mixed

    def _deterministic_candidates(
        self, problem: TransactionRouteProblem, instance: QUBOInstance
    ) -> list[Selection]:
        routes = problem.routes
        required = {
            index
            for index, route in enumerate(routes)
            if route.id in problem.constraints.required_route_ids
        }
        candidates = {Selection(tuple(sorted(required))), Selection(())}
        for index in range(len(routes)):
            candidates.add(Selection((index,)))

        order = sorted(
            range(len(routes)),
            key=lambda index: (
                0 if routes[index].available else 1,
                float(routes[index].cost + problem.transaction_amount * routes[index].risk),
                -float(routes[index].capacity),
                index,
            ),
        )
        current = set(required)
        for index in order:
            current.add(index)
            candidates.add(Selection(tuple(sorted(current))))
        current = set(required)
        for index in reversed(order):
            current.add(index)
            candidates.add(Selection(tuple(sorted(current))))
        for size in range(2, min(4, len(routes)) + 1):
            for indices in combinations(order, size):
                candidates.add(Selection(tuple(sorted(indices))))
        return list(candidates)
