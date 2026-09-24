"""Internal API route handlers.

The wire contract: POST /analyze and POST /query accept the authorized deal
context plus a Bearer credential, and return either the advisory result or a
structered error (never an HTML page, never a raw provider traceback).
"""

from __future__ import annotations

import structlog

from app.core.config import settings
from app.core.errors import AIServiceError
from app.pipelines.orchestrator import analyze, run_query
from app.schemas.context import DealIntelligenceContext, DealIntelligenceQuery
from app.schemas.wire import AnalyzeSuccess, ErrorResponse, QuerySuccess

logger = structlog.get_logger(__name__)


def _boundary_checks(obj) -> None:
    cfg = settings()
    raw = obj.model_dump_json()
    if len(raw.encode("utf-8")) > cfg.max_context_bytes:
        raise AIServiceError(
            "AI_INPUT_TOO_LARGE",
            f"Request exceeds the {cfg.max_context_bytes}-byte context boundary.",
        )


async def handle_analyze(
    body: DealIntelligenceContext,
) -> AnalyzeSuccess:
    _boundary_checks(body)
    result = analyze(body)
    return AnalyzeSuccess(
        result=result.model_dump(mode="json"), input_hash=result.input_hash
    )


async def handle_query(
    body: DealIntelligenceQuery,
) -> QuerySuccess:
    _boundary_checks(body)
    cfg = settings()
    if len(body.question.encode("utf-8")) > cfg.max_query_bytes:
        raise AIServiceError(
            "AI_INPUT_TOO_LARGE",
            f"Question exceeds the {cfg.max_query_bytes}-byte limit.",
        )
    answer = run_query(body)
    return QuerySuccess(
        answer=answer.model_dump(mode="json"), input_hash=body.deal_id
    )


async def handle_health() -> dict:
    cfg = settings()
    return {
        "status": "ok",
        "service": cfg.app_name,
        "environment": cfg.environment,
        "model_provider": cfg.model_provider,
        "analysis_version": cfg.analysis_version,
        "credential_configured": cfg.credential_configured,
    }