# MashrutGo — Andijon Smart Route Platform

Andijon viloyati yo‘nalishli transporti (Damas, Gazel va boshqalar) uchun raqamli platforma:
yo‘lovchi A→B manzilini kiritadi, tizim piyoda + transport + almashishlardan iborat real variantlarni
hisoblaydi, transportni jonli kuzatadi va yo‘l haqini to‘laydi.

| Qism | Texnologiya | Papka |
|---|---|---|
| Backend API + realtime | Python 3.12, FastAPI, SQLAlchemy, Alembic, WebSocket | `backend/` |
| Web ilova (Client PWA + Driver + Uyushma + Super Admin) | React 18, TypeScript, Vite, MapLibre GL | `frontend/` |
| Mobil qobiq (WebView + FCM + NFC) | Flutter | `mobile/` |
| Shartnomalar va hujjatlar | Markdown | `docs/` |

Rollar: **Client** (login talab qilinmaydi), **Driver** (smena, GPS, to‘lovlar), **Uyushma** (yo‘nalish,
haydovchi, transport, stoyanka, tarif, moliya), **Super Admin** (butun platforma).

---

## 1. Tezkor ishga tushirish

### Backend

```bash
cd backend
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt          # requirements.txt + pytest/ruff
cp .env.example .env                          # kalitlarni to‘ldiring (haqiqiy secret commit qilinmaydi)
uvicorn app.main:app --reload --port 8000
```

- OpenAPI (Swagger): <http://localhost:8000/api/v1/docs>
- Startda Alembic migratsiyalari avtomatik qo‘llanadi (`AUTO_MIGRATE=true`).
- `SEED_DEMO_DATA=true` bo‘lsa Andijon demo ma’lumotlari yaratiladi (production’da taqiqlangan).

### Frontend

```bash
cd frontend
npm install
cp .env.example .env     # ixtiyoriy: MapTiler kaliti. Bo‘sh bo‘lsa OpenStreetMap ishlatiladi
npm run dev              # http://localhost:5173
```

Vite dev-server `/api` (REST **va** WebSocket) so‘rovlarini `http://127.0.0.1:8000` ga proksi qiladi,
shuning uchun odatda hech qanday `VITE_*` o‘zgaruvchi shart emas.

### Demo hisoblar (`SEED_DEMO_DATA=true`)

| Rol | Login | Parol |
|---|---|---|
| Super Admin | `+998901234567` | `admin123` |
| Uyushma admin | `+998901234568` | `uyushma123` |
| Haydovchilar | `+998901110001` … `+998901110004` | `driver123` |
| Mijoz | `+998901112233` | `client123` |

> Bu parollar faqat lokal ishlab chiqish uchun. Production’da `BOOTSTRAP_ADMIN_PHONE` /
> `BOOTSTRAP_ADMIN_PASSWORD` majburiy, demo seed esa o‘chirilgan bo‘lishi kerak.

---

## 2. Testlar

```bash
cd backend  && .venv/bin/python -m pytest -q      # 88 test: RBAC, routing, ETA, GPS, to‘lov, ledger, realtime
cd frontend && npm test                           # vitest: API mapperlar, GPS navbat, hooklar, sahifalar
cd frontend && npm run typecheck                  # tsc --noEmit
cd mobile   && flutter test && flutter analyze    # deep link, tashqi havola siyosati, NFC dekoderi
```

---

## 3. Arxitektura xulosasi

### Backend (`backend/app`)
- `api/v1/` — auth, uyushma, routes, routing, eta, geo, driver, client_watch, parking, payments,
  operations, notifications, admin, websocket.
- `services/` — `routing/` (graph router, OSRM/MapTiler adapterlari, ETA), `realtime/` (tracking,
  client watch, connection manager), `payments/` (Click adapteri, top-up), `ledger_service`,
  `payment_service`, `fare_engine`, `notification_service`, `settings_service`.
- `models/` — SQLAlchemy modellari (SQLite MVP, PostgreSQL’ga tayyor: UUID/Integer PK, `UTCDateTime`,
  `sa.JSON`/`Text`, aniq FK va `ondelete`).
- Moliya: balans hech qachon to‘g‘ridan-to‘g‘ri yangilanmaydi — har bir o‘zgarish o‘zgarmas
  `wallet_transactions` yozuvi bilan, idempotentlik kaliti orqali amalga oshadi.

### Frontend (`frontend/src`)
- `services/api/` — `client.ts` (yagona HTTP klient: xato/401/timeout/idempotency), `clientApi`,
  `driverApi`, `uyushmaApi`, `financeApi`, `adminApi`, `routeEditorApi`. Har biri backend DTO’larini
  UI modellariga aylantiradi; **mock ma’lumot yo‘q**.
- `services/realtime/websocket.ts` — ref-hisobli umumiy kanallar (`publicChannel`, `driverChannel`),
  eksponensial qayta ulanish, ping.
- `services/driver/` — `gpsQueue` (IndexedDB oflayn navbat), `gpsTracker` (yuborish/qayta urinish/
  batch sinxronizatsiya), `waitingPassengers` (sof reducer).
- `contexts/DriverSessionContext.tsx` — smena, GPS, WS va kutayotgan yo‘lovchilar bir joyda
  (sahifalar almashganda GPS uzilmaydi).
- Sahifalar: `features/client/`, `pages/` (client), `pages/driver/`, `pages/uyushma/`,
  `pages/operations/`, `pages/admin/`.

### Mobil (`mobile/`)
Biznes-mantiq faqat web’da. Flutter qobiq: GPS/kamera ruxsatlari, NFC o‘qish, FCM push va
deep-link, tashqi havolalar siyosati, oflayn ekran, ekranni yoqiq saqlash.

---

## 4. Muhit o‘zgaruvchilari (asosiylari)

`backend/.env` (to‘liq ro‘yxat: `backend/.env.example`)

| Kalit | Ma’nosi |
|---|---|
| `SECRET_KEY` | JWT imzosi. Production’da majburiy (≥32 belgi) |
| `DATABASE_URL` | `sqlite:///./app.db` yoki `postgresql+psycopg2://…` |
| `ROUTING_PROVIDER` / `OSRM_BASE_URL` | Yo‘l geometriyasi: `osrm` (production’da o‘z serveringiz) yoki `geodesic` |
| `MAPTILER_API_KEY` | Geokodlash (bo‘sh bo‘lsa faqat bazadagi bekatlar bo‘yicha qidiriladi) |
| `CLICK_*`, `PAYMENTS_SANDBOX` | Click to‘lov adapteri; sandbox faqat development’da |
| `FCM_ENABLED`, `FCM_PROJECT_ID`, `FCM_CREDENTIALS_PATH` | Push xabarnomalar (bo‘lmasa no-op) |
| `GPS_STALE_THRESHOLD_SECONDS`, `PARKING_GEOFENCE_DEFAULT_RADIUS_METERS`, `CLIENT_WATCH_HEARTBEAT_TIMEOUT_SECONDS` | Realtime chegaralari |

---

## 5. Mobil ilova

Batafsil: [`mobile/README.md`](mobile/README.md).

```bash
cd mobile
flutter pub get
flutter run --dart-define=WEB_URL=http://10.0.2.2:5173          # Android emulyator
flutter build apk --release --dart-define=WEB_URL=https://app.mashrutgo.uz
```

FCM kalitlari `--dart-define=FCM_API_KEY=… FCM_APP_ID=… FCM_SENDER_ID=… FCM_PROJECT_ID=…` orqali
beriladi; berilmasa push shunchaki o‘chiq bo‘ladi (soxta token yaratilmaydi).

---

## 6. Hujjatlar

- [`docs/UMUMIY_ABOUT.md`](docs/UMUMIY_ABOUT.md) — mahsulot talablari.
- [`docs/contracts/API_CHANGELOG.md`](docs/contracts/API_CHANGELOG.md) — API o‘zgarishlar tarixi.
- [`docs/contracts/REALTIME_EVENTS.md`](docs/contracts/REALTIME_EVENTS.md) — WebSocket shartnomasi.
- [`docs/contracts/STARTER_KIT_AUDIT.md`](docs/contracts/STARTER_KIT_AUDIT.md) — arxitektura auditi.
- [`docs/INTEGRATION_AUDIT.md`](docs/INTEGRATION_AUDIT.md) — joriy holat, qamrov va ochiq savollar.

## 7. Ma’lum cheklovlar

- Driver GPS faqat ilova ochiq (ekran yoniq) bo‘lganda yuboriladi. To‘liq fon rejimi uchun Android
  foreground service kerak — hozircha yo‘q, shuning uchun qobiq ekranni yoqiq ushlab turadi.
- Standart `ROUTING_PROVIDER=osrm` ommaviy demo serverga ishlaydi (fair-use limiti bor) —
  production uchun OSRM’ni o‘zingiz hosting qiling.
- Click adapteri sandbox/webhook oqimi bilan tayyor, lekin haqiqiy merchant kalitlari bilan
  sinovdan o‘tkazilmagan. Payme/Uzum/HUMO uchun provider interfeysi qoldirilgan.
