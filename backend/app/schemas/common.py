import math
from typing import Generic, List, TypeVar

from pydantic import BaseModel, Field, field_validator

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    size: int
    pages: int

    @classmethod
    def build(cls, items: List[T], total: int, page: int, size: int) -> "PaginatedResponse[T]":
        return cls(items=items, total=total, page=page, size=size, pages=max(1, math.ceil(total / size)) if size else 1)


class MessageResponse(BaseModel):
    message: str
    detail: str = ""


class ReasonRequest(BaseModel):
    """Body for destructive/financial actions that must carry an audit reason."""

    reason: str = Field(..., max_length=255)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Sabab kamida 3 ta belgidan iborat bo'lishi kerak")
        return v
