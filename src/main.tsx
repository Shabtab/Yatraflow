import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { isNative } from './lib/native'
import { haptic } from './lib/haptics'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
