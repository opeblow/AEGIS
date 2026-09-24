"""Service configuration."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="QUANTUM_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "aegis-quantum-optimization"
    environment: str = "development"
    log_level: str = "info"
    service_version: str = "1.0.0"
    host: str = "127.0.0.1"
    port: int = 8557

    api_token: str = "dev-token"
    solver: Literal["classical", "simulator", "real_hardware"] = "simulator"
    max_variables: int = Field(default=64, ge=1, le=128)
    timeout_seconds: float = Field(default=30.0, gt=0)
    max_problem_bytes: int = Field(default=1_000_000, ge=1)

    qaoa_layers: int = Field(default=1, ge=1, le=3)
    qaoa_angle_grid: int = Field(default=3, ge=1, le=7)
    qaoa_shots: int = Field(default=2048, ge=1)
    random_seed: int = 1729

    @property
    def credential_configured(self) -> bool:
        return bool(self.api_token and self.api_token.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()


def settings() -> Settings:
    return get_settings()
