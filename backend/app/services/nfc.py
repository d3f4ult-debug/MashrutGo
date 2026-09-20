"""NFC tag identifiers (shared by vehicle management and fare payment)."""
import re
from typing import Optional

_HEX_UID = re.compile(r"^[0-9A-Fa-f]{2}([:\- ]?[0-9A-Fa-f]{2}){3,15}$")


def normalize_nfc_tag(value: Optional[str]) -> Optional[str]:
    """
    NFC chip UIDs arrive as "04:a2:3b:…" (Web NFC), "04A23B…" (Android) or with dashes/spaces.
    Store and compare them as plain upper-case hex; anything else (an NDEF text payload) is kept as-is.
    """
    if value is None:
        return None
    v = value.strip()
    if not v:
        return None
    if _HEX_UID.match(v):
        return re.sub(r"[^0-9A-Fa-f]", "", v).upper()
    return v
