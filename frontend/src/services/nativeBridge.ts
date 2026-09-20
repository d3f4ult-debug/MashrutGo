/**
 * MashrutGo Native Bridge Client (Stage 9)
 * Connects the Driver/Operations Web PWA with the Flutter native container.
 *
 * Core rule: Business logic resides in Web; native container provides
 * hardware GPS, FCM tokens, NFC card scans, and system deep linking.
 */

export interface NativeLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
}

export interface NativeNfcResult {
  success: boolean;
  card_id?: string;
  card_type?: string;
  read_at?: string;
  error?: string;
}

declare global {
  interface Window {
    isNativeWrapper?: boolean;
    nativePlatform?: 'android' | 'ios' | string;
    nativeFcmToken?: string;
    MashrutGoNativeBridge?: {
      postMessage: (message: string) => void;
    };
    onNativeLocation?: (loc: NativeLocation | null) => void;
    onNativeFcmToken?: (token: string | null) => void;
    onNativeNfcResult?: (result: NativeNfcResult) => void;
  }
}

/**
 * A native call that never gets an answer (host busy, older wrapper without the action) must not
 * hang the caller forever: every request below resolves with a fallback when the timeout expires.
 */
function awaitNative<T>(
  install: (resolve: (value: T) => void) => void,
  cleanup: () => void,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };
    const timer = setTimeout(() => finish(onTimeout()), timeoutMs);
    install(finish);
  });
}

const NATIVE_TIMEOUT_MS = 12_000;
const NFC_TIMEOUT_MS = 60_000;

export const nativeBridge = {
  /**
   * Check if the PWA is currently running inside the Flutter native WebView wrapper
   */
  isNative(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window.isNativeWrapper || window.MashrutGoNativeBridge);
  },

  /**
   * Native platform reported by the wrapper: "android" | "ios" (or "web" in a browser)
   */
  getPlatform(): string {
    return (window.nativePlatform || 'web').toLowerCase();
  },

  /**
   * Send a JSON action request to the Flutter native host
   */
  postAction(action: string, payload: Record<string, unknown> = {}): boolean {
    if (!this.isNative() || !window.MashrutGoNativeBridge) {
      return false;
    }

    try {
      window.MashrutGoNativeBridge.postMessage(
        JSON.stringify({ action, ...payload })
      );
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Request high-accuracy native GPS location from Flutter
   */
  requestLocation(): Promise<NativeLocation | null> {
    if (!this.isNative()) {
      // Fallback to browser Geolocation API
      return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              heading: pos.coords.heading || 0,
              speed: pos.coords.speed || 0,
              timestamp: pos.timestamp,
            });
          },
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      });
    }

    return awaitNative<NativeLocation | null>(
      (resolve) => {
        window.onNativeLocation = (loc) => resolve(loc);
        if (!this.postAction('requestLocation')) resolve(null);
      },
      () => {
        window.onNativeLocation = undefined;
      },
      NATIVE_TIMEOUT_MS,
      () => null,
    );
  },

  /**
   * Retrieve the native FCM Push Notification token
   */
  getFcmToken(): Promise<string | null> {
    if (window.nativeFcmToken) {
      return Promise.resolve(window.nativeFcmToken);
    }

    if (!this.isNative()) {
      return Promise.resolve(null);
    }

    return awaitNative<string | null>(
      (resolve) => {
        window.onNativeFcmToken = (token) => resolve(token);
        if (!this.postAction('getFcmToken')) resolve(null);
      },
      () => {
        window.onNativeFcmToken = undefined;
      },
      NATIVE_TIMEOUT_MS,
      () => null,
    );
  },

  /**
   * Trigger native NFC transport card scan
   */
  scanNfc(): Promise<NativeNfcResult> {
    if (!this.isNative()) {
      return Promise.resolve({
        success: false,
        error: "NFC faqat mobil ilova orqali ishlaydi",
      });
    }

    return awaitNative<NativeNfcResult>(
      (resolve) => {
        window.onNativeNfcResult = (result) => resolve(result);
        if (!this.postAction('scanNfc')) {
          resolve({ success: false, error: 'NFC o‘qishni boshlab bo‘lmadi' });
        }
      },
      () => {
        window.onNativeNfcResult = undefined;
      },
      NFC_TIMEOUT_MS,
      () => ({ success: false, error: 'NFC kartani o‘qish vaqti tugadi. Qayta urinib ko‘ring.' }),
    );
  },

  /**
   * Keep the screen on while a driver shift transmits GPS (the WebView pauses timers when the
   * screen sleeps). No-op in a normal browser, where the Screen Wake Lock API is used instead.
   */
  setKeepScreenOn(enabled: boolean): boolean {
    return this.postAction('setKeepScreenOn', { enabled });
  },

  /**
   * Request native container to open an external URL (e.g. phone call, payment app)
   */
  openExternal(url: string): void {
    if (this.isNative()) {
      this.postAction('openExternal', { url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  },
};
