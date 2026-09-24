from __future__ import annotations

import os

os.environ.setdefault("QUANTUM_API_TOKEN", "test-token")
os.environ.setdefault("QUANTUM_SOLVER", "simulator")
os.environ.setdefault("QUANTUM_MAX_VARIABLES", "64")
os.environ.setdefault("QUANTUM_TIMEOUT_SECONDS", "30")

import pytest
from fastapi.testclient import TestClient

from app.api.app import app
from app.core.config import get_settings


@pytest.fixture
def client() -> TestClient:
    get_settings().cache_clear()
    return TestClient(app)


@pytest.fixture
def headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


@pytest.fixture
def problem_payload() -> dict[str, object]:
    return {
        "problem": {
            "transaction_amount": 150,
            "routes": [
                {
                    "id": "route-a",
                    "cost": 8,
                    "risk": 0.04,
                    "liquidity": 100,
                    "capacity": 100,
                    "available": True,
                },
                {
                    "id": "route-b",
                    "cost": 12,
                    "risk": 0.06,
                    "liquidity": 100,
                    "capacity": 100,
                    "available": True,
                },
            ],
            "constraints": {"min_selected_routes": 2, "max_selected_routes": 2},
        }
    }
