import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any

from app.services.notification.base import BaseNotificationProvider
from app.schemas.notification import NotificationDispatchResult

logger = logging.getLogger(__name__)


class DevNoOpNotificationProvider(BaseNotificationProvider):
    """Local / Development fallback notification provider.
    Active when FCM credentials are missing or fcm_enabled=False.
    Logs dispatches and maintains an in-memory history for testing and verification.
    """

    def __init__(self):
        self._sent_history: List[Dict[str, Any]] = []

    @property
    def name(self) -> str:
        return "noop"

    async def send_to_token(
        self,
        token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> bool:
        message_id = f"noop-{uuid.uuid4().hex[:12]}"
        entry = {
            "id": message_id,
            "target_type": "token",
            "token": token,
            "title": title,
            "body": body,
            "data": data or {},
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        self._sent_history.append(entry)
        logger.info(
            f"[NoOpNotification] Sent to token={token[:12]}... | Title='{title}' | Body='{body}'"
        )
        return True

    async def send_multicast(
        self,
        tokens: List[str],
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> NotificationDispatchResult:
        if not tokens:
            return NotificationDispatchResult(
                success=True,
                provider=self.name,
                delivered_count=0,
                failed_count=0,
                message_ids=[],
                errors=[],
            )

        message_ids = []
        for t in tokens:
            mid = f"noop-{uuid.uuid4().hex[:12]}"
            message_ids.append(mid)
            self._sent_history.append({
                "id": mid,
                "target_type": "multicast_token",
                "token": t,
                "title": title,
                "body": body,
                "data": data or {},
                "sent_at": datetime.now(timezone.utc).isoformat(),
            })

        logger.info(
            f"[NoOpNotification] Multicast to {len(tokens)} tokens | Title='{title}'"
        )
        return NotificationDispatchResult(
            success=True,
            provider=self.name,
            delivered_count=len(tokens),
            failed_count=0,
            message_ids=message_ids,
            errors=[],
        )

    async def send_to_topic(
        self,
        topic: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> NotificationDispatchResult:
        mid = f"noop-topic-{uuid.uuid4().hex[:12]}"
        self._sent_history.append({
            "id": mid,
            "target_type": "topic",
            "topic": topic,
            "title": title,
            "body": body,
            "data": data or {},
            "sent_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(
            f"[NoOpNotification] Broadcast to topic '{topic}' | Title='{title}' | Body='{body}'"
        )
        return NotificationDispatchResult(
            success=True,
            provider=self.name,
            delivered_count=1,
            failed_count=0,
            message_ids=[mid],
            errors=[],
        )

    def get_sent_notifications(self) -> List[Dict[str, Any]]:
        """Retrieve copy of all in-memory sent notification payloads."""
        return list(self._sent_history)

    def clear_history(self) -> None:
        """Reset sent history (useful for test isolation)."""
        self._sent_history.clear()
