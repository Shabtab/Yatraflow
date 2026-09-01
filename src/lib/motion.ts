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