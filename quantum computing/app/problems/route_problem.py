from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from app.schemas.problem import TransactionRouteProblem


@dataclass(frozen=True)
class Selection:
    indices: tuple[int, ...]

    @property
    def is_empty(self) -> bool:
        return not self.indices


def selection_from_mask(problem: TransactionRouteProblem, mask: int) -> Selection:
    indices = tuple(i for i in range(len(problem.routes)) if mask & (1 << i))
    return Selection(indices)


def selected_ids(problem: TransactionRouteProblem, selection: Selection) -> list[str]:
    return [problem.routes[i].id for i in selection.indices]


def objective_value(problem: TransactionRouteProblem, selection: Selection) -> Decimal:
    weights = problem.objective_weights
    total = Decimal("0")
    for index in selection.indices:
        route = problem.routes[index]
        total += weights.cost * route.cost
        total += weights.risk * problem.transaction_amount * route.risk
        total += weights.selection
    return total


def feasibility_violations(problem: TransactionRouteProblem, selection: Selection) -> list[str]:
    routes = problem.routes
    selected = [routes[i] for i in selection.indices]
    constraints = problem.constraints
    violations: list[str] = []

    count = len(selected)
    if count < constraints.min_selected_routes:
        violations.append("min_selected_routes")
    if constraints.max_selected_routes is not None and count > constraints.max_selected_routes:
        violations.append("max_selected_routes")

    selected_ids_set = {route.id for route in selected}
    missing_required = sorted(set(constraints.required_route_ids) - selected_ids_set)
    if missing_required:
        violations.append("required_routes_missing:" + ",".join(missing_required))

    unavailable = sorted(route.id for route in selected if not route.available)
    if unavailable:
        violations.append("unavailable_routes_selected:" + ",".join(unavailable))

    total_capacity = sum((route.capacity for route in selected), Decimal("0"))
    if total_capacity < problem.transaction_amount:
        violations.append("capacity")
    total_liquidity = sum((route.liquidity for route in selected), Decimal("0"))
    if total_liquidity < problem.transaction_amount:
        violations.append("liquidity")
    allocatable = sum((min(route.capacity, route.liquidity) for route in selected), Decimal("0"))
    if allocatable < problem.transaction_amount:
        violations.append("allocatable_capacity_liquidity")

    total_cost = sum((route.cost for route in selected), Decimal("0"))
    if constraints.max_cost is not None and total_cost > constraints.max_cost:
        violations.append("max_cost")

    if selected and constraints.max_risk is not None:
        weighted_risk = sum((route.risk * route.capacity for route in selected), Decimal("0"))
        average_risk = weighted_risk / total_capacity
        if average_risk > constraints.max_risk:
            violations.append("max_risk")
    return violations


def is_feasible(problem: TransactionRouteProblem, selection: Selection) -> bool:
    return not feasibility_violations(problem, selection)


def allocate_amount(
    problem: TransactionRouteProblem, selection: Selection
) -> list[tuple[int, Decimal]]:
    remaining = problem.transaction_amount
    allocations: list[tuple[int, Decimal]] = []
    for index in selection.indices:
        route = problem.routes[index]
        amount = min(remaining, route.capacity, route.liquidity)
        if amount > 0:
            allocations.append((index, amount))
            remaining -= amount
        if remaining == 0:
            break
    if remaining > 0:
        raise ValueError("selection cannot cover transaction amount")
    return allocations


def selection_sort_key(problem: TransactionRouteProblem, selection: Selection) -> tuple[str, ...]:
    return tuple(sorted(selected_ids(problem, selection)))


def all_selections(route_count: int) -> Iterable[Selection]:
    for mask in range(1 << route_count):
        yield selection_from_mask_type(route_count, mask)


def selection_from_mask_type(route_count: int, mask: int) -> Selection:
    return Selection(tuple(i for i in range(route_count) if mask & (1 << i)))
