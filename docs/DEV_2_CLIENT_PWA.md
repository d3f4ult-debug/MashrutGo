# DEVELOPER 2 SUPER PROMPT — Client PWA, Search, Map, Route Experience

## Mission
Sen Client-facing PWA ownerisan. Starter kitdan foydalanib mavjud React + TypeScript + Tailwind conventionsni saqla. Mobile-first, desktop responsive, installable PWA yarat. Backendni qayta yozma.

## Git ownership — conflict qilma
Ownership: client pages/routes, client components, client map/search UI, PWA client service worker/offline UX, client state/query hooks, client-specific styles/tests. Backend va Driver/Uyushma/Admin sahifalariga tegma. API contractni Dev1 OpenAPI/shared client orqali ishlat. Contract yetishmasa mock bilan davom et va Dev1ga exact schema request yoz.

## Stage 0 — Starter audit + UI foundation
Existing routing/layout/theme/component patternsni tahlil qil. Remix Icon ishlat. Tailwind design tokensni imkon qadar mavjud starterga moslashtir. Accessible buttons/forms, touch targets, loading skeletons, empty/error/offline states.

Client app login talab qilmasdan asosiy routingni ishlatsin. Auth UI faqat wallet/payment/personal features kerak bo‘lganda chiqsin.

## Stage 1 — Home + destination search
Primary UX: “Qayerga bormoqchisiz?”
- A default = current GPS (permission bilan)
- A search/map orqali editable
- B search/map orqali tanlanadi
- recent/favorite faqat account bo‘lsa optional
- MapTiler geocoding/search adapter
- route number search secondary feature

Location permission rad etilsa manual A ishlasin. GPS unavailable bo‘lsa app buzilmasin.

## Stage 2 — Route alternatives UI
Backend itinerary response’ni user-friendly cardsga aylantir. Bir nechta variant: fastest, cheapest, least walking, least transfers. Har cardda total ETA/time, fare, walking, transfer count, route numbers, live availability indication.

Leg visualization: Walk → Route 15 → transfer → Route 7 → Walk. Walking-only variantni ham ko‘rsat. Hard 500m warning/limit yo‘q. Online vehicle ko‘rinmasa “Hozir online transport ko‘rinmayapti” kabi neutral status; “mashina yo‘q” demang.

## Stage 3 — Map itinerary
MapTiler mapda selected itineraryni chiz:
- walking legs
- transit route geometry
- boarding/alighting/transfer points
- current user marker
- live vehicles

Mobile bottom-sheet + map UX; desktop split panel/map. Route detailni step-by-step ko‘rsat. Map interaction performancega e’tibor ber.

## Stage 4 — Live vehicle tracking + ETA
Selected route/itinerary uchun websocketga ulan. Vehicle markerlarni smooth update qil; stale statusni ko‘rsat. ETA mavjud bo‘lsa ko‘rsat, backend null qaytarsa uydirma ETA yaratma. User selected specific route number (`15`) bo‘lsa route geometry + barcha visible active vehicles + parking counts ko‘rinsin.

## Stage 5 — “Kutayapman” / Client watch
User selected route/leg uchun `Kutayapman / Yo‘nalishni kuzatish` action. Explicit actiondan keyin exact GPS backendga yuboriladi va route driverlariga ko‘rinadi. UI active-sharing state, stop action va permission statusni aniq ko‘rsatsin.

`Mashinadaman` bosilganda watch GPS sharingni darhol stop qil va ride statega o‘t. Concrete vehicle tanlash talab qilinmaydi. `Tushdim` bilan state tugaydi. Page reload/offline holatida state server/local persistence bilan restore qilinsin.

## Stage 6 — Auth + Wallet
Anonymous user route/mapni davom ettira oladi. Wallet/payment bosilganda login/register flow. Backend contractga mos OTP/password qaysi biri mavjud bo‘lsa shuni implement qil; backendda yo‘q auth usulini o‘zing invent qilma.

Wallet screens: balance, Click orqali top-up initiation/status, transaction history. Pending/success/failed states. Payment callbackdan qaytganda reconciliation.

## Stage 7 — Transport payment
Payment entry points:
- QR scan (browser capability/fallback)
- NFC capability mavjud bo‘lsa progressive enhancement; unsupported device uchun fallback
- vehicle number/internal identifier manual entry/search

Resolved vehicle/route/Uyushma/fare confirmationni to‘lovdan oldin ko‘rsat. Wallet yoki supported provider flow. Double-submitdan himoya va payment status polling/realtime.

## Stage 8 — PWA/offline
Install manifest, icons placeholders, service worker strategy. Offline paytda cached shell va oldingi route detail ko‘rinishi mumkin, ammo stale/live data aniq belgilansin. Client watch/payment kabi server-required action offline bo‘lsa queue qilish xavfli bo‘lsa bloklab tushunarli message ber; financial actionni avtomatik duplicate queue qilma.

Geolocation foreground behavior robust bo‘lsin. Mobile browser background limitationsni UI assumptionsga aralashtirma.

## Stage 9 — Quality
Responsive breakpoints: small mobile, large mobile/tablet, desktop. Keyboard/accessibility. Map cleanup/unsubscribe. Websocket reconnect/backoff. Abort stale searches. Empty states. Localization-ready Uzbek stringsni centralized resourcega chiqarish afzal.

Tests: route card rendering, itinerary legs, anonymous flow, location denial, watch lifecycle, websocket updates, wallet top-up states, payment confirmation.

## Deliverables
- Client PWA fully navigable from starter kit
- destination → alternatives → selected itinerary → live tracking flow
- route-number browse/search
- watch/on-car/exited states
- auth/wallet/payment UI
- PWA install/offline handling
- client tests and README notes

## Dependencies
Dev1: OpenAPI, route-search schema, websocket events, auth/wallet/payment endpoints. Dev3 bilan shared visual primitives kerak bo‘lsa duplicate file edit qilmang: starter primitive’ni bitta owner orqali PR qiling. Dev3ning admin/driver routesiga tegma.
