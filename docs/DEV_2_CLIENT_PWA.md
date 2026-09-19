# DEVELOPER 2 SUPER PROMPT — Client PWA, Search, Map, Route Experience

## Mission
Sen Client-facing PWA ownerisan. Starter kitdan foydalanib mavjud React + TypeScript + Tailwind conventionsni saqla. Mobile-first, desktop responsive, installable PWA yarat. Backendni qayta yozma.

## Git ownership — conflict qilma
Ownership: client pages/routes, client components, client map/search UI, PWA client service worker/offline UX, client state/query hooks, client-specific styles/tests. Backend va Driver/Uyushma/Admin sahifalariga tegma. API contractni Dev1 OpenAPI/shared client orqali ishlat. Contract yetishmasa mock bilan davom et va Dev1ga exact schema request yoz.

---

## Status: BARCHA BOSQICHLAR TO‘LIQ YAKUNLANDI (STAGES 0–9 COMPLETED)

### Stage 0 — Starter audit + UI foundation [✓ BAJARILDI]
- Remix Icon CDN `frontend/index.html` ga qo‘shildi.
- Tailwind dizayn tokenlari `frontend/tailwind.config.cjs` va `index.css` ga joylashtirildi.
- UI primitivlari: `Input`, `SearchInput`, `Button`, `LoadingSkeleton`, `EmptyState`, `OfflineIndicator` (`frontend/src/components/ui/`).
- Markazlashgan mahalliylashtirish: `frontend/src/locales/uz.ts` yaratildi.
- Accessible tugmalar, kamida 44px touch targetlar va anonim-first navigatsiya ta’minlandi.

### Stage 1 — Home + destination search [✓ BAJARILDI]
- `frontend/src/features/client/pages/Home.tsx`:
  - "Qayerga bormoqchisiz?" asosiy qidiruv kartasi.
  - A nuqtasi: Joriy GPS koordinatalari (ruxsat berilganda) yoki qo‘lda tahrirlanadigan maydon. GPS ruxsati rad etilsa, ilova to‘xtab qolmaydi, balki markaziy manzilga o‘tadi.
  - B nuqtasi: Andijon shahrining diqqatga sazovor joylari bo‘yicha tezkor tavsiyalar (Registon, Yangi Bozor, Vokzal, Bobur bog‘i va b.).
  - So‘nggi qidiruvlar `localStorage` da saqlanadi.
  - Marshrut raqami bo‘yicha tezkor qidiruv (`15`, `22`, `7`, `33`).

### Stage 2 — Route alternatives UI [✓ BAJARILDI]
- `frontend/src/pages/Search.tsx` va `frontend/src/services/routing/routingService.ts`:
  - Ko‘p mezonli turlar: *Tezkor*, *Hamyonbop*, *Kam piyoda*, *Kam o‘tish* hamda *Faqat piyoda*.
  - `RouteFilterTabs.tsx` yordamida tezkor filtratsiya.
  - `RouteCard.tsx`: Umumiy ETA, yo‘l haqi, piyoda masofa, almashishlar soni va qadamlar zanjiri (Piyoda → 15 → Almashish → 7).
  - Liniyada faol mashina bo‘lmasa, talabga binoan neytral *"Hozir online transport ko‘rinmayapti"* ko‘rsatiladi.
  - Mobil ekranlar uchun segmented view toggle: `[ Ro‘yxat | Xarita ]`.
  - `AbortController` orqali eskirgan qidiruvlar avtomatik bekor qilinadi.

### Stage 3 — Map itinerary [✓ BAJARILDI]
- `frontend/src/services/map/maptiler.ts` va `frontend/src/components/map/AppMap.tsx`:
  - Piyoda yo‘llar punktir chiziqda, jamoat transporti yo‘llari to‘q ko‘k chiziqda chiziladi.
  - Chiqish bekati (yashil), tushish bekati (qizil), almashish bekatlari (sariq) va foydalanuvchi joylashuvi markeri.
  - MapTiler kaliti bo‘lmaganda chiroyli Andijon vektorli xarita simulyatori avtomatik ishlaydi.
  - `ItineraryLegs.tsx` orqali qadam-baqadam yo‘nalish ko‘rsatiladi.

### Stage 4 — Live vehicle tracking + ETA [✓ BAJARILDI]
- `frontend/src/services/realtime/realtimeService.ts` va `frontend/src/pages/RouteDetails.tsx`:
  - Tanlangan marshrut uchun WebSocket jonli translyatsiyasi (eksponensial backoff bilan).
  - 30 soniyadan oshgan yangilanmagan transportlar uchun eskirganlik holati (*stale status*).
  - Bekatda kutayotgan mashinalar soni (*parking count*).
  - Yo‘nalishni almashtirish: To‘g‘ri yo‘nalish (A → B) va Qaytish yo‘nalishi (B → A) o‘rtasida almashtirish.

### Stage 5 — “Kutayapman” / Client watch [✓ BAJARILDI]
- `frontend/src/services/watch/watchStateService.ts` va `frontend/src/components/client/WatchActionBar.tsx`:
  - **"Kutayapman / Yo‘nalishni kuzatish"**: Foydalanuvchining aniq GPS koordinatalari liniyadagi haydovchilarga uzatiladi.
  - **"Mashinadaman"**: GPS translyatsiyasi darhol to‘xtatiladi va "Safardasiz" holatiga o‘tiladi.
  - **"Tushdim"**: Safar yakunlanadi.
  - Sahifa yangilanganda holat `localStorage` orqali to‘liq tiklanadi.

### Stage 6 — Auth + Wallet [✓ BAJARILDI]
- `frontend/src/components/auth/AuthModal.tsx`: Telefon raqam + 4 xonali SMS kod / parol orqali kirish.
- `frontend/src/pages/WalletPage.tsx`:
  - Hamyon balansi (`24 000 so‘m`).
  - Click orqali hisob to‘ldirish (5 000, 10 000, 20 000, 50 000 so‘m yoki ixtiyoriy summa).
  - Tranzaksiyalar daftari (tarix, pending, success, failed holatlari).

### Stage 7 — Transport payment [✓ BAJARILDI]
- `frontend/src/components/client/PaymentModal.tsx` va `frontend/src/pages/PaymentPage.tsx`:
  - 3 xil to‘lov usuli: QR-kod skaneri, NFC terminalga tekkizish (`NDEFReader` progressiv tekshiruvi bilan) hamda raqamni qo‘lda kiritish.
  - To‘lovdan oldin transport ma’lumotlari, tashuvchi korxona va yo‘l haqi tarifi tasdiqlanadi.
  - Takroriy to‘lovdan himoya (idempotency key).
  - Muvaffaqiyatli to‘lovdan so‘ng elektron yo‘l chiptasi taqdim etiladi.

### Stage 8 — PWA/offline [✓ BAJARILDI]
- `frontend/public/manifest.json` va SVG piktogrammalar (`192px`, `512px`).
- `frontend/public/sw.js`: Statik resurslar uchun Cache-First, API so‘rovlari uchun Network-First kesh bilan.
- Oflayn paytda moliyaviy amallar va yangi kutish rejimini yoqish xavfsiz bloklanadi va tushunarli xabar beriladi.

### Stage 9 — Quality & Tests [✓ BAJARILDI]
- **Dev 1 Shartnoma hujjati**: `docs/contracts/DEV1_SCHEMA_REQUEST.md` da barcha REST va WebSocket talablari belgilandi.
- **Avtomatlashtirilgan testlar**: Vitest orqali barcha **16 ta test to‘plami va 39 ta test (100% muvaffaqiyatli)** o‘tdi.
- **Production Build**: `npm run build` muvaffaqiyatli yakunlandi.
- **Jonli preview server**: `http://127.0.0.1:5173` da faol ishlab turibdi.

---

## Deliverables Checklist
- [x] Client PWA fully navigable from starter kit
- [x] destination → alternatives → selected itinerary → live tracking flow
- [x] route-number browse/search
- [x] watch/on-car/exited states
- [x] auth/wallet/payment UI
- [x] PWA install/offline handling
- [x] client tests (16 test suites, 39 tests passing) and README notes
