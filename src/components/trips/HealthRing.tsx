// ============ My trips — estimated health ring ============
// The engine's health score as a 54px ring. The arc colour follows the band
// (see ringTone) and the number sits in the middle. The list page has no
// measured road data, so the label says "Estimated". The arc draws in from
// zero with a motion token; reduced motion shows the final arc at once.
import type { CSSProperties } from 'react'
import type { HealthResult } from '../../lib/engine'
import { ringLabel, ringTone } from '../../lib/tripCountdown'

const RADIUS = 18
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function HealthRing({ health }: { health: Pick<HealthResult, 'score' | 'band'> }) {
  const label = ringLabel(health)
  const offset = CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, health.score)) / 100)
  return (
    <svg className={`mt-ring mt-ring--${ringTone(health.band)}`} viewBox="0 0 44 44" width="54" height="54" role="img" aria-label={label}>
      <title>{label}</title>
      <circle className="mt-ring-track" cx="22" cy="22" r={RADIUS} />
      <circle
        className="mt-ring-arc" cx="22" cy="22" r={RADIUS} transform="rotate(-90 22 22)"
        strokeDasharray={CIRCUMFERENCE} strokeDashoffset={offset}
        style={{ '--mt-ring-full': CIRCUMFERENCE } as CSSProperties}
      />
      <text x="22" y="26.5" textAnchor="middle">{health.score}</text>
    </svg>
  )
}
