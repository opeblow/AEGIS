from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.handlers import (
    handle_compare,
    handle_evaluate,
    handle_formulate,
    handle_get_problem,
    handle_health,
    handle_optimize,
    handle_ready,
    require_authorized_token,
)
from app.core.config import settings
from app.core.errors import QuantumServiceError
from app.schemas.evaluation import EvaluationReport, EvaluationRequest
from app.schemas.output import (
    ComparisonResponse,
    ErrorDetail,
    ErrorResponse,
    HealthResponse,
    ProblemRecord,
    QUBOFormulation,
    ReadyResponse,
    SolverResult,
)
from app.schemas.requests import CompareRequest, FormulateRequest, OptimizeRequest
from app.services.orchestrator import OptimizationService

logger = logging.getLogger(__name__)


def _error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    details: object | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(
            error=ErrorDetail(
                code=code,
                message=message,
                request_id=getattr(request.state, "request_id", None),
                details=details,
            )
        ).model_dump(mode="json"),
    )


def create_app() -> FastAPI:
    cfg = settings()
    app = FastAPI(
        title=cfg.app_name,
        version=cfg.service_version,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.optimization_service = OptimizationService()

    @app.middleware("http")
    async def request_id_and_size_limit(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id[:128]
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > cfg.max_problem_bytes:
                    response = _error_response(
                        request,
                        413,
                        "QUANTUM_INPUT_TOO_LARGE",
                        f"Request exceeds the {cfg.max_problem_bytes}-byte problem boundary.",
                    )
                    response.headers["x-request-id"] = request.state.request_id
                    return response
            except ValueError:
                pass
        response = await call_next(request)
        response.headers["x-request-id"] = request.state.request_id
        return response

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return handle_health()

    @app.get("/health/ready", response_model=ReadyResponse)
    async def ready() -> ReadyResponse:
        return handle_ready()

    @app.post("/formulate", response_model=QUBOFormulation)
    async def formulate(
        body: FormulateRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> QUBOFormulation:
        require_authorized_token(authorization)
        return await handle_formulate(body, request)

    @app.post("/optimize", response_model=SolverResult)
    async def optimize(
        body: OptimizeRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> SolverResult:
        require_authorized_token(authorization)
        return await handle_optimize(body, request)

    @app.post("/compare", response_model=ComparisonResponse)
    async def compare(
        body: CompareRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> ComparisonResponse:
        require_authorized_token(authorization)
        return await handle_compare(body, request)

    @app.get("/problems/{problem_id}", response_model=ProblemRecord)
    async def get_problem(
        problem_id: str,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> ProblemRecord:
        require_authorized_token(authorization)
        return await handle_get_problem(problem_id, request)

    @app.post("/evaluate", response_model=EvaluationReport)
    async def evaluate(
        body: EvaluationRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> EvaluationReport:
        require_authorized_token(authorization)
        return await handle_evaluate(body, request)

    @app.exception_handler(QuantumServiceError)
    async def quantum_error_handler(
        request: Request,
        exc: QuantumServiceError,
    ) -> JSONResponse:
        details = (
            exc.details if isinstance(exc.details, (dict, list, str, int, float, bool)) else None
        )
        return _error_response(
            request,
            exc.status_code,
            exc.code,
            str(exc.detail),
            details,
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        locations = [
            ".".join(str(part) for part in error.get("loc", []))
            for error in exc.errors()
            if error.get("loc")
        ]
        return _error_response(
            request,
            422,
            "QUANTUM_VALIDATION_ERROR",
            "Request validation failed.",
            {"locations": locations[:20]},
        )

    @app.exception_handler(ValueError)
    async def value_error_handler(
        request: Request,
        exc: ValueError,
    ) -> JSONResponse:
        return _error_response(
            request,
            422,
            "QUANTUM_VALIDATION_ERROR",
            str(exc),
        )

    @app.exception_handler(ValidationError)
    async def model_validation_handler(
        request: Request,
        exc: ValidationError,
    ) -> JSONResponse:
        return _error_response(
            request,
            422,
            "QUANTUM_VALIDATION_ERROR",
            "Response or model validation failed.",
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(
        request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        return _error_response(
            request,
            exc.status_code,
            "QUANTUM_HTTP_ERROR",
            str(exc.detail),
        )

    @app.exception_handler(Exception)
    async def unhandled_error_handler(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "unhandled_error",
            extra={"path": request.url.path, "error_type": type(exc).__name__},
        )
        return _error_response(
            request,
            500,
            "QUANTUM_INTERNAL_ERROR",
            "The quantum optimization service failed to produce a result.",
        )

    return app


app = create_app()
