from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from app.schemas.notification import NotificationDispatchResult


class BaseNotificationProvider(ABC):
    """Abstract interface for push notification providers (FCM, Dev No-Op, APNs)."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identifier (e.g. 'fcm', 'noop')."""
        pass

    @abstractmethod
    async def send_to_token(
        self,
        token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> bool:
        """Send a single push notification to a device token."""
        pass

    @abstractmethod
    async def send_multicast(
        self,
        tokens: List[str],
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> NotificationDispatchResult:
        """Send push notification to multiple device tokens."""
        pass

    @abstractmethod
    async def send_to_topic(
        self,
        topic: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> NotificationDispatchResult:
        """Broadcast push notification to an FCM topic."""
        pass
