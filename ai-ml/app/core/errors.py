"""Structured error codes for the AI/ML service.

These codes are part of the internal API contract and mirror the backend's
AI_* error codes so a failure can be traced end-to-end without leaking any
internal provider details.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

ERROR_CODES = {
    "AI_INPUT_TOO_LARGE": 413,
    "AI_UNSUPPORTED_DOCUMENT": 422,
    "AI_QUERY_OUT_OF_SCOPE": 422,
    "AI_PROVIDER_ERROR": 502,
    "AI_ANALYSIS_FAILED": 500,
    "AI_SERVICE_UNAUTHORIZED": 401,
    "AI_VALIDATION_ERROR": 422,
}

DEFAULT_STATUS_BY_CODE = {
    code: status for code, status in ERROR_CODES.items()
}

RESERVED_NON_SECRET = {"password", "token", "secret", "authorization", "cookie"}


def safe_error_detail(err: object) -> str:
    """A client-safe, low-cardinality error message. Never echoes raw provider
    output or file contents so logs/payloads cannot leak data."""
    if isinstance(err, Exception):
        return err.__class__.__name__ or "UnknownError"
    return "UnknownError"


class AIServiceError(HTTPException):
    def __init__(
        self,
        code: str,
        message: str,
        status_code: Optional[int] = None,
        details: object = None,
    ) -> None:
        super().__init__(
            status_code=status_code or DEFAULT_STATUS_BY_CODE.get(code, 500),
            detail=message,
        )
        self.code = code
        self.safe_details = safe_error_detail(details)


def raise_ai_error(code: str, message: str, details: object = None) -> None:
    raise AIServiceError(code, message, details=details)