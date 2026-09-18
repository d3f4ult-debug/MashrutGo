# DEVELOPER 1 SUPER PROMPT — Backend, Data, Routing, Realtime, Payments

## Mission
Sen loyiha backend/core ownerisan. Starter kitni almashtirma; mavjud strukturani tahlil qilib, FastAPI backendni shu repository ichida kengaytir. Maqsad: barcha UIlar foydalanadigan stabil, documented API + realtime platforma yaratish.

## Git ownership — conflict qilma
Sening ownershiping: backend papkalari, DB models/migrations, API schemas/routes, services, routing engine, websocket manager, payment/wallet backend, backend tests, OpenAPI va `docs/contracts/*`. Frontend page/component/style fayllariga tegma. Shared env/example yoki root config kerak bo‘lsa minimal PR qil va boshqa devlarga breaking change yoz.

## Stage 0 — Starter kit audit
1. Repository structure, package managers, existing auth/config/env conventionsni aniqlagin.
2. Existing code'ni keraksiz rewrite qilma.
3. `.env.example`ga backend/map/payment/FCM placeholder keys qo‘sh, real secret yozma.
4. `docs/contracts/API_CHANGELOG.md` va realtime event contract yarat.
5. SQLite MVPni ishlat, lekin ORM/schema PostgreSQL migrationga mos bo‘lsin.

## Stage 1 — Domain + Auth + RBAC
Entitylar: User/roles, ClientProfile, Uyushma, DriverProfile, Vehicle, Route, RouteDirection, RouteWaypoint, Parking, DriverShift, LocationSnapshot, ClientRouteWatch, ClientRideState, FareRule, Wallet, WalletTransaction, Payment, Refund, CashoutRequest, Notification, SystemSetting, AuditLog.

Rules:
- Super Admin creates Uyushma.
- Uyushma creates Drivers.
- Driver self-register yo‘q.
- Client anonymous route/map ishlata oladi; wallet/payment uchun auth.
- 1 driver → 1 vehicle → 1 route.
- 1 Uyushma → many routes; route number unique ownershipda.
- vehicle metadata optional, internal vehicle ID mandatory.
- tenant isolation: Uyushma faqat o‘z data’si.

Implement secure password hashing/token flow, dependency-based RBAC, validation, pagination/filtering, audit events.

## Stage 2 — Route management + MapTiler routing adapter
Route CRUD va ikki direction. Geometry GeoJSON/polyline sifatida saqlansin. Route editor uchun endpointlar:
- create route metadata
- create/update outbound/inbound direction
- A/B coordinates
- ordered waypoints
- request auto path through A→waypoints→B
- save/reorder/remove waypoints
- publish/unpublish route

MapTiler routing/geocoding accessni adapter/service orqali izolyatsiya qil. Provider almashtirilsa domain o‘zgarmasin. Provider failure uchun clean errors.

## Stage 3 — Graph Routing Engine
Routing engine alohida modul/service. Graphda walking connectors va transit segments bo‘lsin. A/B coordinate inputdan bir nechta valid itineraries qaytar.

Hard walking/transfer limit qo‘yma. Walking-only route ham valid. Candidate result fields: legs, route/direction IDs, boarding/alighting coordinate, walking meters/minutes, transit minutes, wait/ETA, transfers, fare total, total ETA, live-data confidence.

Optimization modes: fastest, cheapest, least_walking, least_transfers. Pareto/weighted multi-criteria strategy ishlatish mumkin, lekin deterministic va testable bo‘lsin. Route mavjud, ammo live car yo‘q bo‘lsa route candidate yashirilmasin; live status `no_online_vehicle_visible` kabi bo‘lsin.

## Stage 4 — Driver Shift + GPS + Realtime
Endpoints/events:
- start shift / end shift
- GPS batches and single update
- offline queued GPS sync with client-generated idempotency keys
- current live vehicles by route/direction
- vehicle location websocket broadcast
- stale vehicle timeout

Location: lat/lng, accuracy, speed, heading, captured_at, received_at. Bad/stale/out-of-order data validation qil. Latest state va kerakli historyni ajrat.

Parking geofence: configurable radius; active vehicle radius ichida bo‘lsa countga kiradi. Count realtime update.

## Stage 5 — Client watch + ride state
Anonymous/session-based watch imkonini qo‘llab-quvvatla. Client route/directionni “watch” qilganda exact GPS shu route active driverlariga broadcast qilinadi. `I am on car` holatida broadcast darhol to‘xtaydi. `Exited car` ride state yakunlaydi. Concrete vehicle selection talab qilinmaydi. Expiry/heartbeat qo‘y, abandoned watch abadiy qolmasin.

## Stage 6 — ETA
Live vehicle route geometrydagi progressini map-match/projection orqali taxmin qil. Boarding pointgacha remaining route distance + smoothed recent speed orqali ETA. Impossible/insufficient data bo‘lsa null/confidence qaytar; fake ETA yo‘q. Fastest routing costga available ETA/waitni qo‘sh.

## Stage 7 — Fare, Wallet, Payments
Fare engine interface yarat: MVP `fixed`, kelajak `distance/zone/custom` extension-friendly.

Wallet ledger double-entryga yaqin audit-friendly modelda bo‘lsin: topup, ride payment, refund, adjustment, cashout kabi typed entries. Balance mutationni random UPDATE bilan qilma; transaction-safe service orqali.

Clickni birinchi payment provider adapteri sifatida tayyorla: create top-up/payment intent, webhook/callback, signature validation, idempotency, status reconciliation. Payme/Uzum/HUMO uchun provider interface qoldir.

Transport payment: QR/NFC/vehicle identifier orqali internal vehicle resolve → fare resolve → payment. Driver faqat o‘z vehicle paymentlarini ko‘radi. Refund/undo endpointida authorization, duplicate protection, allowed window/config va audit bo‘lsin. Cashout request → Uyushma approve/reject/paid ledger flow.

## Stage 8 — Admin/Uyushma APIs
CRUD/filter/dashboard endpointlari: Uyushma, routes, drivers, vehicles, parkings, tariffs, clients, shifts, live status, transactions, refunds, cashouts, settings, audit logs. Destructive operations soft-delete/archive bo‘lishi afzal.

## Stage 9 — Notifications
FCM-ready notification service abstraction. Backend device-token registration va event-triggered notification hooksni tayyorlasin. FCM credential bo‘lmasa local/dev no-op provider ishlasin.

## Stage 10 — Tests & delivery
Unit tests: graph costs, route direction, fare rules, wallet/refund idempotency, RBAC, geofence, ETA helpers. Integration tests: auth→route search, shift→GPS→live, watch lifecycle, Click webhook mocked, cashout.

Deliverables:
- running FastAPI app
- DB initialization/migrations
- OpenAPI docs
- realtime contract
- seed/demo data for Andijon-style routes
- backend test command
- developer setup notes

## Dependency contract
Dev2/Dev3 sendan OpenAPI + websocket event schemas kutadi. UI talab qilgan yangi fieldni og‘zaki qo‘shma: schema + changelog + example payloadni commit qil. Dev2/Dev3 frontend fayllarini sen edit qilma.
