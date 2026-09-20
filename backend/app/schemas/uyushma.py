from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.user import normalize_phone


class UyushmaBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150, examples=["Andijon Avtotrans Uyushmasi"])
    code: str = Field(..., min_length=2, max_length=50, pattern=r"^[A-Za-z0-9_-]+$", examples=["AND-UYUSHMA-01"])
    phone: str = Field(..., examples=["+998742234567"])
    address: Optional[str] = Field(None, max_length=255, examples=["Andijon sh., Bobur shoh ko'chasi, 12"])
    region: Optional[str] = Field(None, max_length=150, examples=["Andijon viloyati, Andijon shahri"])
    contact_person: Optional[str] = Field(None, max_length=100)
    license_number: Optional[str] = Field(None, max_length=60)
    is_active: bool = True

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class UyushmaCreate(UyushmaBase):
    # Optional Uyushma admin account created in the same step (Super Admin only)
    admin_full_name: Optional[str] = Field(None, min_length=2, max_length=100)
    admin_phone: Optional[str] = None
    admin_password: Optional[str] = Field(None, min_length=8, max_length=128)

    @field_validator("admin_phone", mode="before")
    @classmethod
    def _admin_phone(cls, v: Optional[str]) -> Optional[str]:
        return normalize_phone(v) if v else None


class UyushmaUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=2, max_length=150)
    phone: Optional[str] = None
    address: Optional[str] = Field(None, max_length=255)
    region: Optional[str] = Field(None, max_length=150)
    contact_person: Optional[str] = Field(None, max_length=100)
    license_number: Optional[str] = Field(None, max_length=60)

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: Optional[str]) -> Optional[str]:
        return normalize_phone(v) if v else None


class UyushmaAdminAccountRequest(BaseModel):
    """Create the Uyushma's admin login, or reset the existing one (name/phone/password)."""

    full_name: str = Field(..., min_length=2, max_length=100)
    phone: str
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class UyushmaRead(UyushmaBase):
    id: int
    archived_at: Optional[datetime] = None
    archive_reason: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UyushmaAdminRead(UyushmaRead):
    status: str  # active, archived
    routes_count: int = 0
    drivers_count: int = 0
    vehicles_count: int = 0
    admin_phone: Optional[str] = None


class UyushmaKPIs(BaseModel):
    uyushma_id: int
    owned_routes_count: int
    published_routes_count: int
    drivers_count: int
    vehicles_count: int
    active_shifts_count: int
    visible_vehicles_count: int
    parkings_count: int
    parked_vehicles_count: int
    today_payments_total: int
    today_payments_count: int
    pending_cashouts_count: int
    pending_cashouts_total: int
