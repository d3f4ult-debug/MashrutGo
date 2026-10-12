import time
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from app.api.deps import get_db_dep, get_current_user
from app.models.user import User
from app.services.payment.transport_payment_service import transport_payment_service
from app.services.fare.fare_service import fare_service

router = APIRouter(prefix="/transport", tags=["transport"])


class VehicleResolveRequest(BaseModel):
    identifier: str = Field(..., description="Plate number, QR code or vehicle internal_id (e.g. 'AND-101' or '60 111 AAA')")


class VehicleResolveResponse(BaseModel):
    vehicleId: str
    licensePlate: Optional[str] = None
    routeNumber: Optional[str] = None
    uyushmaName: Optional[str] = None
    fareSoM: int
    driverName: Optional[str] = None


class TransportPayRequest(BaseModel):
    vehicleId: Optional[str] = None
    vehicle_identifier: Optional[str] = None
    method: str = "wallet"


@router.post("/resolve-vehicle", response_model=VehicleResolveResponse)
def resolve_vehicle_endpoint(
    payload: VehicleResolveRequest,
    db: Session = Depends(get_db_dep),
):
    """Resolve vehicle details, route number, and active fare for scan-pay UI."""
    vehicle = transport_payment_service.resolve_vehicle(payload.identifier, db)
    fare = fare_service.calculate_fare(
        route_id=vehicle.route_id,
        uyushma_id=vehicle.uyushma_id,
        db=db,
    )
    driver_name = (
        vehicle.driver.user.full_name
        if vehicle.driver and vehicle.driver.user
        else "Noma'lum"
    )
    return VehicleResolveResponse(
        vehicleId=vehicle.internal_id,
        licensePlate=vehicle.plate_number,
        routeNumber=vehicle.route.route_number if vehicle.route else None,
        uyushmaName=vehicle.uyushma.name if vehicle.uyushma else None,
        fareSoM=fare.amount_uzs,
        driverName=driver_name,
    )


@router.post("/pay")
def transport_pay_endpoint(
    payload: TransportPayRequest,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db_dep),
):
    """Direct transport pay endpoint matching Client PWA contract schema."""
    identifier = payload.vehicleId or payload.vehicle_identifier
    if not identifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="vehicleId yoki vehicle_identifier ko'rsatilishi shart",
        )

    idem_key = idempotency_key or f"pay_{identifier}_{current_user.id}_{int(time.time())}"
    payment = transport_payment_service.process_scan_pay(
        client_user=current_user,
        vehicle_identifier=identifier,
        idempotency_key=idem_key,
        db=db,
    )
    return {
        "paymentId": payment.id,
        "status": payment.status,
        "paidAmountSoM": payment.amount_uzs,
        "paidAtEpochMs": int(payment.created_at.timestamp() * 1000),
        "vehicle": {
            "internal_id": payment.vehicle.internal_id if payment.vehicle else None,
            "plate_number": payment.vehicle.plate_number if payment.vehicle else None,
            "route_number": payment.route.route_number if payment.route else None,
        },
    }
