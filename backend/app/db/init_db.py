"""Schema management: Alembic migrations are the source of truth for the database schema."""
import logging
from pathlib import Path

from sqlalchemy import inspect

from app.core.config import settings
from app.db.session import engine

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parents[2]


class LegacySchemaError(RuntimeError):
    pass


def alembic_config():
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    cfg.attributes["configure_logger"] = False
    return cfg


def run_migrations() -> None:
    """Apply pending migrations (`alembic upgrade head`)."""
    from alembic import command

    tables = set(inspect(engine).get_table_names())
    if tables and "alembic_version" not in tables:
        raise LegacySchemaError(
            "Database has tables but no Alembic version (created by an old build via create_all). "
            "For local SQLite dev data: delete the database file and restart. For real data: back it up, "
            "then run `alembic stamp head` only if the schema already matches the latest migration."
        )
    command.upgrade(alembic_config(), "head")
    logger.info("Database schema is up to date")
