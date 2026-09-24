from __future__ import annotations

from app.formulations.qubo import build_qubo
from app.schemas.problem import TransactionRouteProblem
from app.solvers.classical import ClassicalSolver


def sample_problem() -> TransactionRouteProblem:
    return TransactionRouteProblem(
        transaction_amount=100,
        routes=[
            {
                "id": "a",
                "cost": 3,
                "risk": 0.05,
                "liquidity": 100,
                "capacity": 100,
                "available": True,
            },
            {
                "id": "b",
                "cost": 7,
                "risk": 0.1,
                "liquidity": 100,
                "capacity": 100,
                "available": True,
            },
        ],
        constraints={"min_selected_routes": 1, "max_selected_routes": 2},
    )


def test_classical_solver_returns_feasible_selection() -> None:
    problem = sample_problem()
    instance = build_qubo(problem)
    result = ClassicalSolver().solve(problem, instance)
    assert result.feasible is True
    assert result.selected_routes
