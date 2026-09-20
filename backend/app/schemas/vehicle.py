from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.services.nfc import normalize_nfc_tag

VEHICLE_TYPES = ("damas", "gazel", "isuzu", "bus", "minibus", "other")


class VehicleBase(BaseModel):
    plate_number: Optional[str] = Field(None, max_length=20, examples=["60 A 123 AA"])
    model: Optional[str] = Field(None, max_length=50, examples=["Damas"])
    color: Optional[str] = Field(None, max_length=30, examples=["Oq"])
    vehicle_type: Optional[str] = Field(None, examples=["damas"])
    nfc_tag_id: Optional[str] = Field(None, max_length=100)
    capacity: int = Field(7, ge=1, le=120)

    @field_validator("vehicle_type")
    @classmethod
    def _type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VEHICLE_TYPES:
            raise ValueError(f"vehicle_type must be one of {', '.join(VEHICLE_TYPES)}")
        return v

    @field_validator("plate_number", "model", "color", "nfc_tag_id", mode="before")
    @classmethod
    def _blank_to_none(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("nfc_tag_id")
    @classmethod
    def _nfc(cls, v: Optional[str]) -> Optional[str]:
        return normalize_nfc_tag(v)


class VehicleCreate(VehicleBase):
    # Optional: generated server-side (e.g. AND01-V0007) when omitted
    internal_id: Optional[str] = Field(None, min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_-]+$")
    route_id: Optional[int] = None
    driver_id: Optional[int] = None
    is_active: bool = True


class VehicleUpdate(BaseModel):
    plate_number: Optional[str] = Field(None, max_length=20)
    model: Optional[str] = Field(None, max_length=50)
    color: Optional[str] = Field(None, max_length=30)
    vehicle_type: Optional[str] = None
    nfc_tag_id: Optional[str] = Field(None, max_length=100)

    @field_validator("nfc_tag_id")
    @classmethod
    def _nfc(cls, v: Optional[str]) -> Optional[str]:
        return normalize_nfc_tag(v)
    capacity: Optional[int] = Field(None, ge=1, le=120)
    route_id: Optional[int] = None
    driver_id: Optional[int] = None
    is_active: Optional[bool] = None

    @field_validator("vehicle_type")
    @classmethod
    def _type(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VEHICLE_TYPES:
            raise ValueError(f"vehicle_type must be one of {', '.join(VEHICLE_TYPES)}")
        return v


class VehicleRead(VehicleBase):
    id: int
    internal_id: str
    uyushma_id: int
    is_active: bool
    route_id: Optional[int] = None
    route_number: Optional[str] = None
    driver_id: Optional[int] = None
    driver_name: Optional[str] = None
    is_on_shift: bool = False
    qr_payload: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
