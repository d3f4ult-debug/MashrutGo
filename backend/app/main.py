from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from starlette.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.api import api_router
from app.db.base import Base
from app.db.session import engine, SessionLocal
from app.services.seed_service import seed_initial_data
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize tables on startup
    Base.metadata.create_all(bind=engine)
    # Seed initial administrative and demo data
    db = SessionLocal()
    try:
        seed_initial_data(db)
    finally:
        db.close()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        openapi_url=f"{settings.api_v1_prefix}/openapi.json",
        docs_url=f"{settings.api_v1_prefix}/docs",
        redoc_url=f"{settings.api_v1_prefix}/redoc",
        lifespan=lifespan,
    )

    origins = settings.cors_origins if isinstance(settings.cors_origins, list) else ["*"]
    if "*" not in origins and "http://localhost:5173" not in origins:
        origins.append("http://localhost:5173")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins if origins else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    import os
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse

    frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist"))
    if os.path.exists(frontend_dist) and os.path.exists(os.path.join(frontend_dist, "index.html")):
        assets_dir = os.path.join(frontend_dist, "assets")
        if os.path.exists(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_frontend(full_path: str):
            if full_path.startswith("api") or full_path.startswith("docs") or full_path.startswith("openapi.json"):
                return None
            target = os.path.join(frontend_dist, full_path)
            if os.path.isfile(target):
                return FileResponse(target)
            return FileResponse(os.path.join(frontend_dist, "index.html"))
    else:
        @app.get("/", include_in_schema=False)
        def root_redirect():
            return RedirectResponse(url=f"{settings.api_v1_prefix}/docs")

        @app.get("/docs", include_in_schema=False)
        def docs_redirect():
            return RedirectResponse(url=f"{settings.api_v1_prefix}/docs")

    return app


app = create_app()
