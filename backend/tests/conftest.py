"""
Test harness: every test session runs against a fresh, migrated SQLite database in a temp dir
(never the developer's app.db). Environment is fixed BEFORE the app is imported.
"""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="mashrutgo-tests-")
os.environ.update(
    {
        "APP_ENV": "test",
        "DATABASE_URL": f"sqlite:///{_TMP}/test.db",
        "ROUTING_PROVIDER": "geodesic",
        "SEED_DEMO_DATA": "false",
        "PAYMENTS_SANDBOX": "true",
        "MAPTILER_API_KEY": "",
        "CLICK_SERVICE_ID": "",
        "CLICK_MERCHANT_ID": "",
        "CLICK_SECRET_KEY": "",
        "FCM_ENABLED": "false",
        "BACKGROUND_SWEEP_INTERVAL_SECONDS": "3600",
    }
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db.init_db import run_migrations  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.services.seed_service import seed_bootstrap_admin  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    run_migrations()
    db = SessionLocal()
    try:
        seed_bootstrap_admin(db)
    finally:
        db.close()
    yield


@pytest.fixture(scope="session")
def client(migrated_database):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
