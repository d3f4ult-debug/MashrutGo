# API Contract & Changelog

**Project**: Andijon Smart Route Platform (MashrutGo)  
**Maintained by**: Developer 1 (Backend, Routing, Realtime, Payments)  
**Target Consumers**: Developer 2 (Client PWA), Developer 3 (Driver & Uyushma/Admin), QA & Mobile  
**Base Path**: `/api/v1`  
**Interactive Docs**: `http://localhost:8000/api/v1/docs` (Swagger UI) / `http://localhost:8000/api/v1/redoc`

---

## 1. Global API Standards

### 1.1 Authentication & Authorization
- Transport: JSON Web Token (JWT) in standard HTTP Authorization header:
  ```http
  Authorization: Bearer <access_token>
  ```
- Public Endpoints: Health check, anonymous route searching, public route geometries, and live vehicle positions do not require auth tokens.
- Role Hierarchy:
  - `super_admin`: Global platform access.
  - `uyushma_admin`: Tenant-isolated access restricted to the Uyushma's assigned routes, drivers, vehicles, parkings, and cashout requests.
  - `driver`: Access limited to active shifts, vehicle GPS ingest, assigned vehicle payment receipts, and payment refund actions.
  - `client`: Personal profile, wallet balance, transaction ledger, and top-up intents.

### 1.2 Request & Response Formats
- Request Content-Type: `application/json` (except OAuth form login which accepts `application/x-www-form-urlencoded`).
- Pagination Format for List Endpoints:
  ```json
  {
    "items": [],
    "total": 42,
    "page": 1,
    "size": 20,
    "pages": 3
  }
  ```
- Standard Error Envelope:
  ```json
  {
    "detail": "Descriptive error message",
    "code": "ERROR_CODE_STRING",
    "errors": []
  }
  ```

---

## 2. Version History

### [v0.9.0] — Stage 9: FCM-Ready Push Notifications & Device Token Management
*Date: 2026-10-12*
- **Pluggable Push Notification Architecture**:
  - `BaseNotificationProvider` abstract interface (`send_to_token`, `send_multicast`, `send_to_topic`).
  - `FCMNotificationProvider`: Google Firebase Cloud Messaging HTTP v1 adapter. Integrates `firebase-admin` SDK when credentials are configured. Graceful fallback mode if credentials file is omitted.
  - `DevNoOpNotificationProvider`: Local development and test provider logging deliveries and maintaining an in-memory history without throwing errors or requiring external credentials.
  - `NotificationService`: Resolves active provider, formats payloads, manages device tokens and user inboxes.
- **Device Token Registration**:
  - `POST /api/v1/notifications/device-token`: Register or refresh device token (`token`, `platform` [android/ios/web], `device_name`) for authenticated Client, Driver, or Admin.
  - `DELETE /api/v1/notifications/device-token`: Deactivate / unregister device token on logout.
  - `GET /api/v1/notifications/my-devices`: List active device tokens for the current user.
- **In-App Notifications Inbox**:
  - `GET /api/v1/notifications/inbox`: Paginated notifications inbox for the current user (`unread_only`, `skip`, `limit`).
  - `POST /api/v1/notifications/inbox/{id}/read`: Mark specific notification as read.
  - `POST /api/v1/notifications/inbox/read-all`: Mark all notifications as read.
- **Admin Broadcast & Push Dispatch**:
  - `POST /api/v1/notifications/broadcast`: Admin broadcasts push notification to a topic (e.g. `drivers`, `all`) or to a specific target `user_id`. Forbidden to Clients.
  - `GET /api/v1/notifications/dev-history`: Super Admin inspects recent notifications logged by Dev No-Op provider.
- **Event-Triggered Push Hooks**:
  - `payment.received`: Triggered upon passenger scan & pay to alert the driver in real-time (`"Yangi to'lov qabul qilindi 💰"`).
  - `payment.refunded`: Triggered upon payment refund to alert the passenger (`"To'lov qaytarildi ↩️"`).
  - `cashout.status_updated`: Triggered upon Uyushma cashout approval, rejection, or payout to alert the driver (`"Cashout so'rovi yangilandi 🏦"`).
  - `watch.arrival_alert`: Triggered when watched vehicle approaches destination stop (`"Mashrut yaqinlashmoqda 🚐"`).
  - `shift.event`: Triggered on route or shift updates.

### [v0.8.0] — Stage 8: Admin & Uyushma APIs, Dashboard, Soft-Delete & Audit Logs
*Date: 2026-10-12*
- **Tenant-Isolated Admin Dashboard**:
  - `GET /api/v1/admin/dashboard`: Super Admin views platform-wide metrics (all Uyushmas, total/published routes, drivers, vehicles, online count, active shifts, parkings, ledger volume, payments, refunds, pending cashout volumes). Uyushma Admin receives strictly tenant-scoped metrics.
- **Vehicles CRUD, Filter & 1-Driver-1-Vehicle Rule**:
  - `GET /api/v1/admin/vehicles`: Paginated vehicle list with filters (`uyushma_id`, `route_id`, `driver_id`, `is_active`, `search`).
  - `POST /api/v1/admin/vehicles`: Vehicle registration enforcing 1 driver -> 1 vehicle assignment rule.
  - `PUT /api/v1/admin/vehicles/{id}`: Update vehicle specs, plate number, or driver assignment with duplicate assignment prevention.
  - `DELETE /api/v1/admin/vehicles/{id}`: Soft-delete / archive vehicle (`is_active = False`) with audit trail.
  - `GET /api/v1/uyushma/{id}/vehicles`: Tenant-isolated nested vehicle list.
  - `POST /api/v1/uyushma/{id}/vehicles`: Direct vehicle registration under tenant.
- **Drivers Management & Soft-Delete**:
  - `GET /api/v1/admin/drivers`: Filter drivers by `uyushma_id`, `is_active`, or search by name/phone/license.
  - `PUT /api/v1/admin/drivers/{id}`: Update driver license, full name, or active status.
  - `DELETE /api/v1/admin/drivers/{id}`: Soft-delete driver (sets `is_active = False` on profile & user, de-assigns active vehicle).
- **Tariffs (FareRules) CRUD & Archiving**:
  - `GET /api/v1/admin/tariffs`: List fare rules filtered by route, rule type (`fixed`, `distance`, `zone`), and active status.
  - `POST /api/v1/admin/tariffs`: Create route/uyushma tariff rule.
  - `PUT /api/v1/admin/tariffs/{id}`: Update tariff parameters.
  - `DELETE /api/v1/admin/tariffs/{id}`: Archive tariff rule (`is_active = False`).
- **Clients Management & Security**:
  - `GET /api/v1/admin/clients`: List platform clients with pagination and search.
  - `PUT /api/v1/admin/clients/{id}`: Super Admin soft-blocks or unblocks client account (`is_active = False/True`). Forbidden to Uyushma Admins.
- **Shifts & Live Status Monitoring**:
  - `GET /api/v1/admin/shifts`: Monitor driver shifts with filters for Uyushma, route, driver, status (`active`/`completed`), and date range.
  - `GET /api/v1/admin/live-status`: Real-time fleet overview showing all live vehicles, route distribution map, and vehicles in parking lots.
- **Financial Audit & Reconciliation**:
  - `GET /api/v1/admin/transactions`: Super Admin audit of double-entry wallet transactions ledger.
  - `GET /api/v1/admin/refunds`: Audit and monitor refunded payments.
- **System Settings & Audit Trail**:
  - `GET /api/v1/admin/settings`: Retrieve global system configuration keys.
  - `POST /api/v1/admin/settings`: Upsert configuration parameters.
  - `GET /api/v1/admin/audit-logs`: Inspect immutable audit trail recording all administrative actions (`actor_user_id`, `actor_role`, `action`, `target_type`, `changes_json`).
- **Uyushma Soft-Delete / Archive**:
  - `DELETE /api/v1/uyushma/{id}`: Super Admin soft-deletes / archives Uyushma organization (`is_active = False`).

### [v0.7.0] — Stage 7: Fare Engine, Double-Entry Wallet, Click Payments & Cashout
*Date: 2026-10-12*
- **Extensible Fare Engine**:
  - `BaseFareEngine` abstract interface with MVP `FixedFareEngine`, `DistanceFareEngine`, `ZoneFareEngine`, and dynamic `FareService` registry.
  - Automatically resolves active fixed route or Uyushma tariff rules (default 2,500 UZS).
- **Double-Entry Audit-Friendly Wallet Ledger**:
  - `WalletLedgerService`: Transaction-safe atomic mutations. Random `UPDATE` queries strictly prohibited.
  - Typed ledger entry types: `topup`, `ride_payment`, `refund`, `adjustment`, `cashout`.
  - Enforces non-negative balance on debits and deduplication via unique `idempotency_key`.
  - Atomic double-entry `transfer` transferring fare between client and driver wallets.
  - `GET /api/v1/wallet/balance`: Fetch client/driver wallet balance.
  - `GET /api/v1/wallet/transactions`: Fetch paginated immutable ledger history.
- **Click Payment Provider Adapter**:
  - `ClickProviderAdapter`: Full implementation of Click Merchant protocol with MD5 signature validation.
  - `POST /api/v1/wallet/topup/click`: Generates signed redirect checkout URL for client top-up.
  - `POST /api/v1/payments/webhook/click`: Webhook endpoint processing `Prepare` (action=0) and `Complete` (action=1) actions with idempotency and ledger credit.
  - Pluggable provider architecture with `BasePaymentProvider` and extension stubs for `Payme`, `Uzum`, and `HUMO`.
- **Transport Scan & Pay**:
  - `POST /api/v1/payments/scan-pay`: Client scans QR/NFC or enters vehicle internal ID (`internal_id`, e.g. `AND-101`), resolves vehicle and driver, resolves route fare, and executes atomic double-entry transfer.
- **Driver Payments & Refund Protection**:
  - `GET /api/v1/driver/payments`: Driver views payments received by their vehicle (strict tenant/driver isolation).
  - `POST /api/v1/driver/payments/{id}/refund`: Driver refunds payment within configured grace window (15 mins) with duplicate protection and reverse ledger entry.
- **Cashout Workflow**:
  - `POST /api/v1/driver/cashout/request`: Driver submits cashout request of accumulated earnings with balance check.
  - `GET /api/v1/driver/cashouts`: Driver lists personal cashout requests.
  - `GET /api/v1/uyushma/cashouts`: Uyushma Admin reviews pending requests (tenant-isolated).
  - `POST /api/v1/uyushma/cashout/{id}/approve`: Uyushma Admin approves request.
  - `POST /api/v1/uyushma/cashout/{id}/reject`: Uyushma Admin rejects request with reason.
  - `POST /api/v1/uyushma/cashout/{id}/pay`: Uyushma Admin marks paid and executes ledger debit from driver wallet.

### [v0.6.0] — Stage 4: Driver Shift, GPS Ingest, Realtime & Parking Geofence
*Date: 2026-09-19*
- **Driver Shift Lifecycle**:
  - `POST /api/v1/driver/shift/start`: Driver starts an active shift on their assigned vehicle and route; broadcast to route subscribers.
  - `POST /api/v1/driver/shift/end`: Driver ends shift; cleans up active tracking and broadcasts vehicle offline status.
  - `GET /api/v1/driver/shift/current`: Driver retrieves current active shift details.
- **GPS Ingest & High-Frequency Tracking**:
  - `POST /api/v1/driver/gps/single`: Single real-time GPS telemetry ping (lat, lng, speed, heading, accuracy, captured_at, idempotency_key).
  - `POST /api/v1/driver/gps/batch`: Offline-queued batch ingest supporting client-generated idempotency keys. Out-of-order pings are persisted to history without corrupting live map state.
  - `GET /api/v1/driver/vehicles/live`: Public query for active online vehicles filtered by `route_id` and `direction`.
- **Stayanka (Parking) Geofencing**:
  - `GET /api/v1/parkings`: List parking lots with realtime vehicle counts.
  - `POST /api/v1/parkings`: Create parking lot geofences with configurable radius (Admin only).
  - `GET /api/v1/parkings/{id}/vehicles`: Real-time inspect vehicles inside specific parking geofence.
  - Automatic entry/exit detection via `LiveTrackingService` emitting `parking.count.updated` WebSocket events.
- **WebSocket Streaming**:
  - `WS /api/v1/ws/realtime`: Public telemetry streaming with optional `?routes=1,2` filtering (`vehicle.location.updated`, `route.vehicle.status`, `parking.count.updated`).
  - `WS /api/v1/ws/driver`: Authenticated driver bidirectional channel for route assignments and passenger events.
- **Stale Vehicle Handling**:
  - Automatic timeout (>45s inactivity) marking vehicle state as offline and notifying connected clients.

### [v0.5.0] — Stage 3: Graph Routing Engine
*Date: 2026-09-19*
- **Multi-Modal Graph Routing Engine**:
  - `POST /api/v1/routing/search`: Multi-criteria A to B route search combining walking connectors, transit segments, and transfer links.
  - Zero hard walking/transfer limits. Direct walking-only itinerary (0 UZS fare) is always returned as a baseline.
  - Generates direct transit itineraries (0 transfers) and multi-route itineraries (1 transfer).
  - Realtime vehicle status integration: routes are never suppressed if vehicles are offline (`no_online_vehicle_visible` with schedule estimate; `online_vehicles_visible` with high confidence when active driver shifts exist).
  - Multi-criteria recommendation and sorting: `fastest`, `cheapest`, `least_walking`, `least_transfers`.

### [v0.4.0] — Stage 2: Route Management & MapTiler Adapter
*Date: 2026-09-19*
- **MapTiler Routing Adapter**: Isolated `BaseRoutingProvider` protocol with `MapTilerAdapter` (`driving` profile, coordinate validation, GeoJSON LineString formatting, and development geodesic fallback).
- **Route CRUD & Publishing**:
  - `GET /api/v1/routes`: Public lists published routes; Admins view all with filtering by Uyushma or search query.
  - `GET /api/v1/routes/{id}`: Detailed route information with directions and ordered waypoints.
  - `POST /api/v1/routes`: Create route metadata (tenant-isolated).
  - `PUT /api/v1/routes/{id}`: Update route metadata.
  - `DELETE /api/v1/routes/{id}`: Delete route.
  - `POST /api/v1/routes/{id}/publish`: Publish/unpublish route for client discovery.
- **Route Editor & Directions**:
  - `POST /api/v1/routes/{id}/directions`: Upsert outbound and inbound directions with A/B coordinates.
  - `POST /api/v1/routes/{id}/directions/{direction_type}/waypoints`: Bulk set and reorder waypoints (1..N).
  - `POST /api/v1/routes/{id}/directions/{direction_type}/waypoints/add`: Add single waypoint with positional index.
  - `DELETE /api/v1/routes/{id}/directions/{direction_type}/waypoints/{waypoint_id}`: Remove waypoint with auto-reordering.
  - `POST /api/v1/routes/editor/auto-path`: Calculate path preview through A → waypoints → B (for interactive UI preview without DB save).
  - `POST /api/v1/routes/{id}/directions/{direction_type}/generate-path`: Calculate and persist road path to database.

### [v0.3.0] — Stage 1: Domain Models, Authentication & RBAC
*Date: 2026-09-19*
- **Domain Models**: Implemented all 22 SQLAlchemy models (Users, Profiles, Uyushma, Vehicles, Routes, Directions, Waypoints, Parkings, Shifts, Snapshots, Client Watches, Rides, Fares, Wallets, Transactions, Payments, Refunds, Cashouts, Notifications, Settings, AuditLogs).
- **Authentication**:
  - `POST /api/v1/auth/login`: Authenticate with phone & password; returns JWT token with role claims.
  - `POST /api/v1/auth/register-client`: Public registration for clients; auto-provisions profile & wallet.
  - `GET /api/v1/auth/me`: Profile retrieval for authenticated user.
  - `POST /api/v1/auth/refresh`: JWT access token refresh.
- **Uyushma & Driver Administration**:
  - `POST /api/v1/uyushma`: Super Admin creates Uyushma organizations.
  - `GET /api/v1/uyushma`: Super Admin lists all Uyushmas.
  - `GET /api/v1/uyushma/{id}`: Uyushma organization details (tenant-isolated).
  - `POST /api/v1/uyushma/{id}/drivers`: Uyushma Admin or Super Admin creates Driver accounts. Blocked from client self-registration.
  - `GET /api/v1/uyushma/{id}/drivers`: Lists drivers under the tenant Uyushma.
- **RBAC & Tenant Isolation**: Dependency-based role validation (`require_super_admin`, `require_uyushma_admin`, `require_driver`, `require_client`) and cross-tenant access prevention.
- **Audit Logging**: Sensitive events logged to `audit_logs` table.

### [v0.2.0] — Stage 0: Starter Kit Audit & Contracts Foundation
*Date: 2026-09-19*
- **Compatibility**: Upgraded configuration layer (`app/core/config.py`) to support Pydantic v2 and Python 3.12.
- **Environment**: Extended `.env.example` with MapTiler, Click payments, FCM, and realtime GPS configuration keys.
- **Contracts**: Published `STARTER_KIT_AUDIT.md`, `API_CHANGELOG.md`, and `REALTIME_EVENTS.md`.
- **Roadmap**: Locked the complete Stage 1 - Stage 9 endpoint catalog for frontend integration planning.

### [v0.1.0] — Initial Starter Kit
*Date: 2026-09-18*
- Basic FastAPI application initialization.
- Added `GET /api/v1/health` endpoint returning `{"status": "ok"}`.

---

## 3. Complete Endpoint Catalog (Stages 1 – 9)

### 3.1 Health & Core (`app/api/v1/health.py`)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/health` | None | Service heartbeat & status (`{"status": "ok"}`) |

### 3.2 Authentication & Profiles (`/api/v1/auth`, Stage 1)
| Method | Endpoint | Auth | Roles | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/auth/login` | None | All | OAuth2 password flow; returns access token & user info |
| `POST` | `/api/v1/auth/register-client` | None | Client | Client user registration (phone + password) |
| `GET` | `/api/v1/auth/me` | Bearer | All | Fetch currently authenticated user profile & permissions |
| `POST` | `/api/v1/auth/refresh` | Bearer | All | Refresh access token |

### 3.3 Uyushma & Admin Management (`/api/v1/uyushma`, `/api/v1/admin`, Stage 1 & 8)
| Method | Endpoint | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/v1/uyushma` | Bearer | SuperAdmin | List all Uyushma organizations |
| `POST` | `/api/v1/uyushma` | Bearer | SuperAdmin | Create new Uyushma organization |
| `GET` | `/api/v1/uyushma/{id}` | Bearer | SuperAdmin, Uyushma | Get Uyushma details |
| `GET` | `/api/v1/uyushma/{id}/drivers` | Bearer | SuperAdmin, Uyushma | List drivers under this Uyushma |
| `POST` | `/api/v1/uyushma/{id}/drivers` | Bearer | SuperAdmin, Uyushma | Create driver account (driver cannot self-register) |
| `GET` | `/api/v1/uyushma/{id}/vehicles` | Bearer | SuperAdmin, Uyushma | List vehicles assigned to Uyushma |
| `POST` | `/api/v1/uyushma/{id}/vehicles` | Bearer | SuperAdmin, Uyushma | Register vehicle (auto-assigns mandatory internal ID) |
| `GET` | `/api/v1/admin/audit-logs` | Bearer | SuperAdmin | Platform-wide audit trail |
| `GET` | `/api/v1/admin/settings` | Bearer | SuperAdmin | Global platform settings |

### 3.4 Routes & MapTiler Integration (`/api/v1/routes`, Stage 2)
| Method | Endpoint | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/v1/routes` | None | Public | List published routes (supports filter by number/Uyushma) |
| `GET` | `/api/v1/routes/{id}` | None | Public | Route details with outbound & inbound direction geometries |
| `POST` | `/api/v1/routes` | Bearer | Uyushma, SuperAdmin | Create route metadata (number, name, Uyushma) |
| `PUT` | `/api/v1/routes/{id}` | Bearer | Uyushma, SuperAdmin | Update route metadata |
| `POST` | `/api/v1/routes/{id}/directions` | Bearer | Uyushma, SuperAdmin | Set outbound / inbound direction GeoJSON geometry |
| `POST` | `/api/v1/routes/{id}/waypoints` | Bearer | Uyushma, SuperAdmin | Save / reorder intermediate waypoints |
| `POST` | `/api/v1/routes/maptiler/preview-path` | Bearer | Uyushma, SuperAdmin | Call MapTiler routing adapter to auto-generate path |
| `POST` | `/api/v1/routes/{id}/publish` | Bearer | Uyushma, SuperAdmin | Toggle published status |

### 3.5 Graph Routing Engine (`/api/v1/routing`, Stage 3)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/routing/search` | None (Optional Bearer) | Multi-criteria A to B route search |

**Search Request Payload**:
```json
{
  "origin": {"lat": 40.7821, "lng": 72.3442, "address": "Andijon vokzali"},
  "destination": {"lat": 40.7554, "lng": 72.3610, "address": "Eski shahar"},
  "preferences": {
    "mode": "fastest", 
    "allow_walking_only": true
  }
}
```

**Search Response Modes**: `fastest`, `cheapest`, `least_walking`, `least_transfers`.

### 3.6 Driver Shifts & GPS Ingest (`/api/v1/driver`, Stage 4)
| Method | Endpoint | Auth | Roles | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/driver/shift/start` | Bearer | Driver | Start active driver shift; begins GPS broadcasting |
| `POST` | `/api/v1/driver/shift/end` | Bearer | Driver | End shift; terminates live broadcasting |
| `GET` | `/api/v1/driver/shift/current` | Bearer | Driver | Get driver's active shift info & statistics |
| `POST` | `/api/v1/driver/gps/single` | Bearer | Driver | Single GPS coordinate update |
| `POST` | `/api/v1/driver/gps/batch` | Bearer | Driver | Offline-queued GPS batch sync (idempotency key protected) |
| `GET` | `/api/v1/driver/vehicles/live` | None | Public | Fetch current active/live vehicles by route & direction |

### 3.7 Client Watch & Ride State (`/api/v1/client`, Stage 5)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/client/watch/start` | Optional Bearer | Client enters "Watching Route" state; sends GPS to route drivers |
| `POST` | `/api/v1/client/watch/heartbeat` | Optional Bearer | Refresh active watch session (keeps connection alive) |
| `POST` | `/api/v1/client/watch/stop` | Optional Bearer | Stop watching; terminates broadcast to drivers |
| `POST` | `/api/v1/client/ride/on_car` | Optional Bearer | Passenger boarded ("Mashinadaman"); hides client GPS from drivers |
| `POST` | `/api/v1/client/ride/exited` | Optional Bearer | Passenger alighted ("Tushdim"); ends ride lifecycle |

### 3.8 Parking / Stayanka Geofence (`/api/v1/parkings`, Stage 4)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/parkings` | None | List stayanka locations with current vehicle counts |
| `POST` | `/api/v1/parkings` | Bearer (Uyushma) | Create parking lot with geofence center lat/lng and radius |
| `GET` | `/api/v1/parkings/{id}/vehicles` | Bearer (Uyushma) | Inspect vehicles currently inside the parking geofence |

### 3.9 Wallet, Fares & Payments (`/api/v1/wallet`, `/api/v1/payments`, Stage 7)
| Method | Endpoint | Auth | Roles | Description |
|---|---|---|---|---|
| `GET` | `/api/v1/wallet/balance` | Bearer | Client | Current wallet balance & status |
| `GET` | `/api/v1/wallet/transactions` | Bearer | Client | Immutable double-entry ledger history |
| `POST` | `/api/v1/wallet/topup/click` | Bearer | Client | Initiate Click top-up payment intent |
| `POST` | `/api/v1/payments/webhook/click` | None (Signature) | Click | Click webhook endpoint (`Prepare` & `Complete` actions) |
| `POST` | `/api/v1/payments/scan-pay` | Bearer | Client | Pay for ride via vehicle internal ID / QR / NFC |
| `GET` | `/api/v1/driver/payments` | Bearer | Driver | List payments received by driver's vehicle |
| `POST` | `/api/v1/driver/payments/{id}/refund` | Bearer | Driver | Refund passenger payment within configured grace window |
| `POST` | `/api/v1/driver/cashout/request` | Bearer | Driver | Request cashout of accumulated vehicle earnings |
| `POST` | `/api/v1/uyushma/cashout/{id}/approve` | Bearer | Uyushma | Approve & record cash payout in double-entry ledger |
| `POST` | `/api/v1/uyushma/cashout/{id}/reject` | Bearer | Uyushma | Reject cashout request |

### 3.10 Push Notifications (`/api/v1/notifications`, Stage 9)
| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/notifications/device-token` | Bearer | Register client or driver FCM device token |
| `GET` | `/api/v1/notifications/me` | Bearer | List notification history for authenticated user |
