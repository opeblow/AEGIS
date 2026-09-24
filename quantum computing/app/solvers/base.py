from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.schemas.output import SolverResult


@dataclass(frozen=True)
class SolveRequest:
    problem_id: str
    route_count: int


class SolverInterface(Protocol):
    name: str

    def solve(self, problem, instance) -> SolverResult: ...
