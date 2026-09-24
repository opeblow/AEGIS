from __future__ import annotations

from decimal import Decimal

from app.formulations.qubo import build_qubo
from app.problems.route_problem import Selection, feasibility_violations, objective_value
from app.schemas.problem import TransactionRouteProblem


def problem() -> TransactionRouteProblem:
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


def test_qubo_construction_is_deterministic() -> None:
    first = build_qubo(problem())
    second = build_qubo(problem())
    assert first.formulation.model_dump(mode="json") == second.formulation.model_dump(mode="json")
    assert first.formulation.metadata.formulation_type == "QUBO"
    assert first.formulation.metadata.num_route_variables == 2


def test_qubo_energy_matches_objective_for_feasible_selection() -> None:
    instance = build_qubo(problem())
    selection = Selection((0,))
    energy = instance.route_energy(selection.indices)
    assert energy == Decimal("800")


def test_unavailable_route_is_reported_infeasible() -> None:
    value = problem()
    value.routes[0].available = False
    selection = Selection((0,))
    assert "unavailable_routes_selected:a" in feasibility_violations(value, selection)


def test_capacity_and_required_constraints_are_reported() -> None:
    value = TransactionRouteProblem(
        transaction_amount=100,
        routes=[
            {
                "id": "a",
                "cost": 1,
                "risk": 0.1,
                "liquidity": 50,
                "capacity": 50,
                "available": True,
            }
        ],
        constraints={"required_route_ids": ["a"], "min_selected_routes": 1},
    )
    violations = feasibility_violations(value, Selection((0,)))
    assert "capacity" in violations
    assert "allocatable_capacity_liquidity" in violations


def test_objective_calculation_is_consistent() -> None:
    value = problem()
    assert objective_value(value, Selection((0, 1))) == Decimal("25.00")
