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

| Tekshiruv | Natija |
|---|---|
| `pytest` (backend) | **94 passed** |
| `vitest` (frontend) | **134 passed** (20 fayl) |
| `tsc --noEmit` | xatosiz |
| `eslint src` | xatosiz |
| `npm run build` | muvaffaqiyatli |
| Brauzer E2E (haqiqiy Chrome, barcha rollar) | **70 passed, 0 failed** |
| Brauzer E2E (client oqimlari: watch + sandbox to'ldirish) | **7 passed, 0 failed** |
| `flutter analyze` / `flutter test` | toza / **6 passed** |

Brauzer E2E quruq "sahifa ochildi"dan iborat emas — real zanjirlar tekshiriladi:
smena boshlanishi → brauzer GPS'i jonli xaritaga yetib borishi → yo'lovchining "Kutayapman"
belgisi haydovchi xaritasida paydo bo'lishi va "Mashinadaman"da yo'qolishi → to'lovning haydovchi
ekranida jonli ko'rinishi → sandbox hamyon to'ldirishning ledgerga tushishi.

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
7. **Asosiy JS chunk ~1 MB** (gzip ~290 KB): client PWA to'liq eager yuklanadi, xodimlar paneli esa
   alohida chunk'larda. Yo'lovchi uchun yanada tezlashtirish mumkin.

---

## 6. Production oldidan bajarilishi shart

- [ ] `SECRET_KEY`, `DATABASE_URL` (PostgreSQL), `TRUSTED_PROXIES`, Click merchant kalitlari — real
      qiymatlar bilan; `APP_ENV=production` da ishga tushirib tekshirish.
- [ ] `alembic upgrade head` PostgreSQL'da, so'ng yuk ostidagi pul testlarini qayta o'tkazish.
- [ ] Click webhook'ini haqiqiy sandbox merchant bilan uchidan-uchiga sinash.
- [ ] Redis: rate limit + WebSocket fan-out (bir nechta worker rejasi bo'lsa).
- [ ] Monitoring: `/api/v1/health`, xato jurnali, ledger izchilligi (`/admin/ledger/health`) uchun alert.
- [ ] Android foreground service (fon rejimidagi GPS) — mahsulot qaroriga bog'liq.
