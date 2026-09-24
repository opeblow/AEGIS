from __future__ import annotations

import uvicorn

from app.core.config import settings


def main() -> None:
    cfg = settings()
    uvicorn.run(
        "app.api.app:app",
        host=cfg.host,
        port=cfg.port,
        log_level=cfg.log_level.lower(),
        reload=False,
    )


if __name__ == "__main__":
    main()
