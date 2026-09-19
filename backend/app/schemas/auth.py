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
