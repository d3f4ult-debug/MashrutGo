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
    nativePlatform?: 'android' | 'iOS' | string;
    nativeFcmToken?: string;
    MashrutGoNativeBridge?: {
      postMessage: (message: string) => void;
    };
    onNativeLocation?: (loc: NativeLocation | null) => void;
    onNativeFcmToken?: (token: string | null) => void;
    onNativeNfcResult?: (result: NativeNfcResult) => void;
  }
}

export const nativeBridge = {
  /**
   * Check if the PWA is currently running inside the Flutter native WebView wrapper
   */
  isNative(): boolean {
    if (typeof window === 'undefined') return false;
    return !!(window.isNativeWrapper || window.MashrutGoNativeBridge);
  },

  /**
   * Get the native platform (e.g. "android" or "iOS")
   */
  getPlatform(): string {
    return window.nativePlatform || 'web';
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

    return new Promise((resolve) => {
      window.onNativeLocation = (loc) => {
        resolve(loc);
      };
      this.postAction('requestLocation');
    });
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

    return new Promise((resolve) => {
      window.onNativeFcmToken = (token) => {
        resolve(token);
      };
      this.postAction('getFcmToken');
    });
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

    return new Promise((resolve) => {
      window.onNativeNfcResult = (result) => {
        resolve(result);
      };
      this.postAction('scanNfc');
    });
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
