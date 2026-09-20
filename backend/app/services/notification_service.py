"""
Notification service.

Every notification is persisted (in-app history, `GET /notifications/me`) and optionally pushed
to the user's registered devices. The push transport is a provider:
- FCMPushProvider: Firebase Cloud Messaging HTTP v1 (service-account OAuth2, RS256 JWT grant);
- NoopPushProvider: used when FCM is disabled/unconfigured (local/dev) — logs and skips.
"""
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol

import httpx
from jose import jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.system import DeviceToken, Notification
from app.services.settings_service import get_setting

logger = logging.getLogger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"


class PushProvider(Protocol):
    name: str

    def send(self, token: str, title: str, body: str, data: Dict[str, str]) -> bool: ...


class NoopPushProvider:
    name = "noop"

    def send(self, token: str, title: str, body: str, data: Dict[str, str]) -> bool:
        logger.info("[push:noop] %s -> %s…: %s", title, token[:12], body)
        return False


class FCMPushProvider:
    name = "fcm"

    def __init__(self, credentials_path: str, project_id: str) -> None:
        self._credentials = json.loads(Path(credentials_path).read_text())
        self._project_id = project_id or self._credentials.get("project_id", "")
        self._access_token: Optional[str] = None
        self._token_expiry = 0.0
        self._lock = threading.Lock()

    def _get_access_token(self) -> str:
        with self._lock:
            if self._access_token and time.time() < self._token_expiry - 60:
                return self._access_token
            now = int(time.time())
            assertion = jwt.encode(
                {
                    "iss": self._credentials["client_email"],
                    "scope": FCM_SCOPE,
                    "aud": self._credentials.get("token_uri", "https://oauth2.googleapis.com/token"),
                    "iat": now,
                    "exp": now + 3600,
                },
                self._credentials["private_key"],
                algorithm="RS256",
            )
            resp = httpx.post(
                self._credentials.get("token_uri", "https://oauth2.googleapis.com/token"),
                data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
                timeout=10.0,
            )
            resp.raise_for_status()
            payload = resp.json()
            self._access_token = payload["access_token"]
            self._token_expiry = time.time() + int(payload.get("expires_in", 3600))
            return self._access_token

    def send(self, token: str, title: str, body: str, data: Dict[str, str]) -> bool:
        url = f"https://fcm.googleapis.com/v1/projects/{self._project_id}/messages:send"
        message = {
            "message": {
                "token": token,
                "notification": {"title": title, "body": body},
                "data": data,
                "android": {"priority": "high"},
            }
        }
        try:
            resp = httpx.post(
                url,
                json=message,
                headers={"Authorization": f"Bearer {self._get_access_token()}"},
                timeout=10.0,
            )
        except httpx.HTTPError as exc:
            logger.warning("FCM send error: %s", exc)
            return False
        if resp.status_code == 404 or (resp.status_code == 400 and "UNREGISTERED" in resp.text):
            _deactivate_token(token)
        if resp.status_code >= 300:
            logger.warning("FCM send failed (%s): %s", resp.status_code, resp.text[:300])
            return False
        return True


def _deactivate_token(token: str) -> None:
    db = SessionLocal()
    try:
        db.query(DeviceToken).filter(DeviceToken.token == token).update({"is_active": False})
        db.commit()
    finally:
        db.close()


_provider: Optional[PushProvider] = None


def get_push_provider() -> PushProvider:
    global _provider
    if _provider is not None:
        return _provider
    if settings.fcm_enabled and Path(settings.fcm_credentials_path).is_file():
        try:
            _provider = FCMPushProvider(settings.fcm_credentials_path, settings.fcm_project_id)
            return _provider
        except (OSError, ValueError, KeyError) as exc:
            logger.error("FCM credentials invalid, falling back to no-op push: %s", exc)
    elif settings.fcm_enabled:
        logger.error("FCM_ENABLED=true but credentials file %s is missing", settings.fcm_credentials_path)
    _provider = NoopPushProvider()
    return _provider


def create_notification(
    db: Session,
    user_id: int,
    title: str,
    body: str,
    notification_type: str,
    data: Optional[Dict[str, Any]] = None,
) -> Notification:
    """Persist an in-app notification (caller commits)."""
    notification = Notification(
        user_id=user_id,
        title=title[:150],
        body=body[:500],
        notification_type=notification_type,
        data_payload=json.dumps(data or {}, ensure_ascii=False, default=str),
        push_status="skipped",
    )
    db.add(notification)
    return notification


def push_to_user(notification_id: int) -> None:
    """
    Deliver a persisted notification to the user's active devices.
    Designed to run as a FastAPI background task (outside the request transaction).
    """
    db = SessionLocal()
    try:
        notification = db.query(Notification).filter(Notification.id == notification_id).first()
        if notification is None or notification.user_id is None:
            return
        if not get_setting(db, "fcm_notifications_enabled"):
            return
        tokens: List[str] = [
            t.token
            for t in db.query(DeviceToken)
            .filter(DeviceToken.user_id == notification.user_id, DeviceToken.is_active.is_(True))
            .all()
        ]
        if not tokens:
            return
        data = {k: str(v) for k, v in json.loads(notification.data_payload or "{}").items()}
        data.setdefault("type", notification.notification_type)
        provider = get_push_provider()
        results = [provider.send(token, notification.title, notification.body, data) for token in tokens]
        notification.push_status = "sent" if any(results) else ("skipped" if provider.name == "noop" else "failed")
        db.commit()
    except Exception:  # pragma: no cover - never let push failures surface to users
        logger.exception("Push delivery failed for notification %s", notification_id)
    finally:
        db.close()
