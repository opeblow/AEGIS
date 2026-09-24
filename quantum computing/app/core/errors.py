from __future__ import annotations

from fastapi import HTTPException


class QuantumServiceError(HTTPException):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 500,
        details: object = None,
    ) -> None:
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.details = details


class ProblemNotFoundError(QuantumServiceError):
    def __init__(self, problem_id: str) -> None:
        super().__init__(
            "QUANTUM_PROBLEM_NOT_FOUND",
            f"Problem {problem_id} was not found.",
            404,
        )


class SolverUnavailableError(QuantumServiceError):
    def __init__(self, solver: str) -> None:
        super().__init__(
            "QUANTUM_SOLVER_UNAVAILABLE",
            f"Solver {solver} is not available.",
            503,
        )


class InvalidProblemError(QuantumServiceError):
    def __init__(self, message: str) -> None:
        super().__init__("QUANTUM_PROBLEM_INVALID", message, 422)


class InputTooLargeError(QuantumServiceError):
    def __init__(self, limit: int) -> None:
        super().__init__(
            "QUANTUM_INPUT_TOO_LARGE",
            f"Request exceeds the {limit}-byte problem boundary.",
            413,
        )
