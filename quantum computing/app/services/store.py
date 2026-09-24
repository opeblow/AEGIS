from __future__ import annotations

from app.schemas.output import SolverResult
from app.schemas.problem import TransactionRouteProblem


class ProblemStore:
    def __init__(self) -> None:
        self._problems: dict[str, TransactionRouteProblem] = {}
        self._results: dict[str, SolverResult] = {}

    def put(self, problem: TransactionRouteProblem) -> str:
        problem_id = problem.problem_id or self._identifier(problem)
        problem.problem_id = problem_id
        self._problems[problem_id] = problem
        return problem_id

    def put_result(self, problem_id: str, result: SolverResult) -> None:
        self._results[problem_id] = result

    def get(self, problem_id: str) -> TransactionRouteProblem | None:
        return self._problems.get(problem_id)

    def get_result(self, problem_id: str) -> SolverResult | None:
        return self._results.get(problem_id)

    def clear(self) -> None:
        self._problems.clear()
        self._results.clear()

    @staticmethod
    def _identifier(problem: TransactionRouteProblem) -> str:
        import hashlib

        payload = problem.model_dump_json(exclude={"problem_id": True}).encode("utf-8")
        return "qr_" + hashlib.sha256(payload).hexdigest()[:20]
