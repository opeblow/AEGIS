from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Header

from app.core.config import settings
from app.core.errors import QuantumServiceError


class UnauthorizedError(QuantumServiceError):
    def __init__(self) -> None:
        super().__init__(
            "QUANTUM_SERVICE_UNAUTHORIZED",
            "Invalid or missing bearer token.",
            401,
        )


def require_bearer_token(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    cfg = settings()
    expected = cfg.api_token.strip()
    if not expected:
        raise UnauthorizedError()
    if not authorization or not authorization.lower().startswith("bearer "):
        raise UnauthorizedError()
    supplied = authorization[7:].strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise UnauthorizedError()
    return supplied
