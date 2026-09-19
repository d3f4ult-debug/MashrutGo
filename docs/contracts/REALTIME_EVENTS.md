# Realtime WebSocket Event Contracts

**Project**: Andijon Smart Route Platform (MashrutGo)  
**Maintained by**: Developer 1 (Backend, Routing, Realtime, Payments)  
**Target Consumers**: Developer 2 (Client PWA), Developer 3 (Driver & Uyushma/Admin)  
**Protocol**: WebSocket (`ws://` / `wss://`)  
**Version**: 1.0

---

## 1. Connection Endpoints

### 1.1 Public & Client Channel
- **URL**: `ws://<backend_host>/api/v1/ws/realtime`
- **Query Parameters**:
  - `routes` *(optional, string)*: Comma-separated list of route IDs to filter (e.g. `?routes=1,5,10`). If omitted, all active public routes in the viewport are broadcast.
  - `session_id` *(optional, string)*: Anonymous or authenticated client session UUID.
- **Authentication**: None required for read-only map streaming.

### 1.2 Driver Channel
- **URL**: `ws://<backend_host>/api/v1/ws/driver`
- **Query Parameters**:
  - `token` *(required, string)*: Driver JWT access token.
- **Authentication**: Mandatory. Unauthenticated connections are closed with code `4401`.

---

## 2. Universal Message Envelope

All incoming and outgoing WebSocket frames must conform to the following JSON structure:

```json
{
  "event": "event.name.string",
  "data": {},
  "timestamp": "2026-09-19T06:30:00.000Z",
  "version": "1.0"
}
```

---

## 3. Server-to-Client Events (Broadcasts)

### 3.1 `vehicle.location.updated`
Emitted whenever an active driver transmits a new validated GPS coordinate. Broadcast to all clients watching the route or viewing the map area.

**Payload Schema**:
```json
{
  "event": "vehicle.location.updated",
  "data": {
    "vehicle_id": "veh_andijon_007",
    "route_id": 1,
    "route_number": "1",
    "direction": "outbound",
    "lat": 40.782145,
    "lng": 72.344210,
    "heading": 124.5,
    "speed_kmh": 32.4,
    "accuracy_meters": 4.2,
    "captured_at": "2026-09-19T06:30:15.000Z",
    "is_stale": false
  },
  "timestamp": "2026-09-19T06:30:16.120Z",
  "version": "1.0"
}
```

### 3.2 `route.vehicle.status`
Emitted when vehicles join or exit a route (e.g., driver shift start/end or GPS timeout).

**Payload Schema**:
```json
{
  "event": "route.vehicle.status",
  "data": {
    "route_id": 1,
    "route_number": "1",
    "online_vehicles_count": 4,
    "status": "online", 
    "has_live_vehicles": true
  },
  "timestamp": "2026-09-19T06:30:16.120Z",
  "version": "1.0"
}
```
*Note*: When `online_vehicles_count == 0`, status becomes `"no_online_vehicle_visible"`. The frontend must display *"Hozir online transport ko‘rinmayapti"* without hiding the route from search results.

### 3.3 `parking.count.updated`
Emitted when a vehicle enters or departs a registered Stayanka (parking lot) geofence radius.

**Payload Schema**:
```json
{
  "event": "parking.count.updated",
  "data": {
    "parking_id": 3,
    "parking_name": "Andijon Shahar Avtovokzali",
    "vehicle_count": 8,
    "vehicles": [
      {
        "vehicle_id": "veh_andijon_007",
        "route_number": "1",
        "entered_at": "2026-09-19T06:15:00.000Z"
      }
    ]
  },
  "timestamp": "2026-09-19T06:30:16.120Z",
  "version": "1.0"
}
```

### 3.4 `client.nearby.broadcast` (Driver Only)
Broadcast to active drivers on a specific route when a waiting client enables Route Watch.

**Payload Schema**:
```json
{
  "event": "client.nearby.broadcast",
  "data": {
    "watch_id": "wtch_8291038102",
    "route_id": 1,
    "direction": "outbound",
    "client_lat": 40.7812,
    "client_lng": 72.3489,
    "waiting_since": "2026-09-19T06:29:40.000Z",
    "action": "active"
  },
  "timestamp": "2026-09-19T06:30:16.120Z",
  "version": "1.0"
}
```

### 3.5 `client.nearby.removed` (Driver Only)
Broadcast to active drivers when a client boards the car (`client.ride.on_car`), cancels watch, or disconnects.

**Payload Schema**:
```json
{
  "event": "client.nearby.removed",
  "data": {
    "watch_id": "wtch_8291038102",
    "reason": "on_car"
  },
  "timestamp": "2026-09-19T06:32:00.000Z",
  "version": "1.0"
}
```

### 3.6 `payment.notification` (Driver & Client)
Sent to the driver's device immediately upon successful fare payment.

**Payload Schema**:
```json
{
  "event": "payment.notification",
  "data": {
    "payment_id": "pay_9823471029",
    "vehicle_id": "veh_andijon_007",
    "amount_uzs": 2500,
    "payment_method": "wallet",
    "paid_at": "2026-09-19T06:32:10.000Z",
    "can_refund": true,
    "refund_expires_at": "2026-09-19T06:47:10.000Z"
  },
  "timestamp": "2026-09-19T06:32:11.000Z",
  "version": "1.0"
}
```

---

## 4. Client-to-Server Events

### 4.1 `client.watch.start`
Client initiates tracking of a specific route and direction while waiting at a stop.

**Payload Schema**:
```json
{
  "event": "client.watch.start",
  "data": {
    "route_id": 1,
    "direction": "outbound",
    "lat": 40.7812,
    "lng": 72.3489
  },
  "timestamp": "2026-09-19T06:29:40.000Z",
  "version": "1.0"
}
```

### 4.2 `client.watch.heartbeat`
Must be sent by the client every 30 seconds to maintain the active watch session.

**Payload Schema**:
```json
{
  "event": "client.watch.heartbeat",
  "data": {
    "watch_id": "wtch_8291038102",
    "lat": 40.7812,
    "lng": 72.3489
  },
  "timestamp": "2026-09-19T06:30:10.000Z",
  "version": "1.0"
}
```

### 4.3 `client.ride.on_car`
Sent when passenger taps *"Mashinadaman"* (boarded vehicle). Immediately revokes location broadcast to other drivers.

**Payload Schema**:
```json
{
  "event": "client.ride.on_car",
  "data": {
    "watch_id": "wtch_8291038102",
    "route_id": 1
  },
  "timestamp": "2026-09-19T06:31:00.000Z",
  "version": "1.0"
}
```

### 4.4 `client.ride.exited`
Sent when passenger taps *"Tushdim"* (alighted from vehicle). Ends ride lifecycle.

**Payload Schema**:
```json
{
  "event": "client.ride.exited",
  "data": {
    "watch_id": "wtch_8291038102"
  },
  "timestamp": "2026-09-19T06:45:00.000Z",
  "version": "1.0"
}
```

---

## 5. Offline Queuing & Idempotency Rules (Driver PWA)

1. When the driver's device loses network connectivity, GPS fixes must be queued in local IndexedDB / SQLite storage.
2. Each GPS reading must include a client-generated UUID `idempotency_key` and UTC `captured_at` timestamp.
3. Upon reconnection, the driver app transmits the batch via `POST /api/v1/driver/gps/batch`:
   ```json
   {
     "batch_id": "550e8400-e29b-41d4-a716-446655440000",
     "points": [
       {
         "idempotency_key": "c4b12345-e29b-41d4-a716-446655440001",
         "lat": 40.7821,
         "lng": 72.3442,
         "speed_kmh": 28.5,
         "heading": 110.0,
         "captured_at": "2026-09-19T06:28:10.000Z"
       }
     ]
   }
   ```
4. The backend discards duplicate `idempotency_key` items and only updates the current live vehicle position if `captured_at` is newer than the latest stored snapshot.
