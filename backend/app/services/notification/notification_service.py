import json
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.system import DeviceToken, Notification
from app.schemas.notification import NotificationDispatchResult
from app.services.notification.base import BaseNotificationProvider
from app.services.notification.noop_provider import DevNoOpNotificationProvider
from app.services.notification.fcm_provider import FCMNotificationProvider

logger = logging.getLogger(__name__)


class NotificationService:
    """Central notification management service.
    Handles device token registration, in-app notification inbox, and push dispatch
    via FCM or Dev No-Op provider.
    """

    def __init__(self, provider: Optional[BaseNotificationProvider] = None):
        self.noop_provider = DevNoOpNotificationProvider()
        self.fcm_provider = FCMNotificationProvider()

        if provider:
            self._active_provider = provider
        elif settings.fcm_enabled and self.fcm_provider.is_active:
            self._active_provider = self.fcm_provider
        else:
            self._active_provider = self.noop_provider

    @property
    def active_provider(self) -> BaseNotificationProvider:
        return self._active_provider

    def set_provider(self, provider: BaseNotificationProvider) -> None:
        """Dynamically override active provider (useful for testing)."""
        self._active_provider = provider

    # --- Device Token Management ---
    def register_device_token(
        self,
        user_id: int,
        token: str,
        platform: str = "android",
        device_name: Optional[str] = None,
        db: Session = None,
    ) -> DeviceToken:
        """Register or refresh an FCM push device token for a user."""
        now = datetime.now(timezone.utc)
        existing = db.query(DeviceToken).filter(DeviceToken.token == token).first()

        if existing:
            existing.user_id = user_id
            existing.platform = platform
            if device_name:
                existing.device_name = device_name
            existing.is_active = True
            existing.last_seen_at = now
            existing.updated_at = now
            db.commit()
            db.refresh(existing)
            logger.info(f"Updated device token for user_id={user_id}, platform={platform}")
            return existing

        dev_token = DeviceToken(
            user_id=user_id,
            token=token,
            platform=platform,
            device_name=device_name,
            is_active=True,
            last_seen_at=now,
            created_at=now,
            updated_at=now,
        )
        db.add(dev_token)
        db.commit()
        db.refresh(dev_token)
        logger.info(f"Registered new device token for user_id={user_id}, platform={platform}")
        return dev_token

    def unregister_device_token(
        self,
        user_id: int,
        token: str,
        db: Session,
    ) -> bool:
        """Deactivate a device token upon user logout."""
        record = (
            db.query(DeviceToken)
            .filter(DeviceToken.token == token, DeviceToken.user_id == user_id)
            .first()
        )
        if record:
            record.is_active = False
            record.updated_at = datetime.now(timezone.utc)
            db.commit()
            logger.info(f"Deactivated device token for user_id={user_id}")
            return True
        return False

    def list_user_device_tokens(
        self,
        user_id: int,
        db: Session,
    ) -> List[DeviceToken]:
        """Fetch all active device tokens registered for this user."""
        return (
            db.query(DeviceToken)
            .filter(DeviceToken.user_id == user_id, DeviceToken.is_active.is_(True))
            .all()
        )

    # --- Push Dispatch ---
    async def send_to_user(
        self,
        user_id: int,
        title: str,
        body: str,
        notification_type: str = "general",
        data: Optional[Dict[str, str]] = None,
        save_in_db: bool = True,
        db: Session = None,
    ) -> NotificationDispatchResult:
        """Send push notification to all active devices of a user and optionally store in DB."""
        # 1. Optionally persist to in-app notifications
        if save_in_db and db is not None:
            now = datetime.now(timezone.utc)
            notif = Notification(
                user_id=user_id,
                title=title,
                body=body,
                notification_type=notification_type,
                data_payload=json.dumps(data) if data else None,
                is_read=False,
                created_at=now,
            )
            db.add(notif)
            db.commit()

        # 2. Collect user's active device tokens
        tokens: List[str] = []
        if db is not None:
            active_tokens = self.list_user_device_tokens(user_id=user_id, db=db)
            tokens = [dt.token for dt in active_tokens]

        if not tokens:
            logger.info(f"No active device tokens found for user_id={user_id}. Recorded in DB only.")
            return NotificationDispatchResult(
                success=True,
                provider=self.active_provider.name,
                delivered_count=0,
                failed_count=0,
                message_ids=[],
                errors=[],
            )

        # 3. Dispatch via active provider
        return await self.active_provider.send_multicast(
            tokens=tokens,
            title=title,
            body=body,
            data=data,
        )

    async def send_to_topic(
        self,
        topic: str,
        title: str,
        body: str,
        notification_type: str = "broadcast",
        data: Optional[Dict[str, str]] = None,
    ) -> NotificationDispatchResult:
        """Broadcast push notification to an FCM topic."""
        return await self.active_provider.send_to_topic(
            topic=topic,
            title=title,
            body=body,
            data=data,
        )

    # --- In-App Notifications Inbox ---
    def list_user_notifications(
        self,
        user_id: int,
        unread_only: bool = False,
        skip: int = 0,
        limit: int = 20,
        db: Session = None,
    ) -> Tuple[List[Notification], int, int]:
        """Fetch paginated notifications for user inbox, returning (items, total, unread_count)."""
        query = db.query(Notification).filter(Notification.user_id == user_id)
        unread_count = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.is_read.is_(False))
            .count()
        )

        if unread_only:
            query = query.filter(Notification.is_read.is_(False))

        total = query.count()
        items = query.order_by(Notification.id.desc()).offset(skip).limit(limit).all()
        return items, total, unread_count

    def mark_notification_read(
        self,
        notification_id: int,
        user_id: int,
        db: Session,
    ) -> Optional[Notification]:
        """Mark specific notification as read."""
        notif = (
            db.query(Notification)
            .filter(Notification.id == notification_id, Notification.user_id == user_id)
            .first()
        )
        if notif:
            notif.is_read = True
            db.commit()
            db.refresh(notif)
        return notif

    def mark_all_read(
        self,
        user_id: int,
        db: Session,
    ) -> int:
        """Mark all unread notifications for user as read."""
        updated = (
            db.query(Notification)
            .filter(Notification.user_id == user_id, Notification.is_read.is_(False))
            .update({"is_read": True})
        )
        db.commit()
        return updated


notification_service = NotificationService()
