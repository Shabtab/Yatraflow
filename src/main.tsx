import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { isNative } from './lib/native'
import './styles.css'

// Native-shell class, set before the first React paint: switches CSS onto
// the mobile performance budget (capped glass blur, frozen atmosphere and
// ticker — phone WebViews can't afford the desktop choreography) and any
// other shell-only styling. The Capacitor runtime injects correct
// --safe-area-inset-* values (env() reads 0 on Android WebViews), which the
// CSS consumes via a var() fallback chain — no JS needed for that part.
if (isNative) document.documentElement.classList.add('native-shell')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
