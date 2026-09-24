from __future__ import annotations

from fastapi.testclient import TestClient

from app.api.app import app
from app.core.config import get_settings


def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def payload() -> dict[str, object]:
    return {
        "problem": {
            "transaction_amount": 100,
            "routes": [
                {
                    "id": "route-a",
                    "cost": 1,
                    "risk": 0.1,
                    "liquidity": 100,
                    "capacity": 100,
                    "available": True,
                }
            ],
            "constraints": {"min_selected_routes": 1},
        }
    }


def test_health_endpoints_are_public() -> None:
    get_settings.cache_clear()
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/health/ready").status_code == 200


def test_api_requires_bearer_token() -> None:
    client = TestClient(app)
    response = client.post("/optimize", json=payload())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "QUANTUM_SERVICE_UNAUTHORIZED"


def test_optimize_formulate_compare_and_problem_endpoints() -> None:
    client = TestClient(app)
    headers = auth_headers()
    formulated = client.post("/formulate", json=payload(), headers=headers)
    assert formulated.status_code == 200
    assert formulated.json()["formulation_type"] == "QUBO"

    optimized = client.post("/optimize", json=payload(), headers=headers)
    assert optimized.status_code == 200
    assert optimized.json()["feasible"] is True

    problem_id = optimized.json()["problem_id"]
    retrieved = client.get(f"/problems/{problem_id}", headers=headers)
    assert retrieved.status_code == 200
    assert retrieved.json()["problem_id"] == problem_id

    compared = client.post("/compare", json=payload(), headers=headers)
    assert compared.status_code == 200
    assert compared.json()["same_feasibility"] is True


def test_api_returns_structured_validation_error() -> None:
    client = TestClient(app)
    response = client.post(
        "/optimize",
        json={"problem": {"transaction_amount": 100, "routes": []}},
        headers=auth_headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "QUANTUM_VALIDATION_ERROR"
    assert "request_id" in response.json()["error"]


def test_evaluate_endpoint_runs_suite() -> None:
    client = TestClient(app)
    response = client.post(
        "/evaluate",
        json={"include_builtins": True},
        headers=auth_headers(),
    )
    assert response.status_code == 200
    assert response.json()["failed"] == 0
