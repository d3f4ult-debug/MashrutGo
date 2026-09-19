import pytest
from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.services.seed_service import seed_initial_data
import app.models  # noqa: F401


@pytest.fixture(scope="session", autouse=True)
def init_test_db():
    """Ensure all database tables and seed data are created before tests run."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_initial_data(db)
    finally:
        db.close()
    yield
