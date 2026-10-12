from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import (
    get_db_dep,
    get_current_user,
    require_super_admin,
    require_uyushma_admin,
)
from app.models.user import User
from app.schemas.notification import (
    DeviceTokenRegisterRequest,
    DeviceTokenResponse,
    DeviceTokenListResponse,
    NotificationSendRequest,
    NotificationResponse,
    NotificationListResponse,
    NotificationDispatchResult,
)
from app.services.notification.notification_service import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


# --- 1. Device Token Management ---
@router.post("/device-token", response_model=DeviceTokenResponse, status_code=status.HTTP_200_OK)
def register_device_token_endpoint(
    payload: DeviceTokenRegisterRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Register or update an FCM push device token for the authenticated user (Client, Driver, or Admin)."""
    device_token = notification_service.register_device_token(
        user_id=current_user.id,
        token=payload.token,
        platform=payload.platform,
        device_name=payload.device_name,
        db=db,
    )
    return device_token


@router.delete("/device-token", status_code=status.HTTP_200_OK)
def unregister_device_token_endpoint(
    token: str = Query(..., min_length=10, description="Device token to deactivate"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Deactivate / unregister device token on logout."""
    success = notification_service.unregister_device_token(
        user_id=current_user.id,
        token=token,
        db=db,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Qurilma tokeni topilmadi yoki bu foydalanuvchiga tegishli emas",
        )
    return {"success": True, "detail": "Qurilma tokeni nofaol qilindi"}


@router.get("/my-devices", response_model=DeviceTokenListResponse)
def list_my_devices_endpoint(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """List active registered device tokens for current authenticated user."""
    tokens = notification_service.list_user_device_tokens(user_id=current_user.id, db=db)
    return DeviceTokenListResponse(
        items=[
            DeviceTokenResponse(
                id=t.id,
                user_id=t.user_id,
                token=t.token,
                platform=t.platform,
                device_name=t.device_name,
                is_active=t.is_active,
                last_seen_at=t.last_seen_at,
                created_at=t.created_at,
            )
            for t in tokens
        ],
        total=len(tokens),
    )


# --- 2. In-App Notifications Inbox ---
@router.get("/inbox", response_model=NotificationListResponse)
def get_user_notifications_inbox(
    unread_only: bool = Query(False, description="Filter only unread notifications"),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Fetch paginated notifications history for the authenticated user."""
    items, total, unread_count = notification_service.list_user_notifications(
        user_id=current_user.id,
        unread_only=unread_only,
        skip=skip,
        limit=limit,
        db=db,
    )
    return NotificationListResponse(
        items=[
            NotificationResponse(
                id=n.id,
                user_id=n.user_id,
                title=n.title,
                body=n.body,
                notification_type=n.notification_type,
                data_payload=n.data_payload,
                is_read=n.is_read,
                created_at=n.created_at,
            )
            for n in items
        ],
        total=total,
        unread_count=unread_count,
    )


@router.post("/inbox/{id}/read", response_model=NotificationResponse)
def mark_notification_as_read(
    id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Mark a specific notification as read."""
    notif = notification_service.mark_notification_read(
        notification_id=id,
        user_id=current_user.id,
        db=db,
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Bildirishnoma topilmadi")
    return NotificationResponse(
        id=notif.id,
        user_id=notif.user_id,
        title=notif.title,
        body=notif.body,
        notification_type=notif.notification_type,
        data_payload=notif.data_payload,
        is_read=notif.is_read,
        created_at=notif.created_at,
    )


@router.post("/inbox/read-all")
def mark_all_notifications_as_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Mark all unread notifications for current user as read."""
    count = notification_service.mark_all_read(user_id=current_user.id, db=db)
    return {"success": True, "marked_count": count}


# --- 3. Push Broadcast & Targeted Messaging ---
@router.post("/broadcast", response_model=NotificationDispatchResult)
async def broadcast_notification_endpoint(
    payload: NotificationSendRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Admin broadcasts a push notification to a topic (e.g. 'drivers', 'all') or sends to a user."""
    if payload.user_id:
        result = await notification_service.send_to_user(
            user_id=payload.user_id,
            title=payload.title,
            body=payload.body,
            notification_type=payload.notification_type,
            data=payload.data,
            save_in_db=True,
            db=db,
        )
    elif payload.topic:
        result = await notification_service.send_to_topic(
            topic=payload.topic,
            title=payload.title,
            body=payload.body,
            notification_type=payload.notification_type,
            data=payload.data,
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Foydalanuvchi ID yoki mavzu (topic) ko'rsatilishi shart",
        )
    return result


# --- 4. Developer / Test Inspection Endpoint ---
@router.get("/dev-history")
def get_dev_notification_history(
    current_user: User = Depends(require_super_admin),
):
    """Super Admin inspects recent push notifications logged by Dev No-Op provider."""
    return {
        "provider": notification_service.active_provider.name,
        "history": notification_service.noop_provider.get_sent_notifications(),
    }
