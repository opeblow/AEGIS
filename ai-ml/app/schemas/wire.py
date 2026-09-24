"""Response schemas for the internal API wire format."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class StrictWire(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AnalyzeSuccess(StrictWire):
    result: dict
    input_hash: str


class QuerySuccess(StrictWire):
    answer: dict
    input_hash: str


class ErrorDetail(StrictWire):
    code: str
    message: str


class ErrorResponse(StrictWire):
    error: ErrorDetail