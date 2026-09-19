from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class UyushmaBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=150, examples=["Andijon Avtotrans Uyushmasi"])
    code: str = Field(..., min_length=2, max_length=50, examples=["AND-UYUSHMA-01"])
    phone: str = Field(..., examples=["+998742234567"])
    address: Optional[str] = Field(None, examples=["Andijon sh., Bobur shoh ko'chasi, 12"])
    is_active: bool = True


class UyushmaCreate(UyushmaBase):
    pass


class UyushmaUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None


class UyushmaRead(UyushmaBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
