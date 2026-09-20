from typing import ClassVar, List, Union

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET_KEY = "dev-secret-key-please-change-to-a-random-32-byte-hex-in-production"


class Settings(BaseSettings):
    # --- Application Core ---
    app_env: str = "development"
    app_name: str = "Andijon Transport Platform"
    api_v1_prefix: str = "/api/v1"
    secret_key: str = DEV_SECRET_KEY
    access_token_expire_minutes: int = 1440
    algorithm: str = "HS256"
    cors_origins: Union[List[str], str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]
    # Public URL of the web app (used for Click return_url and notification deep links)
    public_web_url: str = "http://localhost:5173"

    # --- Database Configuration ---
    database_url: str = "sqlite:///./app.db"
    # Run `alembic upgrade head` automatically on startup (convenient for dev/MVP single-node deploys)
    auto_migrate: bool = True
    # Seed Andijon demo routes/vehicles/drivers on startup (never enable in production)
    seed_demo_data: bool = False

    # --- Map & Geocoding (MapTiler) ---
    maptiler_api_key: str = ""
    maptiler_base_url: str = "https://api.maptiler.com"

    # --- Road routing for the Route Editor (auto path A -> waypoints -> B) ---
    # "osrm" = OSRM-compatible server (self-host for production; public demo has fair-use limits)
    # "geodesic" = straight segments between points (offline/dev only, clearly labelled)
    routing_provider: str = "osrm"
    osrm_base_url: str = "https://router.project-osrm.org"
    routing_timeout_seconds: float = 10.0

    # --- Payments: Click Provider Adapter ---
    click_service_id: str = ""
    click_merchant_id: str = ""
    click_secret_key: str = ""
    click_merchant_user_id: str = ""
    click_checkout_url: str = "https://my.click.uz/services/pay"
    # Sandbox lets developers complete a top-up through the real webhook code path
    # without Click credentials. Automatically refused when app_env == "production".
    payments_sandbox: bool = False

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
    client_watch_heartbeat_timeout_seconds: int = 90
    background_sweep_interval_seconds: int = 10

    # --- Security ---
    login_max_attempts: int = 8
    login_lockout_seconds: int = 300
    # Per-address throttles for the public, unauthenticated endpoints, in requests per minute.
    # Tunable because Uzbek mobile carriers put many subscribers behind one address.
    rate_limit_route_search_per_minute: int = 30
    rate_limit_eta_per_minute: int = 90
    rate_limit_watch_start_per_minute: int = 20
    # Reverse proxies whose X-Forwarded-For may be trusted ("*" = trust any peer; only behind a
    # proxy you control). Empty (default) = ignore the header and use the real peer address.
    trusted_proxies: Union[List[str], str] = []

    @field_validator("trusted_proxies", mode="before")
    @classmethod
    def assemble_trusted_proxies(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        return list(v) if isinstance(v, (list, tuple)) else []

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        if isinstance(v, (list, str)):
            return v  # type: ignore[return-value]
        raise ValueError(v)

    # Everything that is not an explicitly recognised development environment is treated as
    # production, so a typo in APP_ENV ("staging", "live", "prd") fails closed instead of
    # enabling demo seeding, sandbox payments and the development secret key.
    DEV_ENVIRONMENTS: ClassVar[tuple] = ("development", "dev", "local", "test", "testing")

    @property
    def is_production(self) -> bool:
        return self.app_env.lower().strip() not in self.DEV_ENVIRONMENTS

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def click_configured(self) -> bool:
        values = (self.click_service_id, self.click_merchant_id, self.click_secret_key)
        return all(v and "placeholder" not in v.lower() for v in values)

    @property
    def sandbox_payments_enabled(self) -> bool:
        return self.payments_sandbox and not self.is_production

    def validate_for_runtime(self) -> None:
        """Refuse to boot with insecure defaults (fail closed outside development)."""
        if not self.is_production:
            return
        if self.secret_key == DEV_SECRET_KEY or len(self.secret_key) < 32:
            raise RuntimeError(
                "SECRET_KEY must be a random value of at least 32 characters outside development "
                "(APP_ENV is '%s'). Generate one with: python -c \"import secrets;print(secrets.token_hex(32))\"" % self.app_env
            )
        if self.seed_demo_data:
            raise RuntimeError("SEED_DEMO_DATA must be disabled outside development")
        if self.payments_sandbox:
            raise RuntimeError("PAYMENTS_SANDBOX must be disabled outside development")

    # `.env.example` is intentionally NOT loaded: example placeholders must never become runtime config.
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


settings = Settings()
