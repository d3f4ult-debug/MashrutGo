import uuid
import httpx
import logging
from typing import Optional, Dict, Any
from app.core.config import settings

logger = logging.getLogger(__name__)

DEVSMS_API_URL = "https://devsms.uz/api/v1/sms"
DEVSMS_BALANCE_URL = "https://devsms.uz/api/v1/balance"


class DevSMSService:
    """Service to send SMS & OTP verification codes via DevSMS.uz API v1."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or getattr(settings, "devsms_api_key", "185c8a1dff0cf6b047a6526ba07bb32d6d34f4a606feddd21a713e9a85673a85")

    async def get_balance(self) -> Dict[str, Any]:
        """Fetch current balance and SMS rates from DevSMS."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
        }
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(DEVSMS_BALANCE_URL, headers=headers)
            return resp.json()

    async def send_otp(self, phone: str, code: str, template_type: int = 4) -> Dict[str, Any]:
        """Send Universal OTP via DevSMS.uz.
        
        template_type:
            1 - confirm an operation
            2 - password reset
            3 - sign up
            4 - sign in
        """
        # Clean phone to 12 digits (998901234567)
        clean_phone = "".join(filter(str.isdigit, phone))
        if clean_phone.startswith("88"):
            pass
        elif not clean_phone.startswith("998") and len(clean_phone) == 9:
            clean_phone = f"998{clean_phone}"

        idempotency_key = str(uuid.uuid4())
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key,
        }

        payload = {
            "phone": clean_phone,
            "otp": {
                "template_type": template_type,
                "service_name": "MashrutGo",
                "code": str(code),
            },
        }

        logger.info(f"Sending DevSMS OTP to {clean_phone} with code {code}")
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(DEVSMS_API_URL, json=payload, headers=headers)
            data = resp.json()
            logger.info(f"DevSMS response: {data}")
            return data


devsms_service = DevSMSService()
