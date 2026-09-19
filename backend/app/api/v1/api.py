from fastapi import APIRouter
from app.api.v1.health import router as health_router
from app.api.v1.auth import router as auth_router
from app.api.v1.uyushma import router as uyushma_router
from app.api.v1.routes import router as routes_router
from app.api.v1.routing import router as routing_router
from app.api.v1.driver import router as driver_router
from app.api.v1.parking import router as parking_router
from app.api.v1.websocket import router as ws_router
from app.api.v1.client_watch import router as client_watch_router, driver_router as client_driver_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(uyushma_router)
api_router.include_router(routes_router)
api_router.include_router(routing_router)
api_router.include_router(driver_router)
api_router.include_router(client_driver_router)
api_router.include_router(client_watch_router)
api_router.include_router(parking_router)
api_router.include_router(ws_router)
