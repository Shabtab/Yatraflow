// ============ Haptics — navigator.vibrate wrapper ============
// Satisfying physical feedback for mobile users. Silence is the contract:
// no-ops on unsupported browsers (iOS Safari ignores vibrate), reduced-motion
// users, and any failure. Patterns are ms (or [ms, pause, ms] arrays) per the
// Vibration API.
export type HapticPattern = number | number[]

export function haptic(pattern: HapticPattern): void {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    
    // Diagnostic logging for vibration issues
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

/** Named interaction patterns so call sites read as intent, not numbers. */
export const HAPTIC: Record<
  'tick' | 'select' | 'toggle' | 'success' | 'surprise', HapticPattern
> = {
  /** slider step tick */
  tick: 8,
  /** chip / pill selection */
  select: 12,
  /** segmented toggle / reset */
  toggle: 15,
  /** copy-to-clipboard celebration */
  success: [8, 20, 8],
  /** surprise-me slot machine */
  surprise: [10, 30, 15],
}
