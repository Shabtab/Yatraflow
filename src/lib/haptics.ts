// ============ Haptics — native plugin + navigator.vibrate wrapper ============
// Satisfying physical feedback for mobile users. Silence is the contract:
// no-ops on unsupported browsers (iOS Safari ignores vibrate), reduced-motion
// users, and any failure. Patterns are ms (or [ms, pause, ms] arrays) per the
// Vibration API.
//
// In the packaged app the navigator.vibrate path never fires — Android
// WebViews don't implement the Vibration API — so the same named intents
// route through Capacitor's Haptics plugin, which drives the real
// VibratorManager. Call sites don't care which platform they're on.

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { isNative } from './native'

export type HapticPattern = number | number[]

/** Named interaction intents — call sites read as intent, not numbers. */
export type HapticIntent =
  | 'tick'      // slider step tick
  | 'select'    // chip / pill selection
  | 'toggle'    // segmented toggle / reset
  | 'success'   // copy / saved celebrations
  | 'surprise'  // surprise-me slot machine
  | 'warn'      // destructive confirm, error toasts
  | 'heavy'     // long-press pickup, drag start

/** Vibration-API patterns per intent (web fallback path). */
export const HAPTIC: Record<HapticIntent, HapticPattern> = {
  tick: 8,
  select: 12,
  toggle: 15,
  success: [8, 20, 8],
  surprise: [10, 30, 15],
  warn: [30, 40, 30],
  heavy: 24,
}

/** Capacitor impact styles per intent (native path). */
const IMPACT: Record<HapticIntent, ImpactStyle> = {
  tick: ImpactStyle.Light,
  select: ImpactStyle.Light,
  toggle: ImpactStyle.Medium,
  success: ImpactStyle.Medium,
  surprise: ImpactStyle.Medium,
  warn: ImpactStyle.Heavy,
  heavy: ImpactStyle.Heavy,
}

export function haptic(pattern: HapticPattern | HapticIntent): void {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    if (typeof pattern === 'string') {
      if (isNative) {
        if (pattern === 'success' || pattern === 'warn') {
          void Haptics.notification({
            type: pattern === 'success' ? NotificationType.Success : NotificationType.Error,
          }).catch(() => {})
        } else {
          void Haptics.impact({ style: IMPACT[pattern] }).catch(() => {})
        }
        return
      }
      if ('vibrate' in navigator) navigator.vibrate(HAPTIC[pattern])
      return
    }

    // Raw pattern (legacy numeric call sites): native has no ms analog, so a
    // medium impact is the closest single gesture.
    if (isNative) {
      void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {})
      return
    }
    if (import.meta.env.DEV) {
      console.log('[HAPTIC] Pattern:', pattern, '| vibrate in navigator:', 'vibrate' in navigator, '| navigator.vibrate type:', typeof navigator.vibrate)
    }
    if ('vibrate' in navigator) navigator.vibrate(pattern)
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[HAPTIC] Error:', err)
    }
  }
}

/** True when haptics have a working backend (native plugin or Vibration API). */
export function hapticsAvailable(): boolean {
  return isNative || (typeof navigator !== 'undefined' && 'vibrate' in navigator)
}
