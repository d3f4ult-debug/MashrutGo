# Realtime WebSocket Contract

**Project**: Andijon Smart Route Platform (MashrutGo)
**Owner**: Developer 1 (backend) — source: `backend/app/api/v1/websocket.py`, `backend/app/services/realtime/*`
**Consumers**: Client PWA, Driver PWA, Uyushma/Admin operations (`frontend/src/services/realtime/websocket.ts`)
**Envelope version**: `1.0`

---

## 1. Endpoints

| Channel | URL | Auth | Purpose |
|---|---|---|---|
| Public | `ws(s)://<host>/api/v1/ws/realtime[?routes=1,5][&session_id=…]` | none | Live vehicles, route status, stoyanka counts; optional client watch commands |
| Driver | `ws(s)://<host>/api/v1/ws/driver?token=<JWT>` | driver JWT | Waiting passengers of the driver's own route, payments, cash-outs, stoyanka presence, forced shift end |

- A missing/invalid/non-driver token on `/ws/driver` is closed with **1008 (policy violation)**. Clients must not auto-reconnect on 1008.
- Keep-alive: the client sends the text frame `ping` (every 25 s in the web app); the server answers `pong`.
- Maximum inbound message size: 8 KB.
- In development the Vite dev server proxies `/api` **including WebSocket upgrades** to the backend.

## 2. Envelope (server → client)

```json
{ "event": "vehicle.location.updated", "data": { }, "timestamp": "2026-09-19T06:30:16.120000+00:00", "version": "1.0" }
```

All timestamps are ISO-8601 **UTC with an explicit offset**.

## 3. Public channel events

### `vehicle.location.updated`
Sent for every GPS fix that moves the live position (history-only fixes — out of order, inaccurate, replayed old batches — are not broadcast). Also re-sent immediately after a driver switches direction.
```json
{
  "vehicle_id": "AND01-V0001",
  "plate_number": "60 A 101 AA",
  "route_id": 1,
  "route_number": "15",
  "direction": "outbound",
  "lat": 40.782145,
  "lng": 72.34421,
  "heading": 124.5,
  "speed_kmh": 32.4,
  "accuracy_meters": 4.2,
  "captured_at": "2026-09-19T06:30:15+00:00",
  "is_stale": false,
  "parking_id": 3,
  "parking_name": "Eski shahar stoyankasi"
}
```
`vehicle_id` is the vehicle's internal id (the value printed on its QR sticker). With `?routes=` only events of those routes are delivered.

### `route.vehicle.status`
Sent when a route's visible fleet changes: shift start, first GPS fix, vehicle turning stale, shift end / forced end. Operations maps re-read `GET /operations/live-fleet` on this event.
```json
{ "route_id": 1, "route_number": "15", "online_vehicles_count": 0, "status": "no_online_vehicle_visible", "has_live_vehicles": false }
```
`no_online_vehicle_visible` means *no GPS is visible right now* — the UI must say "Hozir online transport ko‘rinmayapti" and must never hide the route.

### `parking.count.updated`
Sent to every public subscriber when a vehicle enters/leaves a stoyanka geofence, turns stale inside it, or its shift ends there.
```json
{ "parking_id": 3, "parking_name": "Eski shahar stoyankasi", "vehicle_count": 2,
  "vehicles": [ { "vehicle_id": "AND01-V0001", "route_number": "15", "captured_at": "2026-09-19T06:15:00+00:00" } ] }
```

### Client → server on the public channel
| Event | Data | Reply |
|---|---|---|
| `subscribe` | `{ "routes": [1, 5] }` (or `null` for all) | `subscribed` |
| `client.watch.start` | `{ route_id, direction, lat, lng, accuracy_meters?, session_id }` | `client.watch.started` `{ watch_id, session_id, status, expires_at }` |
| `client.watch.heartbeat` | `{ watch_id, session_id, lat?, lng? }` | `client.watch.updated` |
| `client.ride.on_car` | `{ watch_id, session_id }` | `client.ride.state_updated` |
| `client.ride.exited` / `client.watch.stop` | `{ watch_id, session_id }` | `client.watch.stopped` |

Errors are answered with `error` `{ detail, status? }`. The same operations exist over REST (`/client/watch/*`, `/client/ride/*`), which the web app uses. Every mutation requires the watch's `session_id` secret; watches expire after `CLIENT_WATCH_HEARTBEAT_TIMEOUT_SECONDS` without a heartbeat.

## 4. Driver channel events

Delivered only to the sockets of the driver concerned; passenger events only for the route of the driver's **active shift**.

| Event | Data |
|---|---|
| `client.nearby.snapshot` | `{ route_id, passengers: [NearbyPassenger] }` — on connect while a shift is active |
| `client.nearby.broadcast` | `NearbyPassenger` — new watch (`action: "active"`) or moved passenger (`action: "updated"`) |
| `client.nearby.removed` | `{ watch_id, reason }` — `on_car` ("Mashinadaman"), `exited`, `cancelled`, `expired`, `replaced` |
| `parking.status` | `{ parking_id, parking_name, is_inside }` — automatic geofence presence of the driver's vehicle |
| `payment.received` | `{ payment: DriverPayment }` (same shape as `GET /driver/payments` items, without `fare_name`) |
| `payment.refunded` | `{ payment_id, vehicle_id, amount_uzs, refund_reason, refunded_at }` |
| `cashout.status_updated` | `{ cashout_id, status, rejection_reason }` — `approved` / `rejected` / `paid` |
| `shift.force_ended` | `{ shift_id, reason }` — an administrator ended the shift; the app stops GPS and discards unsent fixes |

`NearbyPassenger`:
```json
{ "watch_id": "57", "route_id": 1, "direction": "outbound", "client_lat": 40.7812, "client_lng": 72.3489,
  "waiting_since": "2026-09-19T06:29:40+00:00", "action": "active" }
```
No passenger identity is ever sent — only the anonymous watch id and the exact position while the watch is active.

After `POST /driver/shift/start` the web app reconnects the driver socket so the server attaches the new route and sends a fresh snapshot.

## 5. Offline GPS queue (Driver PWA)

1. Every fix carries a client-generated UUID `idempotency_key` and the device `captured_at` (UTC).
2. While offline (or when a request fails with a network error / 5xx / 429) fixes are stored in IndexedDB, tagged with the shift id. Fixes of another shift are never uploaded.
3. On reconnect the queue is uploaded oldest-first in batches of ≤500 via `POST /api/v1/driver/gps/batch`:
   ```json
   { "batch_id": "550e8400-e29b-41d4-a716-446655440000",
     "points": [ { "idempotency_key": "c4b1…", "lat": 40.7821, "lng": 72.3442, "speed_kmh": 28.5, "heading": 110,
                   "accuracy_meters": 6, "captured_at": "2026-09-19T06:28:10.000Z" } ] }
   ```
4. The backend stores history, drops duplicate keys (`duplicate_count`) and moves the live marker only for a fix newer than the current one. Fixes older than `GPS_STALE_THRESHOLD_SECONDS` are kept as history but not advertised as live.
5. HTTP 409 (no active shift) stops the transmitter; 422 drops the offending fix/batch so it cannot block the queue.
