from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import Header, Request

from app.api.deps import require_bearer_token
from app.core.config import settings
from app.evaluation.runner import evaluate as run_evaluation
from app.schemas.evaluation import EvaluationReport, EvaluationRequest
from app.schemas.output import (
    ComparisonResponse,
    HealthResponse,
    ProblemRecord,
    QUBOFormulation,
    ReadyResponse,
    SolverResult,
)
from app.schemas.requests import CompareRequest, FormulateRequest, OptimizeRequest
from app.services.orchestrator import OptimizationService


def _service(request: Request) -> OptimizationService:
    return request.app.state.optimization_service


def _run(coro):
    return asyncio.wait_for(coro, timeout=settings().timeout_seconds)


async def handle_formulate(
    body: FormulateRequest,
    request: Request,
) -> QUBOFormulation:
    service = _service(request)
    return await _run(asyncio.to_thread(service.formulate, body.problem))


async def handle_optimize(
    body: OptimizeRequest,
    request: Request,
) -> SolverResult:
    service = _service(request)
    return await _run(asyncio.to_thread(service.optimize, body.problem, body.solver))


async def handle_compare(
    body: CompareRequest,
    request: Request,
) -> ComparisonResponse:
    service = _service(request)
    return await _run(asyncio.to_thread(service.compare, body.problem, body.quantum_solver))


async def handle_get_problem(
    problem_id: str,
    request: Request,
) -> ProblemRecord:
    service = _service(request)
    return await _run(asyncio.to_thread(service.get_problem, problem_id))


async def handle_evaluate(
    body: EvaluationRequest,
    request: Request,
) -> EvaluationReport:
    service = _service(request)
    return await _run(asyncio.to_thread(run_evaluation, body, service))


def handle_health() -> HealthResponse:
    cfg = settings()
    degraded = cfg.solver == "real_hardware"
    return HealthResponse(
        status="degraded" if degraded else "ok",
        service=cfg.app_name,
        environment=cfg.environment,
        version=cfg.service_version,
        configured_solver=cfg.solver,
        credential_configured=cfg.credential_configured,
    )


def handle_ready() -> ReadyResponse:
    cfg = settings()
    local_simulation_available = cfg.solver in {"classical", "simulator"}
    real_hardware_configured = cfg.solver == "real_hardware"
    return ReadyResponse(
        status="ready" if local_simulation_available else "not_ready",
        service=cfg.app_name,
        solver=cfg.solver,
        local_simulation_available=local_simulation_available,
        real_hardware_configured=real_hardware_configured,
    )


def require_authorized_token(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    return require_bearer_token(authorization)
