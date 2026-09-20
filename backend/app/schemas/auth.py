from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.schemas.user import UserRead, normalize_phone


class LoginRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    password: str = Field(..., min_length=4, max_length=128)

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserRead


class TokenPayload(BaseModel):
    sub: Optional[str] = None
    role: Optional[str] = None
    uyushma_id: Optional[int] = None
    exp: Optional[int] = None


class ClientRegisterRequest(BaseModel):
    phone: str = Field(..., examples=["+998901234567"])
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str = Field(..., min_length=2, max_length=100, examples=["Alisher Navoiy"])
    preferred_language: str = Field("uz", pattern="^(uz|ru|en)$", examples=["uz"])

    @field_validator("phone", mode="before")
    @classmethod
    def _phone(cls, v: str) -> str:
        return normalize_phone(v)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=4, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)
