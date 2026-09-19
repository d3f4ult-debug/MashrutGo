import os
from typing import List, Union
from pydantic import field_validator

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    PYDANTIC_V2 = True
except ImportError:
    from pydantic import BaseSettings  # type: ignore
    PYDANTIC_V2 = False


class Settings(BaseSettings):
    # --- Application Core ---
    app_env: str = "development"
    app_name: str = "Andijon Transport Platform"
    api_v1_prefix: str = "/api/v1"
    secret_key: str = "dev-secret-key-please-change-to-a-random-32-byte-hex-in-production"
    access_token_expire_minutes: int = 1440
    algorithm: str = "HS256"
    cors_origins: Union[List[str], str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    # --- Database Configuration ---
    database_url: str = "sqlite:///./app.db"

    # --- Map & Geocoding & Routing Provider (MapTiler) ---
    maptiler_api_key: str = ""
    maptiler_base_url: str = "https://api.maptiler.com"

    # --- Payments: Click Provider Adapter ---
    click_service_id: str = ""
    click_merchant_id: str = ""
    click_secret_key: str = ""
    click_merchant_user_id: str = ""

    # --- Payments: Future Adapters ---
    payme_merchant_id: str = ""
    payme_secret_key: str = ""
    uzum_merchant_id: str = ""
    uzum_secret_key: str = ""

    # --- Push Notifications: FCM ---
    fcm_enabled: bool = False
    fcm_project_id: str = ""
    fcm_credentials_path: str = "./fcm-service-account.json"

    # --- Realtime, Tracking & GPS Thresholds ---
    gps_stale_threshold_seconds: int = 45
    parking_geofence_default_radius_meters: int = 100
    client_watch_heartbeat_timeout_seconds: int = 60

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, (list, str)):
            return v  # type: ignore
        raise ValueError(v)

    if PYDANTIC_V2:
        model_config = SettingsConfigDict(
            env_file=(".env", "../.env", ".env.example"),
            env_file_encoding="utf-8",
            extra="ignore",
            case_sensitive=False,
        )
    else:
        class Config:
            env_file = (".env", "../.env", ".env.example")
            extra = "ignore"
            case_sensitive = False


settings = Settings()
