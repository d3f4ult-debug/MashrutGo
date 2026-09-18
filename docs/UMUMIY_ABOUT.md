# UMUMIY ABOUT — Andijon Smart Route Platform

## 1. Loyiha maqsadi
Andijon viloyatidagi Damas, Gazel va boshqa yo‘nalishli transportlardan foydalanishni raqamlashtirish. Client A nuqtadan B nuqtaga manzil kiritadi; tizim piyoda yurish, bir yoki bir nechta yo‘nalishli transport va transferlarni birlashtirib bir nechta real yo‘l variantlarini ko‘rsatadi. Natijalar eng tez, eng arzon, eng kam piyoda va eng kam transfer kabi mezonlarda ko‘rilishi mumkin.

## 2. Platformalar va stack
- Backend: Python + FastAPI
- Frontend: ReactJS + TypeScript + Tailwind CSS + Remix Icon
- Web: responsive PWA (mobile + desktop)
- Mobile release: Flutter WebView wrapper + FCM push notifications
- Database MVP: SQLite; schema PostgreSQLga ko‘chirishga tayyor yozilsin
- Map: MapTiler
- Realtime: WebSocket; GPS ingest uchun REST/WebSocket arxitekturasi
- Routing: graph algorithms
- Offline: Driver PWA GPS queue + reconnect sync

## 3. Rollar
### Client
Login qilmasdan route qidirishi, map va live transportlarni ko‘rishi mumkin. Login asosan wallet/card payment kabi personal funksiyalar uchun kerak. Default A=current GPS, lekin A ham, B ham search/map orqali o‘zgartiriladi. Route raqamini ham alohida qidirish mumkin.

### Driver
Self-registration yo‘q. Accountni Uyushma yaratadi. 1 Driver = 1 Vehicle = 1 Route. Driver Start Shift qilganda GPS uzatish va live ko‘rinish boshlanadi; End Shift bilan tugaydi. Internet uzilsa GPS lokal queuega yozilib, qaytganda sync qilinadi. Driver o‘z vehicleiga tushgan paymentlarni ko‘radi va ruxsat etilgan paymentni undo/refund qila oladi.

### Uyushma
Uyushmani faqat Super Admin yaratadi. Hozircha bitta Uyushma account yetarli. Bitta Uyushma ko‘p route raqamlariga egalik qilishi mumkin, ammo bitta route raqami faqat bitta Uyushmaga tegishli. Uyushma route, direction, waypoint, stoyanka, driver, vehicle, tarif, payment/cash-out ma’lumotlarini boshqaradi. Driver accountlarini Uyushma yaratadi.

### Super Admin
Barcha Uyushma, route, driver, client, vehicle, stoyanka, payment va system settings ustidan to‘liq CRUD/nazorat.

## 4. Routing UX
Client destination kiritadi. A odatda current GPS. Tizim route graph orqali alternativalarni topadi. Hard walking limit yo‘q: agar transportgacha 1–3 km piyoda yurish zarur bo‘lsa yoki butun yo‘l piyoda bo‘lsa ham variant ko‘rsatiladi. Transfer soniga hard limit yo‘q. Natijada har bir variant uchun ETA/umumiy vaqt, walking distance, ishlatiladigan route raqamlari, transferlar va narx ko‘rsatiladi.

Live vehicle mavjud bo‘lsa, “eng tez” hisobida vehicle ETA/waiting time ham qatnashadi. Live vehicle ko‘rinmasa route yashirilmaydi: UI “Hozir online transport ko‘rinmayapti” deydi; bu real transport yo‘q degani emas.

## 5. Route yaratish
Uyushma/Admin MapTiler mapda route yaratadi. A va B berilganda yo‘l avtomatik chizilishi kerak. Operator route orasiga waypoint qo‘shib, kerakli ko‘chalardan o‘tkaza oladi. Har route uchun outbound va inbound (A→B, B→A) direction alohida geometry bo‘ladi, chunki qaytish boshqa ko‘chalardan o‘tishi mumkin.

Graph modeli konseptual ravishda walking edges + transit route segments + transfer/walk connectorsdan tuziladi. Multi-criteria cost: time, fare, walking, transfers. Routing implementation boshqa modullardan ajratilgan service bo‘lsin.

## 6. Realtime GPS va stoyanka
Driver shift active bo‘lganda GPS periodik yuboriladi. Server last location, speed, heading, timestamp va route progressni saqlaydi. Stoyanka geofence orqali avtomatik: transport stoyanka radiusiga kirsa stoyankadagi live vehicle soniga qo‘shiladi. Radius configurable bo‘lsin.

Client route natijasini/route raqamini kuzatib “Kutayapman / Yo‘nalishni kuzatish” holatiga kirsa, uning aniq GPS nuqtasi shu route’dagi barcha active driverlarga ko‘rinadi. Client “Mashinadaman” bosganda nuqta driver mapidan yo‘qoladi. “Tushdim” bilan ride state tugaydi. Bu tracking konkret vehicle tanlashga bog‘lanmaydi.

## 7. ETA
Live vehicle uchun route geometry bo‘yicha client/boarding pointgacha qolgan masofa, current/recent speed va kerakli smoothing orqali ETA hisoblanadi. Traffic provider bo‘lmasa ham MVP ETA ishlashi kerak. Data yetarli bo‘lmasa UI ETAni noaniq/unavailable deb ko‘rsatadi; uydirma vaqt ko‘rsatilmaydi.

## 8. Payments va wallet
- External payment integrations: Click birinchi; keyinchalik Payme/Uzum/HUMO va boshqalar adapterlar orqali.
- Internal wallet mavjud. Wallet top-up Click orqali qilinadi.
- Transport payment identifikatsiyasi: QR, NFC yoki vehicle number/identifier.
- Vehicle plate/type/model/color optional; backend har vehicle uchun mandatory unique internal ID yaratadi.
- Fare Uyushma tomonidan belgilanadi. Tarif engine flexible bo‘lsin: MVPda fixed fare qo‘llab-quvvatlansin, keyinchalik zone/distance/other rules qo‘shish oson bo‘lsin.
- Driver o‘z vehicleiga tushgan paymentlarni ko‘radi va undo/refund flowga ega.
- Driver yig‘ilgan summani cash-out request qiladi; Uyushma tasdiqlab naqd berishi va ledgerda qayd etishi mumkin.
- Barcha moliyaviy o‘zgarishlar immutable transaction/ledger/audit record bilan yuritilsin; balance faqat ledgerdan nazorat qilinadi.

## 9. Asosiy domain entitylar
User, ClientProfile, Uyushma, DriverProfile, Vehicle, Route, RouteDirection, RouteWaypoint, Stop/Parking(Stayanka), DriverShift, GPSPoint/LocationSnapshot, ClientRouteWatch, ClientRideState, FareRule, Wallet, WalletTransaction, Payment, Refund, CashoutRequest, Notification, SystemSetting, AuditLog.

## 10. API va realtime contract tamoyili
Backend OpenAPI source-of-truth. Frontend typed API client generated/centralized bo‘lsin. Realtime eventlar versionlangan contract bilan: vehicle.location.updated, route.vehicle.status, parking.count.updated, client.watch.started/updated/stopped, payment.updated va h.k. Event payloadlari shared contract hujjatida yozilsin.

## 11. Security va privacy
JWT/session auth + role based authorization. Uyushma faqat o‘z resurslarini, Driver faqat o‘z shift/vehicle/paymentlarini ko‘radi. Super Admin global. Client exact GPS faqat explicit active watch vaqtida tegishli route driverlariga realtime yuboriladi; watch tugagach broadcast to‘xtaydi. Secrets repositoryga commit qilinmaydi. Payment webhook signature/idempotency tekshirilsin. Refund/cash-out audit qilinsin.

## 12. Git va 3 developer ishlash qoidasi
Hammasi bir xil starter kitdan boshlaydi. Shared/core fayllar uchun ownership qat’iy: Developer 1 backend/core va API contract; Developer 2 Client PWA; Developer 3 Driver + Uyushma/Admin UI va Flutter wrapper. Bir developer boshqa developer ownershipidagi faylni o‘zgartirmaydi. Shared contract o‘zgarishi PR orqali Developer 1 tomonidan amalga oshiriladi. Har feature alohida branch va kichik PR. Generated/build files commit qilinmaydi (starter talab qilmasa).

Recommended branches:
- dev1/backend-routing-payments
- dev2/client-pwa
- dev3/operations-driver-admin

Integration tartibi: Dev1 avval auth/domain/OpenAPI skeletonni stabil qiladi; Dev2 va Dev3 mock/contract bilan parallel ishlaydi; keyin backend contractga ulanadi. Breaking API o‘zgarishi oldindan contract changelogda qayd etiladi.

## 13. Definition of Done
Feature faqat UI chizilganda tugagan hisoblanmaydi: validation, auth/authorization, loading/error/empty/offline states, responsive mobile/desktop, API integration, basic tests, no console errors, migration/schema update, audit/security talablar va README notes bajarilgan bo‘lishi kerak.
