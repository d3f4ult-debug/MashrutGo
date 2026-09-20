from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    """
    Timezone-aware UTC timestamps on every database backend.

    SQLite cannot store an offset, so plain `DateTime(timezone=True)` columns come back naive
    there while PostgreSQL returns aware values. Normalising at the column type means API
    responses always carry an explicit UTC offset (clients never guess the zone) and code can
    compare DB values with `datetime.now(timezone.utc)` on both backends. The storage type is
    unchanged, so no migration is needed.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value: Optional[datetime], dialect) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value: Optional[datetime], dialect) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)
