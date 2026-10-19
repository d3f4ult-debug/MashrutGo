export type GeocodeCategory =
  | 'market'
  | 'station'
  | 'hospital'
  | 'education'
  | 'neighborhood'
  | 'street'
  | 'other';

export type GeocodeResult = {
  id: string;
  name: string;
  center: [number, number]; // [lng, lat]
  address?: string;
  category?: GeocodeCategory;
};

export const ANDIJON_LANDMARKS: GeocodeResult[] = [
  // Bozorlar
  { id: 'lm-1', name: 'Yangi Bozor (Markaziy Dehqon bozori)', center: [72.3551, 40.7812], address: "Andijon sh., Amir Temur ko'chasi", category: 'market' },
  { id: 'lm-2', name: 'Eski Shahar (Chorsu / Registon) bozori', center: [72.3385, 40.7854], address: "Andijon sh., Fitrat ko'chasi", category: 'market' },
  { id: 'lm-3', name: 'Jahon Bozori (Katta kiyim bozori)', center: [72.3882, 40.7516], address: "Andijon sh., Bog'ishamol yo'li", category: 'market' },
  { id: 'lm-4', name: 'Ulgurji Bozor (Optom bozor)', center: [72.3154, 40.7925], address: "Oltinko'l yo'nalishi", category: 'market' },
  { id: 'lm-5', name: 'Tepa Bozor (Asaka)', center: [72.2465, 40.6366], address: "Asaka shahar markazi", category: 'market' },
  { id: 'lm-6', name: 'Eski Bozor (Shahrixon)', center: [72.0556, 40.7097], address: "Shahrixon markazi", category: 'market' },

  // Vokzallar va Bekatlar
  { id: 'lm-10', name: 'Andijon-1 Temir yoʻl vokzali (Markaziy)', center: [72.3482, 40.7821], address: "Vokzal maydoni, Andijon sh.", category: 'station' },
  { id: 'lm-11', name: 'Andijon-2 Vokzali', center: [72.3685, 40.7423], address: "Janubiy sanoat zonasi", category: 'station' },
  { id: 'lm-12', name: 'Markaziy Shahar Avtovokzali', center: [72.3785, 40.7582], address: "Andijon sh., O'sh ko'chasi", category: 'station' },
  { id: 'lm-13', name: 'Qoʻshariq avtostansiyasi', center: [72.3721, 40.7894], address: "Qo'shariq dahasi", category: 'station' },
  { id: 'lm-14', name: 'Andijon Xalqaro Aeroporti', center: [72.2981, 40.7285], address: "Aeroport hududi", category: 'station' },
  { id: 'lm-15', name: 'Asaka Avtovokzali', center: [72.2412, 40.6384], address: "Asaka shahar markazi", category: 'station' },
  { id: 'lm-16', name: 'Shahrixon Avtovokzali', center: [72.0581, 40.7123], address: "Shahrixon sh.", category: 'station' },

  // Tibbiyot muassasalari
  { id: 'lm-20', name: 'Markaziy shahar shifoxonasi (Gorkom)', center: [72.3548, 40.7718], address: "Andijon sh., Shifokorlar ko'chasi", category: 'hospital' },
  { id: 'lm-21', name: 'Viloyat koʻp tarmoqli tibbiyot markazi (Klinika)', center: [72.3621, 40.7654], address: "3-kichik daha yonida", category: 'hospital' },
  { id: 'lm-22', name: 'Viloyat Bolalar shifoxonasi', center: [72.3485, 40.7782], address: "Andijon sh., Markaz", category: 'hospital' },
  { id: 'lm-23', name: 'Viloyat Onkologiya dispanseri', center: [72.3712, 40.7691], address: "O'sh ko'chasi", category: 'hospital' },
  { id: 'lm-24', name: 'Viloyat Kardiologiya markazi', center: [72.3562, 40.7684], address: "Andijon sh.", category: 'hospital' },
  { id: 'lm-25', name: '1-shahar poliklinikasi', center: [72.3421, 40.7834], address: "Eski shahar hududi", category: 'hospital' },

  // Ta'lim & Davlat idoralari
  { id: 'lm-30', name: 'Andijon Davlat Universiteti (ADU)', center: [72.3491, 40.7824], address: "Universitet ko'chasi 129", category: 'education' },
  { id: 'lm-31', name: 'Andijon Davlat Tibbiyot Instituti (ADTI)', center: [72.3452, 40.7871], address: "Navoiy shox ko'chasi", category: 'education' },
  { id: 'lm-32', name: 'Andijon Mashinasozlik Instituti (AndMI)', center: [72.3624, 40.7602], address: "Bobur shox ko'chasi", category: 'education' },
  { id: 'lm-33', name: 'Viloyat Hokimligi', center: [72.3524, 40.7791], address: "Amir Temur maydoni", category: 'education' },
  { id: 'lm-34', name: 'Shahar Hokimligi', center: [72.3458, 40.7823], address: "Eski shahar", category: 'education' },
  { id: 'lm-35', name: 'Viloyat YHXB (GAYI / Yoʻl harakati)', center: [72.3725, 40.7621], address: "O'sh ko'chasi bo'ylab", category: 'education' },
  { id: 'lm-36', name: 'Viloyat Gaz (AndijonshaharGaz)', center: [72.3512, 40.7804], address: "Markaz", category: 'education' },
  { id: 'lm-37', name: 'Charm-poyabzal kasb markazi', center: [72.3364, 40.7882], address: "Gulshan yo'li", category: 'education' },
  { id: 'lm-38', name: '36-post (YHXB posti)', center: [72.3852, 40.7651], address: "Shahar chiqish yo'li", category: 'education' },

  // Mahallalar va Aholi maskanlari
  { id: 'lm-40', name: 'Gulshan MFY', center: [72.3322, 40.7979], address: "Shimoliy Andijon", category: 'neighborhood' },
  { id: 'lm-41', name: 'Pistamozor MFY', center: [72.3251, 40.7912], address: "G'arbiy Andijon", category: 'neighborhood' },
  { id: 'lm-42', name: 'Boʻriboy MFY', center: [72.3921, 40.7754], address: "Sharqiy Andijon", category: 'neighborhood' },
  { id: 'lm-43', name: '1-kichik daha (1-mikrorayon)', center: [72.3582, 40.7721], address: "Andijon sh.", category: 'neighborhood' },
  { id: 'lm-44', name: '2-kichik daha (2-mikrorayon)', center: [72.3614, 40.7705], address: "Andijon sh.", category: 'neighborhood' },
  { id: 'lm-45', name: '3-kichik daha (3-mikrorayon)', center: [72.3652, 40.7681], address: "Andijon sh.", category: 'neighborhood' },
  { id: 'lm-46', name: '4-kichik daha (4-mikrorayon)', center: [72.3691, 40.7654], address: "Andijon sh.", category: 'neighborhood' },
  { id: 'lm-47', name: '5-kichik daha (5-mikrorayon)', center: [72.3724, 40.7632], address: "Andijon sh.", category: 'neighborhood' },
  { id: 'lm-48', name: 'Bogʻishamol dahasi', center: [72.3812, 40.7321], address: "Janubiy-sharqiy Andijon", category: 'neighborhood' },
  { id: 'lm-49', name: 'Qozoq kottej', center: [72.3962, 40.7206], address: "Bobur bog'i yo'li", category: 'neighborhood' },
  { id: 'lm-50', name: 'Bogʻi Bobur (Bobur Milliy bogʻi)', center: [72.4102, 40.7104], address: "Bobur memorial majmuasi", category: 'neighborhood' },
  { id: 'lm-51', name: 'Diromm (Dam olish maskani)', center: [72.4182, 40.7051], address: "Bog'i Bobur orqasi", category: 'neighborhood' },
  { id: 'lm-52', name: 'Doʻstlik chegara bojxona posti', center: [72.5854, 40.5401], address: "Qirg'iziston chegarasi", category: 'neighborhood' },

  // Asosiy ko'chalar
  { id: 'lm-60', name: 'Amir Temur shoh koʻchasi', center: [72.3501, 40.7805], address: "Markaziy magistral ko'cha", category: 'street' },
  { id: 'lm-61', name: 'Bobur shoh koʻchasi', center: [72.3534, 40.7752], address: "Janubiy magistral", category: 'street' },
  { id: 'lm-62', name: 'Oʻsh koʻchasi', center: [72.3621, 40.7624], address: "Sharqiy chiqish trassasi", category: 'street' },
  { id: 'lm-63', name: 'Fitrat koʻchasi', center: [72.3445, 40.7851], address: "Eski shahar ko'chasi", category: 'street' },
  { id: 'lm-64', name: 'Nayman koʻchasi', center: [72.3402, 40.7784], address: "Markaziy dahalar", category: 'street' },
  { id: 'lm-65', name: 'Mashrab koʻchasi', center: [72.3541, 40.7772], address: "Andijon sh.", category: 'street' },
  { id: 'lm-66', name: 'Choʻlpon shoh koʻchasi', center: [72.3481, 40.7842], address: "Andijon sh.", category: 'street' },
  { id: 'lm-67', name: 'Alisher Navoiy xiyoboni', center: [72.3465, 40.7818], address: "Markaziy xiyobon", category: 'street' },
];

function normalizeText(str: string): string {
  return str
    .toLowerCase()
    .replace(/[ʻʼ'`]/g, "'")
    .replace(/o['‘]/g, 'o')
    .replace(/g['‘]/g, 'g')
    .replace(/sh/g, 'sh')
    .replace(/ch/g, 'ch')
    .trim();
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const qClean = query.trim();
  if (!qClean) return [];

  const normQ = normalizeText(qClean);
  const qTokens = normQ.split(/\s+/).filter(Boolean);

  // 1. Instant local search in curated Andijon landmarks database
  const localMatches = ANDIJON_LANDMARKS.filter(item => {
    const normName = normalizeText(item.name);
    const normAddr = normalizeText(item.address || '');
    return qTokens.every(token => normName.includes(token) || normAddr.includes(token));
  });

  // If we found good local matches or query is short, return local immediately
  if (localMatches.length >= 3 || qClean.length < 3) {
    return localMatches.slice(0, 8);
  }

  // 2. Online search fallback via OpenStreetMap Nominatim with Andijon context
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);

    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      `Andijon ${qClean}`
    )}&limit=5`;

    const res = await fetch(nominatimUrl, {
      signal: controller.signal,
      headers: {
        'Accept-Language': 'uz,ru;q=0.9,en;q=0.8',
      },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      const onlineResults: GeocodeResult[] = (data || []).map((item: any) => ({
        id: `osm-${item.place_id}`,
        name: item.name || item.display_name.split(',')[0],
        center: [parseFloat(item.lon), parseFloat(item.lat)],
        address: item.display_name,
        category: 'other' as GeocodeCategory,
      }));

      // Combine local + online avoiding duplicate names
      const seenNames = new Set(localMatches.map(m => m.name.toLowerCase()));
      const filteredOnline = onlineResults.filter(
        o => !seenNames.has(o.name.toLowerCase())
      );

      return [...localMatches, ...filteredOnline].slice(0, 10);
    }
  } catch {
    // If online search times out or is offline, return local matches
  }

  return localMatches.slice(0, 8);
}
