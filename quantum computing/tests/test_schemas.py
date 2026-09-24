from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.schemas.problem import TransactionRouteProblem


def route(route_id: str = "route-a", **changes: object) -> dict[str, object]:
    value: dict[str, object] = {
        "id": route_id,
        "cost": 1,
        "risk": 0.1,
        "liquidity": 100,
        "capacity": 100,
        "available": True,
    }
    value.update(changes)
    return value


def test_valid_problem_accepts_defaults() -> None:
    problem = TransactionRouteProblem(
        transaction_amount=100,
        routes=[route()],
    )
    assert problem.constraints.min_selected_routes == 1
    assert problem.objective_weights.cost == 1


@pytest.mark.parametrize(
    "payload",
    [
        {**{"transaction_amount": 100, "routes": [route()]}, "unknown": True},
        {"transaction_amount": 0, "routes": [route()]},
        {"transaction_amount": 100, "routes": []},
        {"transaction_amount": 100, "routes": [route(cost=-1)]},
        {"transaction_amount": 100, "routes": [route(risk=1.1)]},
        {"transaction_amount": 100, "routes": [route(liquidity=0)]},
        {"transaction_amount": 100, "routes": [route(capacity=0)]},
    ],
)
def test_invalid_problem_values_are_rejected(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        TransactionRouteProblem.model_validate(payload)


def test_duplicate_route_ids_are_rejected() -> None:
    with pytest.raises(ValidationError, match="route ids must be unique"):
        TransactionRouteProblem(
            transaction_amount=100,
            routes=[route("duplicate"), route("duplicate")],
        )


def test_required_route_must_exist() -> None:
    with pytest.raises(ValidationError, match="required route ids do not exist"):
        TransactionRouteProblem(
            transaction_amount=100,
            routes=[route()],
            constraints={"required_route_ids": ["missing"]},
        )


def test_selection_bounds_are_validated() -> None:
    with pytest.raises(ValidationError, match="max_selected_routes"):
        TransactionRouteProblem(
            transaction_amount=100,
            routes=[route(), route("route-b")],
            constraints={"min_selected_routes": 2, "max_selected_routes": 1},
        )
