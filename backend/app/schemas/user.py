from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class UserBase(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    full_name: str = Field(..., examples=["Ali Valiyev"])
    role: str = "client"
    is_active: bool = True


class UserCreate(UserBase):
    password: str = Field(..., min_length=4)


class UserRead(UserBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClientProfileRead(BaseModel):
    id: int
    user_id: int
    preferred_language: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DriverCreateRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234568"])
    password: str = Field(..., min_length=4)
    full_name: str = Field(..., examples=["Hasan Olimov"])
    license_number: Optional[str] = Field(None, examples=["AA1234567"])


class DriverRead(BaseModel):
    id: int
    user_id: int
    uyushma_id: int
    license_number: Optional[str]
    is_active: bool
    full_name: str
    phone: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
