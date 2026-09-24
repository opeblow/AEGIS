"""Service configuration. Environment-driven with safe defaults.

Configuration deliberately mirrors the backend's `.env` conventions, using the
`AEGIS_AI_` prefix (e.g. AEGIS_AI_PORT, AEGIS_AI_SERVICE_TOKEN). In production
the service credential MUST be provided; when it is missing the service
refuses to serve the internal API so it can never become an unauthenticated
public endpoint.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AEGIS_AI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_name: str = "aegis-ai"
    environment: str = "development"
    log_level: str = "info"
    analysis_version: str = "1"

    # Service-to-service credential. The backend sends this as a bearer token.
    service_token: str = ""

    # Model provider. Canonical names: "mock" | "hosted"
    model_provider: str = "mock"
    model_version: str = "aegis-mock-v1"

    # Request guards
    max_context_bytes: int = 1_500_000
    max_query_bytes: int = 4_096

    @property
    def credential_configured(self) -> bool:
        return bool(self.service_token and self.service_token.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()


def settings() -> Settings:
    return get_settings()