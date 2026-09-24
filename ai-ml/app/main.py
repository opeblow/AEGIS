"""Development entrypoint: `python -m app.main` (or `uvicorn app.main:app`)."""

import os

import uvicorn

from app.core.config import settings


def main() -> None:
    cfg = settings()
    port = int(os.environ.get("AEGIS_AI_PORT", "8555"))
    uvicorn.run(
        "app.api.app:app",
        host="127.0.0.1",
        port=port,
        log_level=cfg.log_level,
    )


if __name__ == "__main__":
    main()