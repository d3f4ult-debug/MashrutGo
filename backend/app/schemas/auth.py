from typing import Optional, Any, Dict
from pydantic import BaseModel, Field
from app.schemas.user import UserRead


class LoginRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    password: str = Field(..., min_length=4)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class TokenPayload(BaseModel):
    sub: Optional[str] = None
    role: Optional[str] = None
    uyushma_id: Optional[int] = None
    exp: Optional[int] = None


class ClientRegisterRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    password: str = Field(..., min_length=4)
    full_name: str = Field(..., min_length=2, max_length=100, examples=["Alisher Navoiy"])
    preferred_language: str = Field("uz", examples=["uz"])


class DriverRegisterRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    password: str = Field(..., min_length=4)
    full_name: str = Field(..., min_length=2, max_length=100, examples=["Anvar Qodirov"])
    license_number: str = Field(..., min_length=4, examples=["AB 1234567"])
    plate_number: Optional[str] = Field(None, examples=["60 A 777 AA"])
    vehicle_model: Optional[str] = Field("Isuzu SAZ NP37", examples=["Isuzu SAZ NP37"])
    uyushma_id: int = Field(..., examples=[1])


class SendOtpRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    purpose: Optional[str] = Field("signin", examples=["signin", "signup"])


class VerifyOtpRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    code: str = Field(..., min_length=4, max_length=6, examples=["1234"])


class LoginOtpRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    code: str = Field(..., min_length=4, max_length=6, examples=["1234"])
    full_name: Optional[str] = Field(None, examples=["Alisher Navoiy"])

