from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, ConfigDict


class DeviceTokenRegisterRequest(BaseModel):
    token: str = Field(..., min_length=10, max_length=255, description="FCM / APNs device push token")
    platform: str = Field("android", pattern="^(android|ios|web)$", description="Device platform (android, ios, web)")
    device_name: Optional[str] = Field(None, max_length=100, description="Device brand / model / browser name")


class DeviceTokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    token: str
    platform: str
    device_name: Optional[str] = None
    is_active: bool
    last_seen_at: datetime
    created_at: datetime


class DeviceTokenListResponse(BaseModel):
    items: List[DeviceTokenResponse]
    total: int


class NotificationSendRequest(BaseModel):
    user_id: Optional[int] = Field(None, description="Target recipient user ID (if targeted)")
    topic: Optional[str] = Field(None, description="Target topic name (e.g. 'drivers', 'clients', 'route_10')")
    title: str = Field(..., max_length=150, description="Notification title")
    body: str = Field(..., max_length=500, description="Notification body content")
    notification_type: str = Field("general", max_length=50, description="Notification category/type")
    data: Optional[Dict[str, str]] = Field(default_factory=dict, description="Custom key-value payload")


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    title: str
    body: str
    notification_type: str
    data_payload: Optional[str] = None
    is_read: bool = False
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: List[NotificationResponse]
    total: int
    unread_count: int


class NotificationDispatchResult(BaseModel):
    success: bool
    provider: str  # "fcm" or "noop"
    delivered_count: int
    failed_count: int
    message_ids: List[str] = Field(default_factory=list)
    errors: List[str] = Field(default_factory=list)
