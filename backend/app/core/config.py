from pydantic import BaseSettings
from typing import List

class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./app.db"
    secret_key: str = "change-me"
    cors_origins: List[str] = ["http://localhost:5173"]

    class Config:
        env_file = "../.env.example"

settings = Settings()
