from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class RouteCandidate(StrictModel):
    id: str = Field(
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
    )
    cost: Decimal = Field(ge=0, allow_inf_nan=False)
    risk: Decimal = Field(ge=0, le=1, allow_inf_nan=False)
    liquidity: Decimal = Field(gt=0, allow_inf_nan=False)
    capacity: Decimal = Field(gt=0, allow_inf_nan=False)
    available: bool


class RouteConstraints(StrictModel):
    max_cost: Decimal | None = Field(default=None, ge=0, allow_inf_nan=False)
    max_risk: Decimal | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    min_selected_routes: int = Field(default=1, ge=1)
    max_selected_routes: int | None = Field(default=None, ge=1)
    required_route_ids: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_ids(self) -> RouteConstraints:
        if len(self.required_route_ids) != len(set(self.required_route_ids)):
            raise ValueError("required route ids must be unique")
        for route_id in self.required_route_ids:
            if not route_id or len(route_id) > 128:
                raise ValueError("required route ids must be non-empty and at most 128 characters")
            if not route_id[0].isalnum() or any(
                character
                not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-"
                for character in route_id
            ):
                raise ValueError("required route ids contain invalid characters")
        return self


class ObjectiveWeights(StrictModel):
    cost: Decimal = Field(default=Decimal("1"), ge=0, allow_inf_nan=False)
    risk: Decimal = Field(default=Decimal("1"), ge=0, allow_inf_nan=False)
    selection: Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_nonzero(self) -> ObjectiveWeights:
        if self.cost == 0 and self.risk == 0 and self.selection == 0:
            raise ValueError("at least one objective weight must be positive")
        return self


class TransactionRouteProblem(StrictModel):
    problem_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$",
    )
    transaction_amount: Decimal = Field(gt=0, allow_inf_nan=False)
    routes: list[RouteCandidate] = Field(min_length=1, max_length=100)
    constraints: RouteConstraints = Field(default_factory=RouteConstraints)
    objective_weights: ObjectiveWeights = Field(default_factory=ObjectiveWeights)

    def model_post_init(self, __context: object) -> None:
        ids = [route.id for route in self.routes]
        if len(ids) != len(set(ids)):
            raise ValueError("route ids must be unique")
        required = set(self.constraints.required_route_ids)
        missing = sorted(required.difference(ids))
        if missing:
            raise ValueError(f"required route ids do not exist: {', '.join(missing)}")
        maximum = self.constraints.max_selected_routes
        if maximum is not None and maximum < self.constraints.min_selected_routes:
            raise ValueError("max_selected_routes cannot be less than min_selected_routes")
        if maximum is not None and maximum > len(self.routes):
            raise ValueError("max_selected_routes cannot exceed the number of routes")
