export async function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('Geolocation not available'))
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true })
  })
}
