"""Service-to-service authentication.

The backend authenticates to this internal service using a shared bearer
token. Comparison is constant-time so token timing cannot be measured. When no
credential is configured the service is treated as unauthenticated-available
for local dev ONLY; production deployments MUST set AEGIS_AI_SERVICE_TOKEN.
"""

from __future__ import annotations

import hmac
from typing import Optional

from app.core.config import settings
from app.core.errors import AIServiceError


class ServiceAuthError(AIServiceError):
    def __init__(self) -> None:
        super().__init__(
            code="AI_SERVICE_UNAUTHORIZED",
            message="Invalid or missing credential.",
        )


def _constant_time(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def require_service_token(
    authorization: Optional[str],
) -> str:
    cfg = settings()
    if not cfg.credential_configured:
        from app.core.config import get_settings

        cfg = get_settings()
    expected = cfg.service_token
    if not expected:
        raise ServiceAuthError()
    if authorization is None or not authorization.lower().startswith("bearer "):
        raise ServiceAuthError()
    supplied = authorization[7:].strip()
    if not supplied or not _constant_time(supplied, expected):
        raise ServiceAuthError()
    return supplied