from typing import Generator
from app.db.session import get_db

def get_db_dep() -> Generator:
    yield from get_db()
