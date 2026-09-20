from fastapi import APIRouter

from app.api.v1.admin import router as admin_router
from app.api.v1.auth import router as auth_router
from app.api.v1.client_watch import router as client_watch_router
from app.api.v1.driver import router as driver_router
from app.api.v1.eta import router as eta_router
from app.api.v1.geo import router as geo_router
from app.api.v1.health import router as health_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.operations import router as operations_router
from app.api.v1.parking import router as parking_router
from app.api.v1.payments import payments_router, wallet_router
from app.api.v1.routes import router as routes_router
from app.api.v1.routing import router as routing_router
from app.api.v1.uyushma import router as uyushma_router
from app.api.v1.websocket import router as ws_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(uyushma_router)
api_router.include_router(routes_router)
api_router.include_router(routing_router)
api_router.include_router(eta_router)
api_router.include_router(geo_router)
api_router.include_router(driver_router)
api_router.include_router(client_watch_router)
api_router.include_router(parking_router)
api_router.include_router(wallet_router)
api_router.include_router(payments_router)
api_router.include_router(operations_router)
api_router.include_router(notifications_router)
api_router.include_router(admin_router)
api_router.include_router(ws_router)
