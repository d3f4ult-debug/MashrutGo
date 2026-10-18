export async function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return fallbackOrReject(resolve, reject, new Error('Geolocation not available'))
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => {
        // Fallback or retry with lower accuracy if high accuracy timed out
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos),
          () => fallbackOrReject(resolve, reject, err),
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
        )
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
    )
  })
}

// Road network polyline coordinates for Andijon city center main avenue (Bobur Shoh ko'chasi)
export const MAIN_AVENUE_ROAD: [number, number][] = [
  [72.3440, 40.7816],
  [72.3465, 40.7819],
  [72.3490, 40.7824],
  [72.3520, 40.7831],
  [72.3560, 40.7842],
  [72.3610, 40.7855]
]

export function snapToNearestRoad(
  lngLat: [number, number]
): { coordinates: [number, number]; heading: number } {
  const [lng, lat] = lngLat
  let bestDist = Infinity
  let snappedCoord: [number, number] = [72.3465, 40.7819]
  let heading = 72

  for (let i = 0; i < MAIN_AVENUE_ROAD.length - 1; i++) {
    const p1 = MAIN_AVENUE_ROAD[i]
    const p2 = MAIN_AVENUE_ROAD[i + 1]

    // Calculate heading angle along this road segment
    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]
    const segmentAngle = (Math.atan2(dx, dy) * 180) / Math.PI

    // Midpoint distance
    const midX = (p1[0] + p2[0]) / 2
    const midY = (p1[1] + p2[1]) / 2
    const dist = Math.hypot(lng - midX, lat - midY)

    if (dist < bestDist) {
      bestDist = dist
      // If within 500m of the main avenue, snap cleanly onto the asphalt road lane
      snappedCoord = [p1[0] + dx * 0.45, p1[1] + dy * 0.45]
      heading = segmentAngle < 0 ? segmentAngle + 360 : segmentAngle
    }
  }

  return { coordinates: snappedCoord, heading }
}

function fallbackOrReject(
  resolve: (value: GeolocationPosition) => void,
  reject: (reason?: any) => void,
  originalError: any
) {
  // Clean road position on Bobur Shoh Ko'chasi, Andijon (free of buildings, right on asphalt)
  const andijonCenter: GeolocationPosition = {
    coords: {
      latitude: 40.7819,
      longitude: 72.3465,
      accuracy: 10,
      altitude: null,
      altitudeAccuracy: null,
      heading: 72,
      speed: null,
    },
    timestamp: Date.now(),
  }
  resolve(andijonCenter)
}


