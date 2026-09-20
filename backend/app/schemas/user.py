import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

PHONE_RE = re.compile(r"^\+998\d{9}$")


def normalize_phone(value: str) -> str:
    """Normalize Uzbek phone numbers to E.164 (+998XXXXXXXXX)."""
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 9:
        digits = "998" + digits
    normalized = "+" + digits
    if not PHONE_RE.match(normalized):
        raise ValueError("Telefon raqami +998XXXXXXXXX formatida bo'lishi kerak")
    return normalized


class UserBase(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    full_name: str = Field(..., examples=["Ali Valiyev"])
    role: str = "client"
    is_active: bool = True


class UserRead(UserBase):
    id: int
    email: Optional[str] = None
    uyushma_id: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MeResponse(UserRead):
    """Current user plus role-specific context used by the web app shells."""

    driver_id: Optional[int] = None
    vehicle_id: Optional[int] = None
    vehicle_internal_id: Optional[str] = None
    route_id: Optional[int] = None
    uyushma_name: Optional[str] = None


class ClientProfileRead(BaseModel):
    id: int
    user_id: int
    preferred_language: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActiveShiftBrief(BaseModel):
    id: int
    started_at: datetime
    direction: str
    is_online: bool


class DriverCreateRequest(BaseModel):
    phone: str = Field(..., examples=["+998901110001"])
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=100, examples=["Hasan Olimov"])
    email: Optional[str] = Field(None, max_length=150)
    license_number: Optional[str] = Field(None, max_length=50, examples=["AA1234567"])
    vehicle_id: Optional[int] = Field(None, description="Vehicle to assign (1 driver = 1 vehicle)")
    route_id: Optional[int] = Field(None, description="Route for the assigned vehicle (1 vehicle = 1 route)")

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class DriverUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(None, min_length=2, max_length=100)
    phone: Optional[str] = None
    email: Optional[str] = Field(None, max_length=150)
    license_number: Optional[str] = Field(None, max_length=50)
    password: Optional[str] = Field(None, min_length=8, max_length=128)
    is_active: Optional[bool] = None
    vehicle_id: Optional[int] = None
    route_id: Optional[int] = None

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: Optional[str]) -> Optional[str]:
        return normalize_phone(v) if v else v


class DriverRead(BaseModel):
    id: int
    user_id: int
    uyushma_id: int
    license_number: Optional[str] = None
    is_active: bool
    full_name: str
    phone: str
    email: Optional[str] = None
    vehicle_id: Optional[int] = None
    vehicle_internal_id: Optional[str] = None
    vehicle_plate: Optional[str] = None
    route_id: Optional[int] = None
    route_number: Optional[str] = None
    active_shift: Optional[ActiveShiftBrief] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
