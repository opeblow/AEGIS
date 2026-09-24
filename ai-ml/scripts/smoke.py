"""End-to-end smoke test: run the full analyze + query flow over HTTP.

Usage:
    python scripts/smoke.py                 # in-process ASGI, no server needed
    python scripts/smoke.py --live 8555     # against a running uvicorn on :8555

Exits 0 on success, non-zero on any failure.
"""

from __future__ import annotations

import argparse
import os
import sys

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

TOKEN = os.environ.get("AEGIS_AI_SERVICE_TOKEN", "dev-super-secret-token")


def build_client(live_port: int | None) -> httpx.AsyncClient:
    if live_port is not None:
        return httpx.AsyncClient(base_url=f"http://127.0.0.1:{live_port}")
    from app.api.app import app

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


def sample_context() -> dict:
    from tests.conftest import make_context, make_query  # type: ignore[import-not-found]

    ctx = make_context()
    query = make_query("What is the latest offer amount?")
    return ctx.model_dump(mode="json"), query.model_dump(mode="json")


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", type=int, default=None)
    args = parser.parse_args()

    os.environ.setdefault("AEGIS_AI_SERVICE_TOKEN", TOKEN)
    if args.live is None:
        from app.core.config import get_settings

        get_settings.cache_clear()

    analyze_payload, query_payload = sample_context()
    headers = {"Authorization": f"Bearer {TOKEN}"}

    async with build_client(args.live) as client:
        health = await client.get("/health")
        health.raise_for_status()

        analyze = await client.post("/analyze", json=analyze_payload, headers=headers)
        analyze.raise_for_status()
        result = analyze.json()["result"]

        query = await client.post("/query", json=query_payload, headers=headers)
        query.raise_for_status()
        answer = query.json()["answer"]

    print("health:  ", health.json())
    print("analyze: deal", result["deal_id"], "| confidence", result["confidence"])
    print("         comparisons:", len(result["offer_comparison"]["entries"]))
    print("         blockers:   ", len(result["blockers"]))
    print("         findings:   ", len(result["document_findings"]))
    print("query:   ", answer["answer"][:120])
    assert result["deal_id"] == "deal-1"
    assert answer["within_scope"] is True
    print("\nOK")
    return 0


if __name__ == "__main__":
    import asyncio

    raise SystemExit(asyncio.run(main()))