from __future__ import annotations

import argparse
import os

import httpx

TOKEN = os.environ.get("QUANTUM_API_TOKEN", "dev-token")
BASE_URL = os.environ.get("QUANTUM_SMOKE_URL", "http://127.0.0.1:8557")


def problem_payload() -> dict[str, object]:
    return {
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


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=BASE_URL)
    args = parser.parse_args()
    headers = {"Authorization": f"Bearer {TOKEN}"}
    problem = {"problem": problem_payload()}

    async with httpx.AsyncClient(base_url=args.base_url, timeout=60) as client:
        checks: list[tuple[str, httpx.Response]] = []
        checks.append(("health", await client.get("/health")))
        checks.append(("ready", await client.get("/health/ready")))
        checks.append(("formulate", await client.post("/formulate", json=problem, headers=headers)))
        checks.append(("optimize", await client.post("/optimize", json=problem, headers=headers)))
        checks.append(("compare", await client.post("/compare", json=problem, headers=headers)))
        checks.append(
            (
                "evaluate",
                await client.post("/evaluate", json={"include_builtins": True}, headers=headers),
            )
        )

    for name, response in checks:
        if response.status_code != 200:
            raise RuntimeError(f"{name} returned {response.status_code}: {response.text}")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError(f"{name} did not return a JSON object")
        print(f"{name}: {response.status_code}")

    print("smoke test passed")
    return 0


if __name__ == "__main__":
    import asyncio

    raise SystemExit(asyncio.run(main()))
