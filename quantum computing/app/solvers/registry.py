from __future__ import annotations

from app.core.config import settings
from app.formulations.qubo import QUBOInstance
from app.schemas.output import SolverResult
from app.schemas.problem import TransactionRouteProblem
from app.solvers.classical import ClassicalSolver
from app.solvers.quantum_simulator import QuantumSimulatorSolver


class SolverRegistry:
    def __init__(self) -> None:
        cfg = settings()
        self._solvers = {
            "classical": ClassicalSolver(),
            "simulator": QuantumSimulatorSolver(
                layers=cfg.qaoa_layers,
                angle_grid=cfg.qaoa_angle_grid,
                shots=cfg.qaoa_shots,
                seed=cfg.random_seed,
            ),
        }

    def get(self, name: str):
        return self._solvers[name]

    def solve(
        self,
        problem: TransactionRouteProblem,
        instance: QUBOInstance,
        name: str,
    ) -> SolverResult:
        return self.get(name).solve(problem, instance)
