// ============ Motion preferences (UI audit F-17) ============
// JS-driven motion (smooth scrolling) must honour the same OS query the CSS
// `@media (prefers-reduced-motion: reduce)` block does.

/** True when the user asked the OS to minimise non-essential motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** `behavior` value for scrollIntoView/scrollTo that respects the preference. */
export function scrollBehavior(): 'auto' | 'smooth' {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}

/** Six items take the stagger. Every later item shares the sixth step. */
export const MOTION_STAGGER_STEPS = 6
export const MOTION_STAGGER_MAX_STEP = MOTION_STAGGER_STEPS - 1

export function staggerStep(index: number): number {
  const whole = Number.isFinite(index) ? Math.floor(index) : 0
  return Math.min(Math.max(whole, 0), MOTION_STAGGER_MAX_STEP)
}

export function staggerDelay(index: number): string {
  return `calc(var(--stagger-step) * ${staggerStep(index)})`
}

/** A stagger delay that starts after a page's own block steps. `baseVar` names a custom
 *  property that holds the number of steps to wait. It reads 0 when the property is unset,
 *  so the same card on another page, or after the arrival, plays at once. */
export function staggerDelayAfter(index: number, baseVar: string): string {
  return `calc(var(--stagger-step) * (var(${baseVar}, 0) + ${staggerStep(index)}))`
}

/**
 * Timing for the few JS-driven animations (the Board's FLIP settle, the day
 * collapse's unmount), resolved from the CSS motion tokens so JS and CSS can't
 * drift apart — the FLIP easing used to be `--ease-out` duplicated
 * byte-for-byte in a string, and its duration matched no token. Falls back to
 * the token values when the stylesheet hasn't loaded (SSR/tests).
 *
 * `token` names a duration step (docs/MOTION-TOKENS.md); a surface whose CSS
 * transition uses `--motion-slower` must ask for that token, or its JS timer
 * fires while the CSS is still moving.
 */
const MOTION_DURATION_FALLBACK: Record<string, number> = {
  '--motion-instant': 90,
  '--motion-fast': 160,
  '--motion-med': 240,
  '--motion-slow': 360,
  '--motion-slower': 560,
}

export function motionTiming(token: keyof typeof MOTION_DURATION_FALLBACK | string = '--motion-slow'): { duration: number; easing: string } {
  const fallback = { duration: MOTION_DURATION_FALLBACK[token] ?? 240, easing: 'cubic-bezier(.3, .86, .48, 1)' }
  if (typeof window === 'undefined') return fallback
  const s = getComputedStyle(document.documentElement)
  const cssDuration = s.getPropertyValue(token).trim()
  const duration = parseFloat(cssDuration) * (cssDuration.endsWith('ms') ? 1 : cssDuration.endsWith('s') ? 1000 : NaN)
  const easing = s.getPropertyValue('--ease-glide').trim()
  return {
    duration: Number.isFinite(duration) && duration >= 0 ? duration : fallback.duration,
    easing: easing || fallback.easing,
  }
}

const EXIT_EASING_FALLBACK = 'cubic-bezier(.4, 0, 1, 1)'

/** CSS and JS share one named exit lifetime. A zero entrance stays a zero exit. */
export function motionExitTiming(token: keyof typeof MOTION_DURATION_FALLBACK | string = '--motion-med'): { duration: number; easing: string } {
  const { duration } = motionTiming(token)
  if (typeof window === 'undefined') return { duration, easing: EXIT_EASING_FALLBACK }
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease-exit').trim()
  return { duration, easing: easing || EXIT_EASING_FALLBACK }
}
