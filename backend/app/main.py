from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from app.api.v1.api import api_router

def create_app() -> FastAPI:
    app = FastAPI(title="Andijon Transport Starter Kit")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"] if "*" else [],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router, prefix="/api/v1")
    return app

app = create_app()
