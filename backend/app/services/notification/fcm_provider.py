import logging
import os
from typing import List, Optional, Dict, Any

from app.core.config import settings
from app.services.notification.base import BaseNotificationProvider
from app.schemas.notification import NotificationDispatchResult

logger = logging.getLogger(__name__)


class FCMNotificationProvider(BaseNotificationProvider):
    """Google Firebase Cloud Messaging (FCM) HTTP v1 Provider.
    If credentials file exists and fcm_enabled=True, initializes firebase-admin SDK.
    Otherwise gracefully warns and falls back to simulated dispatch without errors.
    """

    def __init__(self):
        self._initialized = False
        self._firebase_app = None
        self._init_fcm()

    def _init_fcm(self) -> None:
        if not settings.fcm_enabled:
            logger.info("FCM is disabled in settings (fcm_enabled=False). Running in no-op mode.")
            return

        cred_path = settings.fcm_credentials_path
        if not os.path.exists(cred_path):
            logger.warning(
                f"FCM credentials file not found at '{cred_path}'. "
                "FCM provider will simulate dispatch until valid service-account.json is provided."
            )
            return

        try:
            import firebase_admin
            from firebase_admin import credentials

            if not firebase_admin._apps:
                cred = credentials.Certificate(cred_path)
                self._firebase_app = firebase_admin.initialize_app(cred)
            else:
                self._firebase_app = firebase_admin.get_app()

            self._initialized = True
            logger.info("Firebase Cloud Messaging (FCM) successfully initialized.")
        except ImportError:
            logger.warning(
                "Package 'firebase-admin' is not installed. FCM provider operating in mock mode."
            )
        except Exception as e:
            logger.error(f"Failed to initialize Firebase Admin SDK: {e}")

    @property
    def name(self) -> str:
        return "fcm"

    @property
    def is_active(self) -> bool:
        return self._initialized

    async def send_to_token(
        self,
        token: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> bool:
        if not self._initialized:
            logger.debug(f"[FCM Mock] Simulated send to token={token[:10]}...: '{title}'")
            return True

        try:
            from firebase_admin import messaging

            message = messaging.Message(
                notification=messaging.Notification(
                    title=title,
                    body=body,
                ),
                data={k: str(v) for k, v in (data or {}).items()},
                token=token,
            )
            response = messaging.send(message)
            logger.info(f"[FCM] Successfully sent message {response} to token {token[:10]}...")
            return True
        except Exception as e:
            logger.error(f"[FCM] Error sending message to token {token[:10]}...: {e}")
            return False

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
            )

        if not self._initialized:
            logger.debug(f"[FCM Mock] Simulated multicast to {len(tokens)} tokens: '{title}'")
            return NotificationDispatchResult(
                success=True,
                provider=self.name,
                delivered_count=len(tokens),
                failed_count=0,
                message_ids=[f"fcm-mock-{i}" for i in range(len(tokens))],
            )

        try:
            from firebase_admin import messaging

            message = messaging.MulticastMessage(
                notification=messaging.Notification(
                    title=title,
                    body=body,
                ),
                data={k: str(v) for k, v in (data or {}).items()},
                tokens=tokens,
            )
            batch_response = messaging.send_multicast(message)
            errors = []
            message_ids = []
            for resp in batch_response.responses:
                if resp.success:
                    message_ids.append(resp.message_id)
                else:
                    errors.append(str(resp.exception))

            return NotificationDispatchResult(
                success=batch_response.failure_count == 0,
                provider=self.name,
                delivered_count=batch_response.success_count,
                failed_count=batch_response.failure_count,
                message_ids=message_ids,
                errors=errors,
            )
        except Exception as e:
            logger.error(f"[FCM] Multicast exception: {e}")
            return NotificationDispatchResult(
                success=False,
                provider=self.name,
                delivered_count=0,
                failed_count=len(tokens),
                errors=[str(e)],
            )

    async def send_to_topic(
        self,
        topic: str,
        title: str,
        body: str,
        data: Optional[Dict[str, str]] = None,
    ) -> NotificationDispatchResult:
        if not self._initialized:
            logger.debug(f"[FCM Mock] Simulated send to topic '{topic}': '{title}'")
            return NotificationDispatchResult(
                success=True,
                provider=self.name,
                delivered_count=1,
                failed_count=0,
                message_ids=[f"fcm-topic-mock-{topic}"],
            )

        try:
            from firebase_admin import messaging

            message = messaging.Message(
                notification=messaging.Notification(
                    title=title,
                    body=body,
                ),
                data={k: str(v) for k, v in (data or {}).items()},
                topic=topic,
            )
            response = messaging.send(message)
            return NotificationDispatchResult(
                success=True,
                provider=self.name,
                delivered_count=1,
                failed_count=0,
                message_ids=[response],
            )
        except Exception as e:
            logger.error(f"[FCM] Topic send error for topic '{topic}': {e}")
            return NotificationDispatchResult(
                success=False,
                provider=self.name,
                delivered_count=0,
                failed_count=1,
                errors=[str(e)],
            )
