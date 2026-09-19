// Lightweight service worker registration scaffold
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // registration successful
          console.log('ServiceWorker registration successful with scope: ', reg.scope)
        })
        .catch((err) => {
          console.warn('ServiceWorker registration failed: ', err)
        })
    })
  }
}
