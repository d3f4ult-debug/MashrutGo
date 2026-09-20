/** Default wait for a fix: long enough for a cold GPS start, short enough not to hang the UI. */
const DEFAULT_TIMEOUT_MS = 15_000

/**
 * One position fix.
 *
 * `timeout` is passed explicitly because the browser default is "no timeout": indoors, or with the
 * location service switched off at OS level, neither the success nor the error callback ever fires
 * and the caller's loading state stays on screen forever.
 */
export async function getCurrentPosition(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      return reject(new Error('Geolocation not available'))
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 30_000,
    })
  })
}
