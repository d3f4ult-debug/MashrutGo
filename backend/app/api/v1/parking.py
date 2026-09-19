from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep, require_uyushma_admin, verify_tenant_access
from app.core.roles import UserRole
from app.models.transport import Parking
from app.models.user import User
from app.schemas.driver import LiveVehicleStateResponse, ParkingCreateRequest, ParkingResponse
from app.services.audit_service import log_audit_event
from app.services.realtime.tracking_service import tracking_service

router = APIRouter(prefix="/parkings", tags=["parkings"])


@router.get("", response_model=List[ParkingResponse])
def list_parkings(db: Session = Depends(get_db_dep)):
    """List all registered stayankas (parkings) with current live vehicle counts."""
    parkings = db.query(Parking).filter(Parking.is_active.is_(True)).all()
    results = []
    for p in parkings:
        count = tracking_service.get_parking_vehicle_count(p.id)
        results.append(
            ParkingResponse(
                id=p.id,
                name=p.name,
                lat=p.lat,
                lng=p.lng,
                radius_meters=p.radius_meters,
                capacity=p.capacity,
                is_active=p.is_active,
                vehicle_count=count,
                created_at=p.created_at,
            )
        )
    return results


@router.post("", response_model=ParkingResponse, status_code=status.HTTP_201_CREATED)
def create_parking(
    payload: ParkingCreateRequest,
    current_user: User = Depends(require_uyushma_admin),
    db: Session = Depends(get_db_dep),
):
    """Create new Stayanka parking with configurable geofence radius."""
    target_uyushma_id = payload.uyushma_id
    if current_user.role == UserRole.UYUSHMA_ADMIN.value:
        target_uyushma_id = current_user.uyushma_id

    if target_uyushma_id is not None:
        verify_tenant_access(current_user, target_uyushma_id)

    parking = Parking(
        name=payload.name,
        lat=payload.lat,
        lng=payload.lng,
        radius_meters=payload.radius_meters,
        capacity=payload.capacity,
        uyushma_id=target_uyushma_id,
        is_active=True,
    )
    db.add(parking)
    db.commit()
    db.refresh(parking)

    log_audit_event(
        db=db,
        action="parking.create",
        actor_user_id=current_user.id,
        actor_role=current_user.role,
        target_type="parking",
        target_id=str(parking.id),
        changes={"name": parking.name, "radius_meters": parking.radius_meters},
    )

    return ParkingResponse(
        id=parking.id,
        name=parking.name,
        lat=parking.lat,
        lng=parking.lng,
        radius_meters=parking.radius_meters,
        capacity=parking.capacity,
        is_active=parking.is_active,
        vehicle_count=0,
        created_at=parking.created_at,
    )


@router.get("/{id}/vehicles", response_model=List[LiveVehicleStateResponse])
def get_parking_vehicles(id: int, db: Session = Depends(get_db_dep)):
    """Inspect vehicles currently detected inside the parking geofence."""
    parking = db.query(Parking).filter(Parking.id == id).first()
    if not parking:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parking not found")

    return tracking_service.get_parking_vehicles(id)
