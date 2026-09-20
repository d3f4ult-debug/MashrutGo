"""Realtime operations for Uyushma/Admin dashboards (driver details are never public)."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, require_uyushma_admin, verify_tenant_access
from app.core.roles import UserRole
from app.models.shift import DriverShift
from app.models.transport import Vehicle
from app.models.user import User
from app.schemas.misc import LiveFleetVehicle
from app.services.realtime.tracking_service import tracking_service

router = APIRouter(prefix="/operations", tags=["operations"])


@router.get("/live-fleet", response_model=List[LiveFleetVehicle])
def live_fleet(
    uyushma_id: Optional[int] = Query(None),
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """
    Every vehicle on an active shift (including ones without a fresh GPS fix — they are shown as
    'awaiting_gps'/'stale', never as "no transport"). Uyushma admins only see their own fleet.
    """
    scope = uyushma_id
    if current_user.role == UserRole.UYUSHMA_ADMIN.value:
        scope = current_user.uyushma_id
        if scope is None:
            # Defensive: an Uyushma admin detached from their tenant sees nothing, not everything
            raise HTTPException(status_code=403, detail="Uyushma biriktirilmagan")
    elif scope is not None:
        verify_tenant_access(current_user, scope)

    q = db.query(DriverShift).join(Vehicle, Vehicle.id == DriverShift.vehicle_id).filter(DriverShift.status == "active")
    if scope is not None:
        q = q.filter(Vehicle.uyushma_id == scope)

    result = []
    for shift in q.all():
        vehicle, driver = shift.vehicle, shift.driver
        state = tracking_service.get_state(vehicle.id)
        has_fix = bool(state and state.has_fix)
        if not has_fix:
            shift_status = "awaiting_gps"
        elif state.is_stale:
            shift_status = "stale"
        elif state.parking_id:
            shift_status = "in_parking"
        else:
            shift_status = "on_route"
        result.append(LiveFleetVehicle(
            vehicle_pk=vehicle.id,
            vehicle_id=vehicle.internal_id,
            plate_number=vehicle.plate_number,
            model=vehicle.model,
            color=vehicle.color,
            driver_id=driver.id,
            driver_name=driver.user.full_name,
            driver_phone=driver.user.phone,
            uyushma_id=vehicle.uyushma_id,
            uyushma_name=vehicle.uyushma.name,
            route_id=shift.route_id,
            route_number=shift.route.route_number if shift.route else "",
            route_name=shift.route.name if shift.route else None,
            direction=shift.direction,
            has_fix=has_fix,
            lat=state.lat if has_fix else None,
            lng=state.lng if has_fix else None,
            heading=state.heading if has_fix else 0.0,
            speed_kmh=state.speed_kmh if has_fix else 0.0,
            shift_status=shift_status,
            shift_started_at=shift.started_at,
            last_seen=state.captured_at if has_fix else None,
            is_stale=bool(state.is_stale) if has_fix else False,
            parking_id=state.parking_id if has_fix else None,
            parking_name=state.parking_name if has_fix else None,
        ))
    return result
