# DEVELOPER 3 SUPER PROMPT — Driver, Uyushma, Super Admin, Flutter Wrapper

## Mission
Sen operations UI ownerisan: Driver PWA, Uyushma panel, Super Admin panel va release uchun Flutter WebView wrapper + FCM integration. Starter kitni saqla, backendni Dev1 contract orqali ishlat.

## Git ownership — conflict qilma
Ownership: driver pages/components, uyushma pages/components, super-admin pages/components, operations dashboards, route editor UI, Flutter wrapper project, FCM client integration, operations tests. Client consumer pages Dev2niki; backend Dev1niki. Root/shared configga minimal teg, kerak bo‘lsa alohida PR.

## Stage 0 — Role shells
Starter kitdan role-aware layouts yarat:
- `/driver/*`
- `/uyushma/*`
- `/admin/*`
Unauthorized role routega kira olmasin. Mobile Driver UI birinchi darajali; Uyushma/Admin desktop-first, ammo mobile responsive.

## Stage 1 — Driver PWA
Driver login; self-registration UI bo‘lmasin. Dashboardda assigned route/vehicle summary (optional metadata bo‘sh bo‘lishi mumkin).

Actions:
- Start Shift
- active shift status/timer
- End Shift
- GPS permission/status
- connection/offline queue status

Start Shiftdan keyin location periodik Dev1 APIga yuborilsin. Internet uzilganda IndexedDB/local durable queuega timestamped GPS points yoz; reconnectda batch sync, idempotency IDs bilan. Battery/networkni hisobga olib sensible interval; interval backend/configdan olinishi afzal.

## Stage 2 — Driver live map + waiting clients
Driver mapda assigned route geometry va shu route’ni `Kutayapman` holatida kuzatayotgan barcha clientlarning exact GPS nuqtalari realtime ko‘rinsin. Client `Mashinadaman` qilishi bilan marker event orqali yo‘qolsin. Client identity/PII kerak emas; marker/session ID yetarli.

Parking geofence statusni backenddan ko‘rsatish mumkin: “stoyanka hududida” va current count. Driver qo‘lda stoyankadaman bosmaydi.

## Stage 3 — Driver payments
Driver o‘z vehicleiga tushgan paymentlarni real-time/listda ko‘radi: amount, time, status, payment reference (kerakli minimal data). Allowed transaction uchun Undo/Refund action; confirmation dialog va backend rejection/reason handling. Driver boshqa vehicle paymentini ko‘ra/undo qila olmasin.

Driver balance/earnings summary va cash-out request UI. Ledger tarixini tushunarli ko‘rsat.

## Stage 4 — Uyushma dashboard
Bitta Uyushma account. Dashboard KPIs: owned routes, active shifts/visible vehicles, parkings counts, payments, pending cashouts. Uyushma faqat o‘z data’sini ko‘radi.

CRUD:
- routes
- route directions
- drivers (create account; driver self-register yo‘q)
- vehicles
- parkings/stoyankalar
- fare rules

1 Driver=1 Vehicle=1 Route rule UI validationda ham aks etsin. Vehicle plate/type/model/color optional.

## Stage 5 — Visual Route Editor
Bu muhim feature. MapTiler mapda:
1. route number/name yaratish;
2. direction: outbound/inbound;
3. A va B ni map/search bilan tanlash;
4. backend/providerdan auto path olish;
5. route ustiga waypoint qo‘shish/drag/reorder/delete;
6. har o‘zgarishda A→waypoints→B qayta route;
7. geometry preview;
8. save draft/publish.

Outbound va inbound mustaqil tahrir qilinadi. Operator uchun oson UX: map click, draggable waypoint, undo last edit, fit bounds, unsaved changes warning. Routing provider logicni frontendga hardcode qilma; Dev1 endpointidan foydalan.

## Stage 6 — Fare + finance operations
Uyushma fare rule yaratadi. MVP fixed fare UI, lekin backend supported rule typesni extensible render qiladigan architecture. Payments/refunds list, filters, cashout request approval/reject/mark paid. Financial destructive actionlarda confirmation + audit reason input kerak bo‘lishi mumkin; backend contractga mos qil.

## Stage 7 — Super Admin
Global dashboard va CRUD:
- Uyushmalar (create/edit/archive)
- all routes/directions
- all drivers/vehicles
- clients
- parkings
- shifts/live vehicle status
- payments/refunds/cashouts
- system settings
- audit logs

Super Admin Uyushma yaratadi. Impersonationni backend explicitly bermasa implement qilma. Dangerous actions confirmation va audit-friendly UX.

## Stage 8 — Realtime operations
Uyushma/Admin live map: visible active vehicles, route filter, driver/vehicle detail drawer, last seen, shift status, parking count. “Offline/no visible GPS”ni “transport mavjud emas” deb talqin qilma.

Websocket reconnect/backoff, stale marker, unsubscribe cleanup.

## Stage 9 — Flutter WebView wrapper
PWA stable bo‘lgach minimal Flutter wrapper:
- configurable production web URL
- WebView navigation/back handling
- external links policy
- geolocation permissions
- camera permission for QR if needed
- NFC bridge only where required/feasible
- FCM permission/token collection
- FCM tokenni backend device registration endpointga yuborish
- notification tap → appropriate web route/deep-link
- loading/error/offline shell

Business logicni Flutterga duplicate qilma. Web/PWA source-of-truth; Flutter native capabilities bridge/container vazifasida.

## Stage 10 — Tests & delivery
Driver: shift, GPS permission, offline queue/sync, waiting-client marker lifecycle, payment refund, cashout.
Uyushma: driver CRUD, assignment validation, route editor, direction save, fare, cashout approval.
Admin: tenant CRUD/filters/settings/audit.
Flutter: build smoke test, FCM token/deep link integration where testable.

## Deliverables
- Driver PWA
- Uyushma operations panel
- Super Admin panel
- visual MapTiler route editor
- finance/refund/cashout UIs
- realtime operations maps
- Flutter WebView wrapper + FCM bridge
- tests/setup notes

## Dependencies
Dev1 owns all backend contracts. Route editor requires Dev1 route/path/waypoint APIs. GPS sync requires Dev1 idempotent batch endpoint. Payment/refund/cashout requires Dev1 ledger APIs. Dev2 owns consumer Client UI; uning filesiga tegma. Shared component zarur bo‘lsa parallel edit qilmay, ownershipni PR orqali kelish.
