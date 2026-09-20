"""
Small in-process rate limiter for public endpoints.

Single-node MVP scope: behind several workers each process keeps its own counters, so move this
to Redis (or the reverse proxy) before scaling out. It exists to blunt scraping and brute force,
not to replace a WAF.
"""
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from fastapi import HTTPException, Request, status

from app.services.audit_service import client_ip


class SlidingWindowLimiter:
    def __init__(self, max_events: int, window_seconds: float, max_keys: int = 50_000) -> None:
        self.max_events = max_events
        self.window_seconds = window_seconds
        self.max_keys = max_keys
        self._events: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            window = self._events[key]
            while window and now - window[0] > self.window_seconds:
                window.popleft()
            if len(window) >= self.max_events:
                return False
            window.append(now)
            if len(self._events) > self.max_keys:
                for stale in [k for k, w in self._events.items() if not w or now - w[-1] > self.window_seconds]:
                    self._events.pop(stale, None)
            return True

    def check(self, key: Optional[str], detail: str) -> None:
        if key is None:
            return
        if not self.allow(key):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=detail,
                headers={"Retry-After": str(int(self.window_seconds))},
            )


def limit_by_ip(limiter: SlidingWindowLimiter, request: Request, detail: str) -> None:
    limiter.check(client_ip(request), detail)


# Anonymous vehicle lookups: enough for a passenger who mistypes, far below fleet enumeration
vehicle_lookup_limiter = SlidingWindowLimiter(max_events=30, window_seconds=60)
# Public sign-up: slows down account/phone enumeration
registration_limiter = SlidingWindowLimiter(max_events=5, window_seconds=600)
