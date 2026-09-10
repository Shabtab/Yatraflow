// ============ Native app-shell wiring (Capacitor) ============
// Everything the app needs only when it runs inside the Android shell:
// system-bar theming, splash dismissal and the Android back button.
// Off-device every function is a no-op, so the web app ships exactly the
// same code and never touches a plugin.

import { App } from '@capacitor/app'
import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'
import { isAndroid, isNative } from './native'

/**
 * Match the system bars to the app theme (same colors as the theme-color
 * metas). SystemBars styles BOTH bars at once and, unlike the StatusBar
 * plugin, doesn't fight Android 15's edge-to-edge: the WebView stays
 * full-bleed behind translucent bars and the core runtime injects correct
 * `--safe-area-inset-*` values (env() alone reads as 0 on Android WebView),
 * which the CSS consumes as a fallback chain.
 */
export async function setNativeTheme(dark: boolean): Promise<void> {
  if (!isNative) return
  try {
    // SystemBarsStyle.Dark = light bar content for a dark background — the
    // right choice for the dark navy app theme; Light = dark content for
    // the cream theme. One call styles status + navigation bars together.
    await SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light })
  } catch { /* not in the shell / plugin unavailable — nothing to do */ }
}

/** Hide the launch splash once the web view has painted. Safe to call anywhere. */
export async function hideSplash(): Promise<void> {
  if (!isNative) return
  try { await SplashScreen.hide({ fadeOutDuration: 250 }) } catch { /* already hidden */ }
}

// ---------- Android back button ----------
//
// The WebView has no history beyond what the app itself pushed, so without
// this handler the back button would kill the activity. We map it onto the
// app's own UX:
//   1. an open drawer/popover closes first (one entry per layer),
//   2. else the hash router walks the WebView history back,
//   3. at the first entry a second press exits (the classic confirm pattern).
//
// `registerAndroidBack` is idempotent — call it once from the shell; it
// routes each press through the callbacks the shell keeps current.

type BackHandlerContext = {
  /** Close any open overlay (drawer, popover, sheet); true if one was open. */
  closeOverlay: () => boolean
}

export function registerAndroidBack(ctx: BackHandlerContext): () => void {
  if (!isAndroid) return () => {}
  let armed = false // first press at the entry page arms, second exits

  const handle = App.addListener('backButton', ({ canGoBack }) => {
    // 1) overlays first — a sheet closing should never navigate
    if (ctx.closeOverlay()) { armed = false; return }

    // 2) the plugin tells us whether the WebView has history to walk back
    //    through; the app pushes a history entry per hash navigation
    if (canGoBack) {
      history.back()
      return
    }

    // 3) at the entry page: arm-then-exit (second press within 2s exits)
    armed = !armed
    if (!armed) App.exitApp()
    else setTimeout(() => { armed = false }, 2000)
  })

  return () => { handle.then(h => h.remove()).catch(() => {}) }
}
