// Centralized Uzbek localization strings for MashrutGo Client PWA

export const uz = {
  app: {
    name: 'MashrutGo',
    city: 'Andijon',
    tagline: 'Andijon shahar jamoat transporti',
    offlineBadge: 'Oflayn rejim',
    offlineNotice: 'Internet aloqasi yo‘q. Keshlangan ma’lumotlar ko‘rsatilmoqda.',
    retry: 'Qayta urinish'
  },
  nav: {
    home: 'Asosiy',
    search: 'Yo‘nalishlar',
    wallet: 'Hamyon',
    pay: 'To‘lash',
    profile: 'Profil'
  },
  search: {
    heading: 'Qayerga bormoqchisiz?',
    originPlaceholder: 'Qayerdan? (Joriy joylashuv)',
    destPlaceholder: 'Qayerga? (Manzil yoki bekat)',
    routeNumberPlaceholder: 'Marshrut raqami (masalan: 15, 22, 7)',
    useCurrentLocation: 'Joriy joylashuvim',
    locationDenied: 'GPS ruxsat berilmadi. Manzilni qo‘lda kiriting.',
    locationError: 'Joylashuvni aniqlab bo‘lmadi',
    popularDestinations: 'Ommabop manzillar',
    recentSearches: 'So‘nggi qidiruvlar',
    findRoute: 'Yo‘nalishni topish',
    searching: 'Qidirilmoqda...',
    noResults: 'Hech qanday marshrut topilmadi',
    enterDestination: 'Iltimos, boradigan manzilingizni kiriting',
    clear: 'Tozalash'
  },
  alternatives: {
    title: 'Mavjud variantlar',
    modes: {
      fastest: 'Tezkor',
      cheapest: 'Hamyonbop',
      least_walking: 'Kam piyoda',
      least_transfers: 'Kam o‘tish'
    },
    transfersCount: (count: number) =>
      count === 0 ? 'To‘g‘ridan-to‘g‘ri' : `${count} ta almashish`,
    walkingSummary: (dist: string, time: string) => `${dist} (${time})`,
    liveVehiclesOnline: (count: number) => `${count} ta mashina liniyada`,
    noLiveVehicles: 'Hozir online transport ko‘rinmayapti',
    walkingOnly: 'Faqat piyoda yurish'
  },
  routeDetails: {
    title: 'Yo‘nalish tafsilotlari',
    stopsCount: (count: number) => `${count} ta bekat`,
    boarding: 'Chiqish bekati',
    alighting: 'Tushish bekati',
    transferAt: 'Almashish bekati',
    liveTracking: 'Jonli kuzatuv',
    activeVehicles: 'Harakatdagi mashinalar',
    parkedVehicles: 'Bekatda kutayotgan mashinalar',
    staleVehicle: 'Ma’lumot yangilanmagan (>30s)',
    etaCalculating: 'Taxminiy vaqt hisoblanmoqda...',
    approxEta: (min: number) => `Yetib kelish: ~${min} daqiqa`
  },
  watch: {
    actionWatch: 'Kutayapman / Kuzatish',
    actionWatchingActive: 'Haydovchilarga bildirilmoqda...',
    actionOnBoard: 'Mashinadaman',
    actionAlighted: 'Tushdim',
    stopWatching: 'Kutishni to‘xtatish',
    watchingNotice: 'Sizning joylashuvingiz liniyadagi haydovchilarga ko‘rinmoqda',
    onBoardNotice: 'Siz safardasiz. GPS ulashish to‘xtatildi.',
    offlineBlock: 'Kutish rejimini faollashtirish uchun internet aloqasi zarur'
  },
  wallet: {
    title: 'Mening hamyonim',
    balance: 'Mavjud balans',
    currency: 'so‘m',
    topUp: 'Balansni to‘ldirish',
    topUpWithClick: 'Click orqali to‘ldirish',
    selectAmount: 'Summani tanlang yoki kiriting',
    customAmount: 'Boshqa summa',
    transactionHistory: 'Tranzaksiyalar tarixi',
    noTransactions: 'Tranzaksiyalar mavjud emas',
    topUpSuccess: 'Hamyon muvaffaqiyatli to‘ldirildi!',
    topUpFailed: 'To‘lov amalga oshmadi. Qayta urinib ko‘ring.',
    statusPending: 'Kutilmoqda',
    statusSuccess: 'Muvaffaqiyatli',
    statusFailed: 'Bekor qilindi',
    offlineBlock: 'Moliyaviy amallarni bajarish uchun internet zarur'
  },
  payment: {
    title: 'Yo‘l haqini to‘lash',
    scanQr: 'QR kodni skanerlash',
    nfcTap: 'NFC orqali to‘lash',
    nfcSearching: 'Telefonni terminalga tekkizing...',
    nfcNotSupported: 'Qurilmangizda NFC qo‘llab-quvvatlanmaydi',
    manualInput: 'Transport raqami orqali',
    vehiclePlaceholder: 'Masalan: 60 A 123 AA yoki 15-mashina',
    resolveVehicle: 'Transportni aniqlash',
    confirmPayment: 'To‘lovni tasdiqlash',
    vehicleDetails: 'Transport ma’lumotlari',
    routeNumber: 'Marshrut',
    uyushma: 'Tashuvchi uyushma',
    plateNumber: 'Davlat raqami',
    fareAmount: 'Yo‘l haqi',
    payFromWallet: 'Hamyondan to‘lash',
    payWithClick: 'Click orqali to‘lash',
    paymentSuccess: 'Yo‘l haqi to‘landi! Oq yo‘l!',
    paymentFailed: 'To‘lovda xatolik yuz berdi',
    insufficientBalance: 'Hamyonda mablag‘ yetarli emas',
    doubleSubmitWarning: 'To‘lov qayta ishlanmoqda, kuting...',
    electronicTicket: 'Elektron yo‘l chiptasi'
  },
  auth: {
    title: 'Tizimga kirish',
    subtitle: 'Hamyon va to‘lovlardan foydalanish uchun kiring',
    phoneLabel: 'Telefon raqam',
    phonePlaceholder: '+998 90 123 45 67',
    smsCodeLabel: 'SMS tasdiqlash kodi',
    smsCodePlaceholder: '1234',
    sendCode: 'Kodni yuborish',
    verifyAndLogin: 'Kirish',
    demoLogin: 'Tezkor test kirish (Mijoz)',
    logout: 'Chiqish'
  }
}
