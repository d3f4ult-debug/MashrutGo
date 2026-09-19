# DEV 1 CONTRACT SCHEMA REQUEST (From Developer 2 — Client PWA)

Bu hujjat Dev 2 (Client PWA) frontendining Dev 1 (Backend, Data, Routing, Realtime, Payments) dan kutayotgan aniq API endpointlari, OpenAPI sxemalari va WebSocket xabarlari spesifikatsiyasidir.

---

## 1. REST API Endpoints

### 1.1. Itinerary Graph Search
- **Endpoint**: `GET /api/v1/routing/search`
- **Query Parameters**:
  - `origin_lng`: float (masalan, `72.342`)
  - `origin_lat`: float (masalan, `40.782`)
  - `dest_lng`: float (masalan, `72.361`)
  - `dest_lat`: float (masalan, `40.774`)
  - `mode`: enum [`fastest`, `cheapest`, `least_walking`, `least_transfers`] (default: `fastest`)
- **Response `200 OK`**:
```json
{
  "itineraries": [
    {
      "id": "itn_abc123",
      "mode": "fastest",
      "totalDurationMinutes": 19,
      "totalFareSoM": 2000,
      "totalWalkingMeters": 380,
      "transferCount": 0,
      "routeNumbers": ["15"],
      "liveVehiclesCount": 4,
      "departureTime": "14:30",
      "arrivalTime": "14:49",
      "legs": [
        {
          "id": "leg_1",
          "type": "walking",
          "instruction": "Eski Shahar bekatiga piyoda boring",
          "distanceMeters": 250,
          "durationMinutes": 3,
          "geometry": [[72.340, 40.783], [72.342, 40.782]]
        },
        {
          "id": "leg_2",
          "type": "transit",
          "routeNumber": "15",
          "directionName": "Yangi Bozor tomon",
          "instruction": "15-sonli marshrutga chiqing",
          "distanceMeters": 3200,
          "durationMinutes": 14,
          "intermediateStopsCount": 4,
          "fareSoM": 2000,
          "fromStop": { "id": "s1", "name": "Eski Shahar", "coordinates": [72.342, 40.782] },
          "toStop": { "id": "s5", "name": "Yangi Bozor", "coordinates": [72.361, 40.774] },
          "geometry": [[72.342, 40.782], [72.350, 40.779], [72.361, 40.774]]
        },
        {
          "id": "leg_3",
          "type": "walking",
          "instruction": "Manzilgacha piyoda boring",
          "distanceMeters": 130,
          "durationMinutes": 2,
          "geometry": [[72.361, 40.774], [72.362, 40.773]]
        }
      ]
    }
  ]
}
```

### 1.2. Route Overview & Fleet Info
- **Endpoint**: `GET /api/v1/routes/{route_number}` (masalan `/api/v1/routes/15`)
- **Response `200 OK`**:
```json
{
  "routeNumber": "15",
  "name": "15-sonli Marshrut",
  "originName": "Eski Shahar",
  "destinationName": "Yangi Bozor",
  "fareSoM": 2000,
  "intervalMinutes": 4,
  "geometry": [[72.342, 40.782], [72.350, 40.779], [72.361, 40.774]],
  "stops": [
    { "id": "s1", "name": "Eski Shahar bekat", "coordinates": [72.342, 40.782] },
    { "id": "s5", "name": "Yangi Bozor bekat", "coordinates": [72.361, 40.774] }
  ],
  "activeVehiclesCount": 6,
  "parkedVehiclesCount": 2
}
```

### 1.3. Client Watch & Ride State
- **Endpoint**: `POST /api/v1/client/watch/start`
  - **Body**: `{ "routeNumber": "15", "targetStopId": "s1", "coordinates": [72.342, 40.782] }`
  - **Response `200 OK`**: `{ "watchSessionId": "w_123", "status": "WATCHING" }`
- **Endpoint**: `POST /api/v1/client/watch/heartbeat`
  - **Body**: `{ "watchSessionId": "w_123", "coordinates": [72.342, 40.782], "timestamp": 1726734000 }`
  - **Response `200 OK`**: `{ "acknowledged": true }`
- **Endpoint**: `POST /api/v1/client/watch/board`
  - **Body**: `{ "watchSessionId": "w_123" }`
  - **Response `200 OK`**: `{ "status": "ON_VEHICLE", "broadcastStopped": true }`
- **Endpoint**: `POST /api/v1/client/watch/alight`
  - **Body**: `{ "watchSessionId": "w_123" }`
  - **Response `200 OK`**: `{ "status": "COMPLETED" }`

### 1.4. Wallet & Payments
- **Endpoint**: `GET /api/v1/wallet/balance` (Requires Bearer token)
  - **Response `200 OK`**: `{ "balanceSoM": 24000, "currency": "UZS" }`
- **Endpoint**: `POST /api/v1/wallet/topup/click`
  - **Body**: `{ "amountSoM": 10000, "returnUrl": "/wallet" }`
  - **Response `200 OK`**: `{ "transactionId": "tx_click_1", "paymentUrl": "https://my.click.uz/..." }`
- **Endpoint**: `POST /api/v1/transport/resolve-vehicle`
  - **Body**: `{ "identifier": "60 A 105 AA" }` (or QR/NFC string)
  - **Response `200 OK`**:
  ```json
  {
    "vehicleId": "v-15-1",
    "licensePlate": "60 A 105 AA",
    "routeNumber": "15",
    "uyushmaName": "Vodiy Trans Servis MCHJ",
    "fareSoM": 2000,
    "driverName": "Otabek Karimov"
  }
  ```
- **Endpoint**: `POST /api/v1/transport/pay`
  - **Headers**: `Idempotency-Key: pay-v151-1726734000`
  - **Body**: `{ "vehicleId": "v-15-1", "method": "wallet" }`
  - **Response `200 OK`**:
  ```json
  {
    "paymentId": "pay_xyz789",
    "status": "success",
    "paidAmountSoM": 2000,
    "paidAtEpochMs": 1726734005000,
    "vehicle": { ... }
  }
  ```

---

## 2. WebSocket Realtime Contract

### Live Vehicles Stream
- **URL**: `ws://<host>/api/v1/ws/live-vehicles?route=15`
- **Server Broadcast Payload**:
```json
{
  "routeNumber": "15",
  "timestamp": 1726734000,
  "vehicles": [
    {
      "id": "v-15-1",
      "routeNumber": "15",
      "licensePlate": "60 A 105 AA",
      "coordinates": [72.344, 40.781],
      "speedKmh": 28,
      "headingDeg": 110,
      "lastUpdatedEpochMs": 1726734000000,
      "etaMinutesToNextStop": 3
    }
  ]
}
```
- **Stale vehicle rule**: Agar `Date.now() - lastUpdatedEpochMs > 30000` bo‘lsa, frontend uni xaritada xira qilib ko‘rsatadi.
- **Null ETA rule**: Agar aniq ETA hisoblanmasa, `etaMinutesToNextStop` fieldi `null` bo‘lishi lozim (fake vaqt generatsiya qilinmaydi).
