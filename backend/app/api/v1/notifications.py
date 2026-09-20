import json
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db_dep
from app.models.system import DeviceToken, Notification
from app.models.user import User
from app.schemas.misc import DeviceTokenRegister, NotificationRead

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/device-token", status_code=status.HTTP_204_NO_CONTENT)
def register_device_token(
    payload: DeviceTokenRegister,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Bind an FCM token to the signed-in user (re-binding moves it from a previous account)."""
    token = db.query(DeviceToken).filter(DeviceToken.token == payload.token).first()
    now = datetime.now(timezone.utc)
    if token:
        token.user_id = current_user.id
        token.platform = payload.platform
        token.app_version = payload.app_version
        token.is_active = True
        token.last_seen_at = now
    else:
        db.add(DeviceToken(user_id=current_user.id, token=payload.token, platform=payload.platform,
                           app_version=payload.app_version, is_active=True, last_seen_at=now))
    db.commit()


@router.delete("/device-token", status_code=status.HTTP_204_NO_CONTENT)
def unregister_device_token(
    token: str = Query(..., min_length=20, max_length=512),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Called on logout so the device stops receiving this user's pushes."""
    db.query(DeviceToken).filter(DeviceToken.token == token, DeviceToken.user_id == current_user.id).update({"is_active": False})
    db.commit()


@router.get("/me", response_model=List[NotificationRead])
def my_notifications(
    limit: int = Query(50, ge=1, le=200),
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.is_read.is_(False))
    rows = q.order_by(Notification.id.desc()).limit(limit).all()
    return [
        NotificationRead(id=n.id, title=n.title, body=n.body, notification_type=n.notification_type,
                         data=json.loads(n.data_payload or "{}"), is_read=n.is_read, created_at=n.created_at)
        for n in rows
    ]


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(notification_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db_dep)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == current_user.id).first()
    if not n:
        raise HTTPException(status_code=404, detail="Notification not found")
    n.is_read = True
    db.commit()
