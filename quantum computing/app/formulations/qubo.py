from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from typing import Literal, cast

from app.schemas.output import (
    FormulationMetadata,
    QUBOFormulation,
    QUBOTerm,
    QUBOVariable,
)
from app.schemas.problem import TransactionRouteProblem

VariableKind = Literal["route", "slack"]
TermType = Literal["linear", "quadratic", "constant"]


@dataclass(frozen=True)
class ConstraintEncoding:
    name: str
    route_coefficients: dict[str, int]
    target: int
    slack_names: tuple[str, ...]
    slack_weights: tuple[int, ...]
    slack_sign: int
    slack_max: int
    penalty: int


@dataclass(frozen=True)
class QUBOInstance:
    formulation: QUBOFormulation
    route_variables: tuple[str, ...]
    route_indices: dict[str, int]
    constraints: tuple[ConstraintEncoding, ...]
    precision_scale: int
    penalty: int

    def energy(self, assignment: Mapping[str, int]) -> Decimal:
        value = self.formulation.offset
        for name, coefficient in self.formulation.linear.items():
            value += coefficient * int(assignment.get(name, 0))
        for key, coefficient in self.formulation.quadratic.items():
            left, right = key.split("*", 1)
            value += coefficient * int(assignment.get(left, 0)) * int(assignment.get(right, 0))
        return value

    def route_energy(self, selected: Iterable[int]) -> Decimal:
        selected_set = set(selected)
        assignment: dict[str, int] = {
            name: 1 if index in selected_set else 0
            for index, name in enumerate(self.route_variables)
        }
        for encoding in self.constraints:
            route_sum = sum(
                encoding.route_coefficients.get(name, 0)
                for name in self.route_variables
                if self.route_indices[name] in selected_set
            )
            desired = encoding.target - route_sum
            sign = int(encoding.slack_sign)
            slack_value = (
                min(max(desired, 0), encoding.slack_max)
                if sign > 0
                else min(max(-desired, 0), encoding.slack_max)
            )

            slack_assignment = _decode_slack(
                encoding.slack_names,
                encoding.slack_weights,
                encoding.slack_max,
                slack_value,
            )
            assignment.update(slack_assignment)
        return self.energy(assignment)


def _decimal_places(value: Decimal) -> int:
    exponent = int(value.as_tuple().exponent)
    return max(0, -exponent)


def _precision_scale(problem: TransactionRouteProblem) -> int:
    values: list[Decimal] = [
        problem.transaction_amount,
        problem.objective_weights.cost,
        problem.objective_weights.risk,
        problem.objective_weights.selection,
    ]
    values.extend(route.cost for route in problem.routes)
    values.extend(route.risk for route in problem.routes)
    values.extend(route.liquidity for route in problem.routes)
    values.extend(route.capacity for route in problem.routes)
    values.extend(problem.objective_weights.cost * route.cost for route in problem.routes)
    values.extend(
        problem.objective_weights.risk * problem.transaction_amount * route.risk
        for route in problem.routes
    )
    values.extend(problem.objective_weights.selection for _ in problem.routes)
    if problem.constraints.max_cost is not None:
        values.append(problem.constraints.max_cost)
    if problem.constraints.max_risk is not None:
        values.append(problem.constraints.max_risk)
        values.extend(
            (route.risk - problem.constraints.max_risk) * route.capacity for route in problem.routes
        )
    places = max((_decimal_places(value) for value in values), default=0)
    if places > 6:
        raise ValueError("financial values may contain at most 6 decimal places")
    return 10**places


def _units(value: Decimal, scale: int) -> int:
    quantum = Decimal(scale)
    return int((value * quantum).to_integral_value(rounding=ROUND_HALF_EVEN))


def _decode_slack(
    names: tuple[str, ...],
    weights: tuple[int, ...],
    max_value: int,
    desired: int,
) -> dict[str, int]:
    states: dict[int, tuple[int, ...]] = {0: (0,) * len(names)}
    for position, weight in enumerate(weights):
        for value, bits in list(states.items()):
            candidate = value + weight
            if candidate <= max_value and candidate not in states:
                updated = list(bits)
                updated[position] = 1
                states[candidate] = tuple(updated)
    target = min(states, key=lambda value: (abs(value - desired), value))
    bits = states[target]
    return {name: bit for name, bit in zip(names, bits, strict=True)}


def _weights(max_value: int) -> tuple[int, ...]:
    if max_value <= 0:
        return ()
    weights: list[int] = []
    remaining = max_value
    power = 1
    while remaining > 0:
        weight = min(power, remaining)
        weights.append(weight)
        remaining -= weight
        power *= 2
    return tuple(weights)


def _key(left: str, right: str) -> str:
    return "*".join(sorted((left, right)))


class _Builder:
    def __init__(self) -> None:
        self.linear: dict[str, Decimal] = {}
        self.quadratic: dict[str, Decimal] = {}
        self.offset = Decimal("0")
        self.variables: list[QUBOVariable] = []
        self.objective_terms: list[QUBOTerm] = []
        self.penalty_terms: list[QUBOTerm] = []

    def variable(self, name: str, kind: VariableKind, route_id: str | None = None) -> None:
        self.variables.append(
            QUBOVariable(name=name, kind=kind, index=len(self.variables), route_id=route_id)
        )
        self.linear.setdefault(name, Decimal("0"))

    def linear_term(
        self, name: str, coefficient: Decimal, description: str, objective: bool
    ) -> None:
        self.linear[name] = self.linear.get(name, Decimal("0")) + coefficient
        self._term("linear", [name], coefficient, description, objective)

    def quadratic_term(
        self, left: str, right: str, coefficient: Decimal, description: str, objective: bool
    ) -> None:
        if left == right:
            self.linear[left] = self.linear.get(left, Decimal("0")) + coefficient
            self._term("linear", [left], coefficient, description, objective)
            return
        key = _key(left, right)
        self.quadratic[key] = self.quadratic.get(key, Decimal("0")) + coefficient
        self._term("quadratic", [left, right], coefficient, description, objective)

    def constant(self, coefficient: Decimal, description: str, objective: bool) -> None:
        self.offset += coefficient
        self._term("constant", [], coefficient, description, objective)

    def _term(
        self,
        term_type: TermType,
        variables: list[str],
        coefficient: Decimal,
        description: str,
        objective: bool,
    ) -> None:
        term = QUBOTerm(
            term_type=cast(TermType, term_type),
            variables=variables,
            coefficient=coefficient,
            description=description,
        )
        (self.objective_terms if objective else self.penalty_terms).append(term)

    def square(
        self,
        coefficients: dict[str, int],
        target: int,
        penalty: int,
        description: str,
    ) -> None:
        penalty_decimal = Decimal(penalty)
        target_decimal = Decimal(target)
        self.constant(penalty_decimal * target_decimal * target_decimal, description, False)
        names = sorted(coefficients)
        for name in names:
            coefficient = coefficients[name]
            self.linear_term(
                name,
                penalty_decimal * (coefficient * coefficient - 2 * target * coefficient),
                description,
                False,
            )
        for position, left in enumerate(names):
            for right in names[position + 1 :]:
                self.quadratic_term(
                    left,
                    right,
                    Decimal(2 * penalty * coefficients[left] * coefficients[right]),
                    description,
                    False,
                )


def build_qubo(problem: TransactionRouteProblem) -> QUBOInstance:
    scale = _precision_scale(problem)
    builder = _Builder()
    route_variables: list[str] = []
    route_indices: dict[str, int] = {}
    for index, route in enumerate(problem.routes):
        name = f"x{index}"
        route_variables.append(name)
        route_indices[name] = index
        builder.variable(name, "route", route.id)

    cost_weight, risk_weight, selection_weight = (
        problem.objective_weights.cost,
        problem.objective_weights.risk,
        problem.objective_weights.selection,
    )
    for index, route in enumerate(problem.routes):
        name = route_variables[index]
        cost_units = _units(cost_weight * route.cost, scale)
        risk_units = _units(risk_weight * problem.transaction_amount * route.risk, scale)
        selection_units = _units(selection_weight, scale)
        coefficient = cost_units + risk_units + selection_units
        builder.linear_term(
            name,
            Decimal(coefficient),
            f"weighted cost, risk exposure, and selection cost for {route.id}",
            True,
        )

    constraints: list[ConstraintEncoding] = []
    base_upper_bound = sum(
        abs(_units(problem.objective_weights.cost * route.cost, scale))
        + abs(
            _units(problem.objective_weights.risk * problem.transaction_amount * route.risk, scale)
        )
        + abs(_units(problem.objective_weights.selection, scale))
        for route in problem.routes
    )
    penalty = max(1000, 10 * base_upper_bound + 1)

    def add_constraint(
        name: str,
        route_coefficients: dict[str, int],
        target: int,
        slack_sign: int,
        slack_max: int,
    ) -> None:
        weights = _weights(slack_max)
        slack_names: list[str] = []
        slack_coefficients = dict(route_coefficients)
        for bit, weight in enumerate(weights):
            slack_name = f"s_{name}_{bit}"
            slack_names.append(slack_name)
            builder.variable(slack_name, "slack")
            coefficient = slack_sign * weight
            slack_coefficients[slack_name] = coefficient
        builder.square(
            slack_coefficients,
            target,
            penalty,
            f"penalty for {name}",
        )
        constraints.append(
            ConstraintEncoding(
                name=name,
                route_coefficients=dict(route_coefficients),
                target=target,
                slack_names=tuple(slack_names),
                slack_weights=weights,
                slack_sign=slack_sign,
                slack_max=slack_max,
                penalty=penalty,
            )
        )

    for index, route in enumerate(problem.routes):
        name = route_variables[index]
        if not route.available:
            builder.linear_term(
                name,
                Decimal(penalty),
                f"unavailable route {route.id} forced off",
                False,
            )

    required = set(problem.constraints.required_route_ids)
    for route_id in sorted(required):
        index = next(i for i, route in enumerate(problem.routes) if route.id == route_id)
        name = route_variables[index]
        builder.linear_term(
            name,
            Decimal(-penalty),
            f"required route {route_id} forced on",
            False,
        )
        builder.constant(Decimal(penalty), f"required route {route_id} constant", False)
        constraints.append(
            ConstraintEncoding(
                name=f"required_{route_id}",
                route_coefficients={name: 1},
                target=1,
                slack_names=(),
                slack_weights=(),
                slack_sign=1,
                slack_max=0,
                penalty=penalty,
            )
        )

    route_count = len(problem.routes)
    add_constraint(
        "min_selected",
        {name: 1 for name in route_variables},
        problem.constraints.min_selected_routes,
        -1,
        max(0, route_count - problem.constraints.min_selected_routes),
    )
    if problem.constraints.max_selected_routes is not None:
        add_constraint(
            "max_selected",
            {name: 1 for name in route_variables},
            problem.constraints.max_selected_routes,
            1,
            problem.constraints.max_selected_routes,
        )

    capacity_coefficients = {
        name: _units(problem.routes[index].capacity, scale)
        for index, name in enumerate(route_variables)
    }
    capacity_target = _units(problem.transaction_amount, scale)
    capacity_max = max(0, sum(capacity_coefficients.values()) - capacity_target)
    add_constraint("capacity", capacity_coefficients, capacity_target, -1, capacity_max)

    liquidity_coefficients = {
        name: _units(problem.routes[index].liquidity, scale)
        for index, name in enumerate(route_variables)
    }
    liquidity_target = _units(problem.transaction_amount, scale)
    liquidity_max = max(0, sum(liquidity_coefficients.values()) - liquidity_target)
    add_constraint("liquidity", liquidity_coefficients, liquidity_target, -1, liquidity_max)

    if problem.constraints.max_cost is not None:
        cost_coefficients = {
            name: _units(problem.routes[index].cost, scale)
            for index, name in enumerate(route_variables)
        }
        cost_target = _units(problem.constraints.max_cost, scale)
        add_constraint("max_cost", cost_coefficients, cost_target, 1, cost_target)

    if problem.constraints.max_risk is not None:
        risk_coefficients = {
            name: _units(
                (problem.routes[index].risk - problem.constraints.max_risk)
                * problem.routes[index].capacity,
                scale,
            )
            for index, name in enumerate(route_variables)
        }
        risk_max = max(0, -sum(value for value in risk_coefficients.values() if value < 0))
        add_constraint("max_risk", risk_coefficients, 0, 1, risk_max)

    variable_by_name = {variable.name: variable for variable in builder.variables}
    metadata = FormulationMetadata(
        formulation_type="QUBO",
        num_binary_variables=len(builder.variables),
        num_route_variables=len(route_variables),
        num_slack_variables=len(builder.variables) - len(route_variables),
        num_constraints=len(constraints)
        + sum(1 for route in problem.routes if not route.available),
        precision_scale=scale,
        penalty_coefficient=Decimal(penalty),
    )
    ising_h = {
        name: coefficient / Decimal(2)
        + sum(
            pair_coefficient / Decimal(4)
            for key, pair_coefficient in builder.quadratic.items()
            if name in key.split("*", 1)
        )
        for name, coefficient in builder.linear.items()
    }
    ising_j = {key: coefficient / Decimal(4) for key, coefficient in builder.quadratic.items()}
    ising_offset = (
        builder.offset
        + sum(builder.linear.values(), Decimal("0")) / Decimal(2)
        + sum(builder.quadratic.values(), Decimal("0")) / Decimal(4)
    )
    formulation = QUBOFormulation(
        problem_id=problem.problem_id or "unassigned",
        variables=[variable_by_name[name] for name in sorted(variable_by_name)],
        linear={name: builder.linear[name] for name in sorted(builder.linear)},
        quadratic={key: builder.quadratic[key] for key in sorted(builder.quadratic)},
        offset=builder.offset,
        objective_terms=builder.objective_terms,
        penalty_terms=builder.penalty_terms,
        metadata=metadata,
        ising={
            "h": {name: ising_h[name] for name in sorted(ising_h)},
            "J": {key: ising_j[key] for key in sorted(ising_j)},
            "offset": ising_offset,
            "mapping": "x_i = (1 + z_i) / 2",
        },
    )
    return QUBOInstance(
        formulation=formulation,
        route_variables=tuple(route_variables),
        route_indices=route_indices,
        constraints=tuple(constraints),
        precision_scale=scale,
        penalty=penalty,
    )


def calculate_energy(
    formulation: QUBOFormulation | QUBOInstance,
    assignment: Mapping[str, int],
) -> Decimal:
    if isinstance(formulation, QUBOInstance):
        return formulation.energy(assignment)
    value = formulation.offset
    for name, coefficient in formulation.linear.items():
        value += coefficient * int(assignment.get(name, 0))
    for key, coefficient in formulation.quadratic.items():
        left, right = key.split("*", 1)
        value += coefficient * int(assignment.get(left, 0)) * int(assignment.get(right, 0))
    return value


def assignment_energy(
    instance: QUBOInstance,
    assignment: Mapping[str, int],
) -> float:
    return float(instance.energy(assignment))
