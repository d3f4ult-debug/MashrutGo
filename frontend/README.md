# Frontend — MashrutGo (Client PWA)

Bu jild **MashrutGo** loyihasining mijozlar uchun mo‘ljallangan Mobile-First, Desktop Responsive va Oflayn ishlay oladigan Progressive Web App (PWA) qismini o‘z ichiga oladi.

## Quick Start

```bash
cd frontend
npm install
npm run dev
```

Brauzerda: `http://localhost:5173`

## Muhit o‘zgaruvchilari (.env)

Interaktiv xarita va real vaqtdagi WebSocket aloqasi uchun quyidagi o‘zgaruvchilarni frontend ildizidagi `.env` fayliga qo‘shing:

```env
VITE_MAPTILER_API_KEY=your_maptiler_api_key_here
VITE_WS_URL=ws://localhost:8000/api/v1/ws/live-vehicles
```

> **Eslatma:** Agar `VITE_MAPTILER_API_KEY` o‘rnatilmagan bo‘lsa, ilova xato bilan to‘xtab qolmaydi, balki graceful placeholder rejimida ishlaydi.

## Imkoniyatlar (Features)

1. **Bosh sahifa va Qidiruv (Stage 1 & 2)**:
   - "Qayerga bormoqchisiz?" qidiruv interfeysi.
   - A nuqtasi: Joriy GPS koordinatalari (ruxsat berilganda) yoki qo‘lda tahrirlanadigan manzil. GPS rad etilsa app barqaror ishlaydi.
   - B nuqtasi: Andijon shahar diqqatga sazovor joylari bo‘yicha tezkor tavsiyalar (Eski Shahar, Yangi Bozor, Vokzal, Bobur bog‘i va boshqalar).
   - Marshrut raqami bo‘yicha tezkor qidiruv (masalan: `15`, `22`, `7`, `33`).
   - Ko‘p mezonli yo‘nalish variantlari: *Tezkor*, *Hamyonbop*, *Kam piyoda*, *Kam o‘tish*, hamda *Faqat piyoda*.
   - Har bir kartada: umumiy vaqt (ETA), yo‘l haqi, piyoda masofa, almashish soni va liniyadagi faol mashinalar holati (onlayn mashina yo‘q bo‘lsa neytral *"Hozir online transport ko‘rinmayapti"* xabari).

2. **Xarita va Bosqichma-bosqich yo‘nalish (Stage 3 & 4)**:
   - MapTiler va MapLibre GL asosidagi chizmalar: piyoda yo‘llar (punktir chiziq), jamoat transporti yo‘li (to‘q ko‘k chiziq), chiqish/tushish/almashish bekatlari va foydalanuvchi joylashuvi.
   - WebSocket orqali mashinalarning real vaqtdagi harakati va eskirgan ma’lumotlar indikatori (>30s).
   - Bekatda kutayotgan mashinalar soni.

3. **"Kutayapman" / Yo‘nalishni kuzatish (Stage 5)**:
   - Bekatda turgan yo‘lovchi *"Kutayapman / Yo‘nalishni kuzatish"* tugmasini bosganda, aniq GPS koordinatalari liniyadagi haydovchilarga uzatiladi.
   - *"Mashinadaman"* bosilganda GPS translyatsiyasi darhol to‘xtatiladi va safar holatiga o‘tiladi.
   - *"Tushdim"* bosilganda safar yakunlanadi.
   - Sahifa yangilanganda yoki oflayn holatda ham sessiya `localStorage` orqali to‘liq tiklanadi.

4. **Hamyon va Transport to‘lovi (Stage 6 & 7)**:
   - Anonim rejimda navigatsiya va xarita erkin ishlaydi; hamyon va to‘lovlar uchun kirish/ro‘yxatdan o‘tish modali ochiladi.
   - Hamyon balansi va Click orqali hisobni to‘ldirish.
   - Tranzaksiyalar daftari (ledger).
   - Ko‘p rejimli to‘lov (QR-skaner, NFC tekshiruvi, davlat raqami yoki marshrut raqami orqali transportni aniqlash).
   - To‘lovdan oldin transport, yo‘nalish, tashuvchi va yo‘l haqi tasdiqlanadi.
   - Double-submit himoyasi (idempotency key).
   - Muvaffaqiyatli to‘lovdan so‘ng elektron yo‘l chiptasi generatsiya qilinadi.

5. **PWA va Oflayn ishlash (Stage 8)**:
   - Standalone `manifest.json` va SVG/PNG piktogrammalar.
   - Service Worker (`public/sw.js`): statik qobiq uchun Cache-First, API so‘rovlari uchun Network-First kesh bilan.
   - Oflayn holatda moliyaviy amallar va yangi kutish rejimini yoqish avtomatik bloklanadi va foydalanuvchiga tushunarli xabar ko‘rsatiladi.

## Testlarni ishga tushirish

```bash
cd frontend
npm test -- --run
```
