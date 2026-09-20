import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  (register all models)
from app.api.v1.api import api_router
from app.core.config import settings
from app.db.init_db import run_migrations
from app.db.session import SessionLocal
from app.services.realtime.client_watch_service import client_watch_service
from app.services.realtime.tracking_service import tracking_service
from app.services.routing.providers import get_routing_provider
from app.services.seed_service import ensure_wallets, seed_bootstrap_admin, seed_demo_data

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("app")


async def background_sweeper(interval: float) -> None:
    """Stale-vehicle flagging and abandoned-watch expiry, forever."""
    while True:
        await asyncio.sleep(interval)
        try:
            db = SessionLocal()
            try:
                await tracking_service.check_and_flag_stale_vehicles(db)
                await client_watch_service.sweep_expired_watches(db)
            finally:
                db.close()
        except Exception:  # pragma: no cover - must never kill the loop
            logger.exception("Background sweep failed")


async def startup() -> None:
    settings.validate_for_runtime()
    if settings.auto_migrate:
        run_migrations()
    db = SessionLocal()
    try:
        seed_bootstrap_admin(db)
        if settings.seed_demo_data:
            await seed_demo_data(db, get_routing_provider())
        ensure_wallets(db)
        restored = tracking_service.rehydrate(db)
        if restored:
            logger.info("Restored %s active shifts into live tracking", restored)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await startup()
    sweeper = asyncio.create_task(background_sweeper(settings.background_sweep_interval_seconds))
    try:
        yield
    finally:
        sweeper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await sweeper


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        # The schema map is a development convenience; production keeps it private
        openapi_url=None if settings.is_production else f"{settings.api_v1_prefix}/openapi.json",
        docs_url=None if settings.is_production else f"{settings.api_v1_prefix}/docs",
        redoc_url=None if settings.is_production else f"{settings.api_v1_prefix}/redoc",
        lifespan=lifespan,
    )

    origins = settings.cors_origins if isinstance(settings.cors_origins, list) else [settings.cors_origins]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,  # Bearer tokens, no cookies
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.exception_handler(Exception)
    async def unhandled_exception(request: Request, exc: Exception):  # pragma: no cover
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
