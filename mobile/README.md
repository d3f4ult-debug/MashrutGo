# MashrutGo — Flutter qobiq (WebView + native ko‘prik)

Mahsulotning o‘zi web ilovada (`frontend/`). Bu Flutter loyihasi faqat native imkoniyatlarni beradi:

- WebView (Android/iOS) va oflayn/xato ekrani;
- GPS va kamera ruxsatlarini WebView uchun so‘rash (haydovchi smenasi, QR skaner);
- NFC belgisini o‘qish (`nfc_manager`) va natijani web’ga uzatish;
- FCM push + bildirishnoma bosilganda web sahifaga deep-link;
- tashqi havolalarni (tel:, Telegram, Click/Payme) tizim ilovalarida ochish;
- smena davomida ekranni yoqiq saqlash (WebView taymerlari to‘xtamasligi uchun).

Biznes-mantiq bu yerda takrorlanmaydi.

## Ishga tushirish

```bash
cd mobile
flutter pub get

# Android emulyator (host mashinadagi Vite dev server)
flutter run --dart-define=WEB_URL=http://10.0.2.2:5173

# iOS simulyator
flutter run --dart-define=WEB_URL=http://localhost:5173

# Release
flutter build apk --release --dart-define=WEB_URL=https://app.mashrutgo.uz
flutter build ipa --dart-define=WEB_URL=https://app.mashrutgo.uz
```

Tekshiruv: `flutter analyze` va `flutter test`.

## `--dart-define` orqali sozlash

| Kalit | Ma’nosi |
|---|---|
| `WEB_URL` | WebView ochadigan web ilova manzili (release’da standart `https://app.mashrutgo.uz`) |
| `FCM_API_KEY`, `FCM_APP_ID`, `FCM_SENDER_ID`, `FCM_PROJECT_ID` | Firebase konfiguratsiyasi. To‘rttasi ham bo‘lmasa push o‘chiq (soxta token yaratilmaydi) |
| `FCM_IOS_BUNDLE_ID` | iOS uchun bundle id (ixtiyoriy) |

`google-services.json` / `GoogleService-Info.plist` talab qilinmaydi — Firebase `FirebaseOptions`
bilan ishga tushiriladi, shuning uchun kalitlar repozitoriyga tushmaydi.

## Xavfsizlik va ruxsatlar

- Native ko‘prik (`window.MashrutGoNativeBridge`) faqat `WEB_URL` origin’idagi sahifalar uchun
  ishlaydi; boshqa sayt xabarlari e’tiborsiz qoldiriladi.
- Android’da cleartext HTTP faqat debug build’da ochiq (lokal dev serverlar uchun); release faqat HTTPS.
- FCM token backendga **native tomondan emas**, web ilovadan (JWT bilan)
  `POST /api/v1/notifications/device-token` orqali yuboriladi.
- Release imzolash: `android/key.properties` fayli (`storeFile`, `storePassword`, `keyAlias`,
  `keyPassword`) — commit qilinmaydi. Fayl bo‘lmasa release debug kalit bilan imzolanadi (faqat sinov uchun).

## iOS uchun qo‘shimcha

- Push uchun Xcode’da **Push Notifications** va **Background Modes → Remote notifications**
  capability’larini yoqing hamda APNs kalitini Firebase’ga ulang.
- NFC uchun **Near Field Communication Tag Reading** capability kerak (Info.plist’dagi
  `NFCReaderUsageDescription` allaqachon mavjud).

## Ma’lum cheklov

Ilova fonga o‘tganda WebView’dagi JS taymerlari sekinlashadi, shuning uchun haydovchi smenasi
davomida ekran yoqiq turadi (`wakelock_plus`). Ekran o‘chgan holatda ham uzluksiz GPS kerak bo‘lsa,
Android foreground service’li native tracker qo‘shilishi lozim.
