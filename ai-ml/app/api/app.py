"""FastAPI app factory: middleware, routers, auth, and error handling.

The service exposes exactly two internal endpoints (analyze, query) plus an
unauthed health check. Everything else 404s. Errors are mapped to the shared
AI_* contract codes so the backend can translate them directly.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.handlers import handle_analyze, handle_health, handle_query
from app.core.config import settings
from app.core.errors import AIServiceError, safe_error_detail
from app.schemas.context import DealIntelligenceContext, DealIntelligenceQuery
from app.schemas.wire import ErrorDetail, ErrorResponse

import structlog
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from pydantic import ValidationError

logger = structlog.get_logger(__name__)


def create_app() -> FastAPI:
    cfg = settings()
    app = FastAPI(
        title=cfg.app_name,
        version=cfg.analysis_version,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    # CORS: internal service, only called server-to-server. We do not enable
    # arbitrary browsers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_methods=["POST", "GET"],
        allow_headers=[],
    )

    @app.post("/analyze")
    async def analyze(body: DealIntelligenceContext, request: Request) -> dict:
        from app.api.deps import require_service_token

        require_service_token(request.headers.get("authorization"))
        resp = await handle_analyze(body)
        return resp.model_dump()

    @app.post("/query")
    async def query(body: DealIntelligenceQuery, request: Request) -> dict:
        from app.api.deps import require_service_token

        require_service_token(request.headers.get("authorization"))
        resp = await handle_query(body)
        return resp.model_dump()

    @app.get("/health")
    async def health() -> dict:
        return await handle_health()

    @app.exception_handler(AIServiceError)
    async def ai_error_handler(request: Request, exc: AIServiceError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(
                error=ErrorDetail(code=exc.code, message=exc.detail)
            ).model_dump(),
        )

    def _invalid_payload(exc: object) -> JSONResponse:
        loc: list = []
        if isinstance(exc, (ValidationError, RequestValidationError)):
            first = exc.errors()[0] if exc.errors() else None
            loc = list(first.get("loc", [])) if first else []
        return JSONResponse(
            status_code=422,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="AI_VALIDATION_ERROR",
                    message=f"Invalid payload at {'.'.join(str(x) for x in loc)}",
                )
            ).model_dump(),
        )

    @app.exception_handler(ValidationError)
    async def validation_error_handler(
        request: Request, exc: ValidationError
    ) -> JSONResponse:
        return _invalid_payload(exc)

    @app.exception_handler(RequestValidationError)
    async def request_validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return _invalid_payload(exc)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="AI_VALIDATION_ERROR", message=str(exc.detail)
                )
            ).model_dump(),
        )

    # Sentinel-gated catch-all so nothing raw reaches the client.
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception(
            "unhandled_error", path=request.url.path, kind=safe_error_detail(exc)
        )
        return JSONResponse(
            status_code=500,
            content=ErrorResponse(
                error=ErrorDetail(
                    code="AI_PROVIDER_ERROR",
                    message="The intelligence service failed to produce a "
                    "result. Contact the service administrator.",
                )
            ).model_dump(),
        )

    return app


app = create_app()
