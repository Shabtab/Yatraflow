import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { isNative } from './lib/native'
import { haptic } from './lib/haptics'
// Brand fonts are self-hosted through @fontsource, so first paint never waits
// on a font CDN. Sora 600-800 covers display; Plus Jakarta Sans 400-800 covers
// body text. The family names match --font-display/--font-body in styles.css.
import '@fontsource/sora/600.css'
import '@fontsource/sora/700.css'
import '@fontsource/sora/800.css'
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/500.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
import './styles.css'

// Native-shell class, set before the first React paint: switches CSS onto
// the mobile performance budget (capped glass blur, frozen atmosphere and
// ticker — phone WebViews can't afford the desktop choreography) and any
// other shell-only styling. The Capacitor runtime injects correct
// --safe-area-inset-* values (env() reads 0 on Android WebViews), which the
// CSS consumes via a var() fallback chain — no JS needed for that part.
if (isNative) {
  document.documentElement.classList.add('native-shell')

  // Global tactile feedback: Android apps buzz on every tappable touch, not
  // just hero actions. One delegated listener covers every button, chip and
  // tab rendered anywhere in the tree (including lazy pages) — key actions
  // layer their stronger intents on top, and a tap landing on nothing does
  // nothing. Press-and-drag (slider/scroll) never lands here: the pointer
  // moves before pointerup.
  document.addEventListener('pointerup', e => {
    const el = e.target as HTMLElement | null
    if (el?.closest('button, [role="button"], .clickable-chip, a.btn, .tab-btn, .maplibregl-ctrl button')) {
      haptic('tick')
    }
  }, { passive: true })
}

// The service worker is a WEB concern: inside the Capacitor shell the app is
// already installed and every asset ships in the APK, so a worker would only
// fight the WebView's own cache. Dev is excluded too — HMR rewrites modules
// and a cache-first worker would serve stale ones. Registration failures must
// never surface: offline support is a bonus, not a boot dependency.
if (!isNative && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
