"""The Alembic history must produce exactly the schema declared by the ORM models."""
import os
import tempfile

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

import app.models  # noqa: F401
from alembic import command
from app.db.base import Base
from app.db.init_db import alembic_config


def test_migrations_match_models():
    tmp = tempfile.mkdtemp()
    url = f"sqlite:///{os.path.join(tmp, 'migrations.db')}"
    cfg = alembic_config()
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    engine = create_engine(url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == [], f"Models and migrations drifted: {diff}"
    command.downgrade(cfg, "base")
