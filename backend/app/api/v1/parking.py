"""Public stoyanka (parking) view with live vehicle counts. Management lives under /uyushma/{id}/parkings."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db_dep
from app.models.transport import Parking
from app.schemas.driver import LiveVehicleStateResponse, ParkingResponse
from app.services.realtime.tracking_service import tracking_service

router = APIRouter(prefix="/parkings", tags=["parkings"])


@router.get("", response_model=List[ParkingResponse])
def list_parkings(db: Session = Depends(get_db_dep)):
    return [
        ParkingResponse(
            id=p.id, uyushma_id=p.uyushma_id, name=p.name, lat=p.lat, lng=p.lng, radius_meters=p.radius_meters,
            capacity=p.capacity, is_active=p.is_active, vehicle_count=tracking_service.get_parking_vehicle_count(p.id),
            created_at=p.created_at,
        )
        for p in db.query(Parking).filter(Parking.is_active.is_(True)).all()
    ]


@router.get("/{id}/vehicles", response_model=List[LiveVehicleStateResponse])
def get_parking_vehicles(id: int, db: Session = Depends(get_db_dep)):
    if not db.query(Parking.id).filter(Parking.id == id, Parking.is_active.is_(True)).first():
        raise HTTPException(status_code=404, detail="Parking not found")
    return tracking_service.get_parking_vehicles(id)
