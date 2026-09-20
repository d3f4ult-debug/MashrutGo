# Integratsiya auditi — joriy holat, qamrov va ochiq savollar

**Sana**: 2026-09-20 · **Qamrov**: `backend/`, `frontend/`, `mobile/`
**Maqsad**: har bir rol interfeysi mock ma'lumot bilan emas, haqiqiy API bilan ishlashini tekshirish va
production oldidan qolgan ishlarni ochiq yozib qo'yish.

Bu hujjat "hammasi tayyor" degan bayonot emas. Quyida nima **ishlaydi va tekshirilgan**, nima
**qasddan cheklangan**, nima esa **production oldidan qilinishi shart** — uchalasi alohida yozilgan.

---

## 1. Modullar bo'yicha holat

| Modul | Holat | Izoh |
|---|---|---|
| Backend API (FastAPI) | Ishlaydi | 94 pytest testi; barcha endpointlar OpenAPI'da (`/api/v1/docs`) |
| Client PWA (yo'lovchi) | Ishlaydi | Qidiruv, yo'nalish tafsiloti, jonli transport, hamyon, to'lov — hammasi real API |
| Driver PWA | Ishlaydi | Smena, GPS uzatish, offline navbat, kutayotgan yo'lovchilar, to'lovlar, pul yechish |
| Uyushma paneli | Ishlaydi | Haydovchi/transport/stoyanka/tarif/yo'nalish CRUD, moliya, jonli xarita |
| Operations jonli xarita | Ishlaydi | WebSocket fleet, filtrlar, transport kartasi |
| Super Admin | Ishlaydi | Uyushmalar, mijozlar/hamyon, smenalar, sozlamalar, audit jurnali |
| Mobil qobiq (Flutter) | Ishlaydi | WebView + native GPS/NFC/FCM ko'prigi; `flutter analyze` toza, 6 test |
| To'lov (Click) | Qisman | Sandbox va webhook oqimi to'liq; haqiqiy merchant kalitlari bilan sinalmagan |

---

## 2. Mock ma'lumotdan haqiqiy integratsiyaga

Avval interfeyslarda qattiq yozilgan (hardcoded) ma'lumotlar bor edi. Ularning o'rniga qo'yilgani:

- **Driver**: `driverApi` (smena, GPS, kutayotgan yo'lovchilar, to'lov/hamyon/pul yechish) +
  `driverChannel` WebSocket. GPS brauzer yoki native GPS'dan olinadi, IndexedDB'dagi offline
  navbat orqali kafolatlangan yetkaziladi.
- **Uyushma / Operations / Admin**: `uyushmaApi`, `adminApi`, `financeApi`, `routeEditorApi` —
  barcha ro'yxat, KPI, moliya va audit ma'lumotlari serverdan.
- **Client**: yo'nalish qidiruvi (`/routing/search`), jonli transport (WebSocket), hamyon va
  to'lov (`/payments/*`, `/wallet/*`), "Kutayapman" holati (`/client/watch/*`).
- **Xarita**: MapLibre + MapTiler/OSRM adapteri; yo'nalish geometriyasi bazadan.

Endi loyihada foydalanuvchiga ko'rsatiladigan soxta ma'lumot yo'q: ma'lumot yuklanmasa, interfeys
bo'sh yoki xato holatini ochiq ko'rsatadi (0 yoki "—" bilan yashirmaydi).

---

## 3. Tekshiruv dalillari

Quyidagilar shu auditning oxirida qayta ishga tushirildi:

| Tekshiruv | Buyruq | Natija |
|---|---|---|
| Backend testlari | `cd backend && pytest -q` | **100 passed** |
| Backend lint | `cd backend && ruff check .` | toza (`backend/ruff.toml`) |
| Frontend testlari | `cd frontend && npm test` | **134 passed** (20 fayl) |
| Tiplar | `cd frontend && npm run typecheck` | xatosiz |
| Frontend lint | `cd frontend && npm run lint` | xatosiz |
| Build | `cd frontend && npm run build` | muvaffaqiyatli |
| Brauzer E2E | `cd e2e && npx playwright test` | **17 passed** |
| Mobil | `cd mobile && flutter test && flutter analyze` | **6 passed** / toza |

Hammasi CI'da ham ishlaydi (`.github/workflows/ci.yml`: `backend`, `frontend`, `mobile`, `e2e`).

Brauzer E2E quruq "sahifa ochildi"dan iborat emas — real zanjirlar tekshiriladi:
smena boshlanishi → brauzer GPS'i jonli xaritaga yetib borishi → yo'lovchining "Kutayapman"
belgisi haydovchi ro'yxatida paydo bo'lishi va "Mashinadaman"da yo'qolishi → to'lovning haydovchi
balansi va ekraniga yetib borishi → sandbox hamyon to'ldirishning ledgerga tushishi.

> **Avvalgi versiyadagi xato**: bu jadval "70 + 7 passed brauzer E2E" deb yozgan edi, lekin o'sha
> testlar repoda saqlanmagan — ularni takrorlab bo'lmasdi. Endi to'plam `e2e/` papkasida va CI'da.

---

## 4. Auditda topilgan va tuzatilgan muhim kamchiliklar

### 4.1 Kritik — pul

- **Sandbox to'ldirishda pul "ko'payishi"**: `topup_service` tranzaksiya identifikatorini tasodifiy
  generatsiya qilar edi, shuning uchun bir buyurtmani bir necha marta tasdiqlash mumkin edi.
  Endi identifikator buyurtma id'sidan olinadi va kredit berishdan oldin shartli `UPDATE` bilan
  band qilinadi. Regressiya testi: `test_sandbox_topup_credits_once_under_concurrency`.
- **Bir vaqtda qaytarish / pul yechish**: hamyon qulflanmagani uchun parallel so'rovlar 500 qaytarar
  va balansdan ortiq mablag' band qilinishi mumkin edi. Endi `lock_wallet` + qayta o'qish, xatolar
  toza 409 bo'lib qaytadi. Testlar: `backend/tests/test_money_concurrency.py` (5 ta).

### 4.2 Yuqori — xavfsizlik

- Dev muhit sirlari (`SECRET_KEY`, `SEED_DEMO_DATA`, `PAYMENTS_SANDBOX`) production'da ishga
  tushishni bloklaydi; `is_production` endi "fail-closed".
- `X-Forwarded-For` faqat sozlangan ishonchli proksidan qabul qilinadi (audit jurnalidagi IP
  soxtalashtirilmasligi uchun).
- Parol o'zgartirilganda eski tokenlar bekor bo'ladi (`password_changed_at` + token'dagi `pwd`).
- Login uchun ikki chelakli throttle (telefon+IP va telefon), ro'yxatdan o'tish va anonim transport
  qidiruvi uchun rate limit.
- GPS idempotentlik kaliti har transport uchun alohida unikal (boshqa haydovchining kaliti sizning
  nuqtangizni yutib yubormasligi uchun) — migratsiya `0002_security_hardening`.

### 4.3 Yuqori — ma'lumot yo'qolishi va noto'g'ri holat

- **Qurilma soati noto'g'ri bo'lsa butun smena GPS'i yo'qolardi**: telefon 2 daqiqadan ko'p oldinda
  bo'lsa server nuqtalarni rad etardi, ilova esa "Online" deb ko'rsataverardi. Endi har javobda
  `server_time` keladi, ilova farqni o'lchab nuqtalarni to'g'rilaydi va qayta yuboradi.
- **Smena offline yakunlansa oxirgi qismi o'chib ketardi**: endi navbat saqlanadi va
  `POST /driver/gps/batch` `shift_id` bilan o'sha smena tarixiga yoziladi (12 soat ichida,
  jonli xaritaga ta'sir qilmaydi).
- **Bitta yaroqsiz nuqta butun paketni yo'q qilardi**: paket endi ikkiga bo'linib yuboriladi,
  faqat aybdor nuqta tashlanadi.
- **Haydovchi ↔ transport biriktirishni o'zgartirib bo'lmasdi**: mijoz tomonidagi qoida tekshiruvi
  tahrirlanayotgan yozuvning o'z aloqasini ham taqiqlab qo'yardi. Endi faqat qarama-qarshi tomon
  tekshiriladi (testlar: `frontend/src/services/api/__tests__/uyushmaApi.test.ts`).
- **Tarifni saqlash pik oynasini o'chirardi**: `time_based` tarif tahrirlanganda `peak_start_hour` /
  `peak_end_hour` yuborilmay, `config` butunlay almashardi. Endi forma pik oynasini ham o'z ichiga
  oladi, qisman yangilanish esa `config`ga tegmaydi.
- **Super Admin uyushmani almashtirganda** eski tenant ma'lumoti va ochiq forma qolib ketardi;
  endi filtrlar, tanlov va formalar tozalanadi, kechikkan javob e'tiborsiz qoldiriladi.

### 4.4 O'rta — barqarorlik va UX

- Lazy yuklanadigan portal chunk'i tushmasa oq ekran chiqardi → `AppErrorBoundary`.
- Native ko'prik so'rovlari javob kelmasa abadiy osilib qolardi → timeout bilan yakunlanadi.
- `getCurrentPosition` timeout'siz edi (ichkarida hech qachon tugamasdi) → 15 s.
- Hamyon balansi o'qilmasa PaymentModal'da "…" abadiy qolardi → xato matni + qayta urinish.
- Balans yuklanmaguncha haydovchiga `0 so'm` emas, `—` ko'rsatiladi.
- Click to'lovini kutish polling'i sahifadan chiqilganda to'xtaydi.
- Bir vaqtda ikki marta saqlash (double submit) uyushma formalarida bloklanadi.

---

## 5. Ma'lum cheklovlar (qasddan, hozircha)

1. **Fon rejimidagi GPS yo'q.** Driver GPS faqat ilova ochiq bo'lganda yuboriladi; mobil qobiq
   ekranni yoqiq ushlab turadi. To'liq yechim — Android foreground service.
2. **Rate limiter va WebSocket bitta process ichida.** Bir nechta worker yoki server bo'lsa,
   hisoblagichlar bo'linib ketadi. Kengaytirishdan oldin Redis kerak.
3. **OSRM standart sozlamada ommaviy demo serverga ishlaydi** (fair-use limiti bor) — production
   uchun o'z OSRM'ingizni ko'taring yoki MapTiler kalitini bering.
4. **Click faqat sandbox'da sinalgan.** Payme/Uzum/HUMO uchun provider interfeysi ochiq qoldirilgan.
5. **SQLite MVP uchun.** Kod PostgreSQL'ga tayyor (`FOR UPDATE` qulflar, BigInteger pul ustunlari),
   lekin yuk ostidagi test PostgreSQL'da qayta o'tkazilishi kerak.
6. **IndexedDB ishlamay qolsa** (private rejim, kvota) navbat xotiraga o'tadi; o'sha seansda
   diskdagi eski nuqtalar kutib turadi va keyingi ochilishda yuboriladi.
7. **Xarita kutubxonasi og'ir** (maplibre-gl, gzip ~200 KB). Endi alohida chunk'da, shuning uchun
   deploylar orasida brauzer keshida qoladi; ilova kodi gzip ~35 KB. Xaritani faqat kerak bo'lganda
   yuklash (lazy) — keyingi qadam.

---

## 6. Production oldidan bajarilishi shart

- [ ] `SECRET_KEY`, `DATABASE_URL` (PostgreSQL), `TRUSTED_PROXIES`, Click merchant kalitlari — real
      qiymatlar bilan; `APP_ENV=production` da ishga tushirib tekshirish.
- [ ] `alembic upgrade head` PostgreSQL'da, so'ng yuk ostidagi pul testlarini qayta o'tkazish.
- [ ] Click webhook'ini haqiqiy sandbox merchant bilan uchidan-uchiga sinash.
- [ ] Redis: rate limit + WebSocket fan-out (bir nechta worker rejasi bo'lsa).
- [ ] Monitoring: `/api/v1/health`, xato jurnali, ledger izchilligi (`/admin/ledger/health`) uchun alert.
- [ ] Android foreground service (fon rejimidagi GPS) — mahsulot qaroriga bog'liq.

---

## 7. Ikkinchi audit (2026-09-20, mustaqil tekshiruv)

Yuqoridagi hujjat "hammasi ishlaydi" degan ohangda edi. Mustaqil qayta tekshiruv quyidagilarni
topdi; hammasi tuzatildi va har biri uchun regressiya testi bor.

### 7.1 Bloker — repo holati

Ishlayotgan ilovaning katta qismi git'ga umuman kirmagan edi: butun `alembic/` (migratsiyalar),
`payments.py`, `ledger_service.py`, `payment_service.py`, `admin.py`, `operations.py`,
`notifications.py`, `geo.py`, joriy 22 ta backend testi, `requirements-dev.txt`,
`frontend/.eslintrc.cjs`, `clientApi.ts`, `driverApi.ts`, `services/driver/`, Flutter `test/` va
native loyihalar — 95 ta untracked yo'l. Toza klon qurilmas, CI esa birinchi qadamda
(`pip install -r requirements-dev.txt`) yiqilardi. Hammasi commit qilindi.

### 7.2 Kritik — marshrut qidiruvi shahar miqyosida ishlamasdi

`_find_transfer_transit_itineraries` har juft yo'nalish × har juft bekat bo'yicha aylanardi
(O(R²·S²)), `_evaluate_multi_criteria` esa hech narsani kesmay barcha nomzodni to'liq polyline
bilan qaytarardi.

| Yo'nalishlar | Oldin | Hozir |
|---|---|---|
| 25 | 402 ms · 1 170 variant | 78 ms · 16 variant |
| 50 | 1 833 ms · 5 386 variant | 191 ms · 16 variant |
| 80 | 4 120 ms · 11 419 variant | 197 ms · 16 variant |
| 60 yo'nalishli shaharda javob hajmi | **25.4 MB** | **62 KB** |

Yechim: transfer qidiruvi endi origin/destination'ga eng yaqin bir nechta liniya bilan
cheklanadi (`TRANSFER_ACCESS_WALK_LIMIT_METERS`, `MAX_TRANSFER_ENDPOINT_CANDIDATES`), javob esa
qisqa ro'yxat (`MAX_ITINERARIES = 15`) bo'lib, 4 ta tavsiya etilgan variant har doim ichida qoladi.
Teng natijalar endi mazmunli va deterministik tartibda (kam transfer → kam piyoda → arzon → id).

### 7.3 Yuqori — ETA uydirma vaqt berardi

`eta_service` bekatni yo'nalishga proyeksiya qilib, perpendikulyar masofani **tashlab yuborardi**.
Natijada 22 km uzoqdagi nuqta haqiqiy bekat bilan bir xil javob olardi: 7 daqiqa, confidence 0.95.
Bu `UMUMIY_ABOUT.md` §7 dagi "uydirma vaqt ko'rsatilmaydi" tamoyilini buzardi. Endi bekat ham
transport kabi `OFF_ROUTE_TOLERANCE_METERS` bilan tekshiriladi.

### 7.4 Yuqori — "Kutayapman" spam qilinardi

`/client/watch/start` anonim, rate limit'siz va koordinata tekshiruvisiz edi. "Bitta sessiyaga
bitta watch" qoidasi mijoz yuboradigan `session_id`ga tayanardi, shuning uchun 50 ta so'rov bilan
bitta yo'nalishda 50 ta soxta "kutayotgan yo'lovchi" yaratib, hammasini haydovchilarga uzatish
mumkin edi — koordinatalar Moskvada bo'lsa ham. Endi kutish nuqtasi yo'nalish geometriyasidan
2 km dan uzoq bo'lsa 422 qaytadi (heartbeat ham tekshiriladi), ustiga IP bo'yicha throttle.

### 7.5 Yuqori — eng qimmat endpointlar himoyasiz edi

`/routing/search` va `/routing/eta` anonim va cheklovsiz edi. Endi ikkalasi ham throttle ostida;
chegaralar sozlanadigan (`RATE_LIMIT_*`), chunki O'zbekistonda mobil operatorlar ko'p abonentni
bitta IP ortiga qo'yadi.

### 7.6 Yuqori — mijoz kirish modali xatoni yutib yuborardi

`WalletPage` "kirish kerak" blokini `!authLoading` sharti bilan render qilardi. Foydalanuvchi
"Kirish" bosishi bilan `authLoading` true bo'lib, modal **unmount** bo'lardi — demak noto'g'ri
parol kiritilganda xato xabari hech qachon ko'rinmasdi. Brauzer E2E aynan shuni topdi.

### 7.7 O'rta — tekshiruv infratuzilmasi

- Backend lint CI'da umuman yo'q edi va ruff sozlamasi ham yo'q edi (`ruff check .` 1003 xato
  berardi). Endi `backend/ruff.toml` (xatolarga qaratilgan, uslub churn'isiz) va CI'da `ruff check`.
- Brauzer E2E to'plami yo'q edi. Endi `e2e/` — Playwright, haqiqiy Chromium, 17 test, CI'da.
- `graph_router`/`eta_service`dagi o'lik kod (o'z-o'ziga tayinlash), `raise ... from`siz
  qayta ko'tarishlar va shunga o'xshash kichik topilmalar tuzatildi.
- Xarita kutubxonasi alohida chunk'ga chiqarildi: ilova kodi gzip 290 KB → 35 KB.

### 7.8 Mock ma'lumot — qayta tekshirildi

Maxsus qidirildi: interfeyslarda soxta ma'lumot yo'q. Barcha "placeholder" — oddiy input
placeholder'lari, yagona `Math.random` idempotentlik kaliti uchun, hech qanday `setTimeout`
simulyatsiyasi yoki qattiq yozilgan KPI yo'q. Yagona sun'iy ma'lumot — `seed_service.py`,
`SEED_DEMO_DATA` bilan yopilgan va production'da ishga tushishni bloklaydi; soxta GPS yaratmaydi.
