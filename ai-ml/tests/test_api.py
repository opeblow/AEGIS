import pytest
import httpx

from app.api.app import app
from app.core.config import get_settings

VALID_TOKEN = "test-bearer-token"


@pytest.fixture(scope="module", autouse=True)
def _set_token():
    from app.core.config import settings

    # Force settings cache to pick up the test token.
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


async def _client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _auth_headers():
    return {"Authorization": f"Bearer {VALID_TOKEN}"}


def _analyze_payload():
    from tests.conftest import make_context

    return make_context().model_dump(mode="json")


async def test_health_unauthenticated():
    async with await _client() as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["model_provider"] == "mock"


async def test_analyze_requires_auth():
    async with await _client() as client:
        resp = await client.post("/analyze", json=_analyze_payload())
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "AI_SERVICE_UNAUTHORIZED"


async def test_analyze_wrong_token():
    async with await _client() as client:
        resp = await client.post(
            "/analyze",
            json=_analyze_payload(),
            headers={"Authorization": "Bearer nope"},
        )
        assert resp.status_code == 401


async def test_analyze_success(monkeypatch):
    monkeypatch.setenv("AEGIS_AI_SERVICE_TOKEN", VALID_TOKEN)
    get_settings.cache_clear()
    async with await _client() as client:
        resp = await client.post(
            "/analyze", json=_analyze_payload(), headers=_auth_headers()
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["result"]["deal_id"] == "deal-1"
        assert body["result"]["summary"]["summary"]
        assert body["result"]["model"]["provider"] == "mock"
        assert body["input_hash"]


async def test_analyze_invalid_body(monkeypatch):
    monkeypatch.setenv("AEGIS_AI_SERVICE_TOKEN", VALID_TOKEN)
    get_settings.cache_clear()
    async with await _client() as client:
        resp = await client.post(
            "/analyze",
            json={"deal_id": 123},
            headers=_auth_headers(),
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "AI_VALIDATION_ERROR"


async def test_query_success(monkeypatch):
    monkeypatch.setenv("AEGIS_AI_SERVICE_TOKEN", VALID_TOKEN)
    get_settings.cache_clear()
    from tests.conftest import make_query

    payload = make_query("What is the deal amount?").model_dump(mode="json")
    async with await _client() as client:
        resp = await client.post("/query", json=payload, headers=_auth_headers())
        assert resp.status_code == 200, resp.text
        assert resp.json()["answer"]["within_scope"] is True


async def test_unknown_route_404(monkeypatch):
    monkeypatch.setenv("AEGIS_AI_SERVICE_TOKEN", VALID_TOKEN)
    get_settings.cache_clear()
    async with await _client() as client:
        resp = await client.get("/nope")
        assert resp.status_code == 404


async def test_oversized_payload_rejected(monkeypatch):
    monkeypatch.setenv("AEGIS_AI_SERVICE_TOKEN", VALID_TOKEN)
    get_settings.cache_clear()
    payload = _analyze_payload()
    payload["deal"]["description"] = "x" * 2_000_000
    async with await _client() as client:
        resp = await client.post("/analyze", json=payload, headers=_auth_headers())
        assert resp.status_code == 413
        assert resp.json()["error"]["code"] == "AI_INPUT_TOO_LARGE"