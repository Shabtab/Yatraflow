// ============ Trip DNA (Horizon 3.3) ============
// The engine remembers accepted/declined suggestions and builds a small
// preference vector per trip: category affinity, detour tolerance, accept
// volume. New candidates score a similarity boost and explain themselves
// ("you've picked 3 waterfall stops this trip"). Pure core below; the
// localStorage log at the bottom is the only impure part (best-effort,
// capped, never throws).
export interface DnaEvent {
  tripId: string
  /** 'seed' = an open crew idea: bends affinity but is NOT a crew acceptance */
  action: 'accept' | 'decline' | 'seed'
  category?: string
  detourMin?: number
}

export interface DnaVector {
  accepts: number
  declines: number
  /** accepted count per category, minus declines (floored at 0) */
  categoryAffinity: Record<string, number>
  /** mean detour of accepted picks in minutes, null when none recorded */
  avgDetourMin: number | null
}

/** Affinity streak that earns a "you've picked N…" note on cards. */
const NOTE_THRESHOLD = 2
/** Boost points per affinity count, capped — same scale as purpose-fit. */
const BOOST_PER_PICK = 1
const MAX_BOOST = 3

function normCat(category: string | undefined): string | null {
  const c = (category ?? '').trim().toLowerCase()
  return c ? c : null
}

/** Fold events into a preference vector. Optionally scoped to one trip. */
export function buildDnaVector(events: DnaEvent[], tripId?: string): DnaVector {
  const v: DnaVector = { accepts: 0, declines: 0, categoryAffinity: {}, avgDetourMin: null }
  let detourSum = 0
  let detourN = 0
  for (const e of events) {
    if (tripId != null && e.tripId !== tripId) continue
    const cat = normCat(e.category)
    if (e.action === 'accept') {
      v.accepts += 1
      if (cat) v.categoryAffinity[cat] = (v.categoryAffinity[cat] ?? 0) + 1
      if (Number.isFinite(e.detourMin) && (e.detourMin as number) >= 0) {
        detourSum += e.detourMin as number
        detourN += 1
      }
    } else if (e.action === 'seed') {
      // A proposed idea biases the corridor toward its kind but must not
      // inflate the acceptance record — proposing ≠ the crew having gone.
      if (cat) v.categoryAffinity[cat] = (v.categoryAffinity[cat] ?? 0) + 1
    } else {
      v.declines += 1
      if (cat) v.categoryAffinity[cat] = Math.max(0, (v.categoryAffinity[cat] ?? 0) - 1)
    }
  }
  if (detourN > 0) v.avgDetourMin = detourSum / detourN
  return v
}

/** Similarity boost in score points (subtract from the segment score). */
export function dnaBoostForHit(
  hit: { category?: string },
  vector: DnaVector,
): number {
  const cat = normCat(hit.category)
  if (!cat) return 0
  const affinity = vector.categoryAffinity[cat] ?? 0
  return Math.min(MAX_BOOST, affinity * BOOST_PER_PICK)
}

/** Streak note for cards, or null when there is no story to tell. */
export function dnaNoteForHit(
  hit: { category?: string },
  vector: DnaVector,
): string | null {
  const cat = normCat(hit.category)
  if (!cat) return null
  const affinity = vector.categoryAffinity[cat] ?? 0
  if (affinity < NOTE_THRESHOLD) return null
  return `you've picked ${affinity} ${cat} stops this trip`
}

// ---- best-effort local log (impure; UI layer only) ----
const DNA_KEY = 'yatraflow_dna_log'
const DNA_CAP = 500

export function loadDnaLog(): DnaEvent[] {
  try {
    const raw = localStorage.getItem(DNA_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is DnaEvent =>
        !!e && typeof e === 'object' && typeof (e as DnaEvent).tripId === 'string' &&
        ((e as DnaEvent).action === 'accept' || (e as DnaEvent).action === 'decline'),
    )
  } catch {
    return []
  }
}

export function recordDnaEvent(event: DnaEvent): void {
  try {
    const log = loadDnaLog()
    log.push(event)
    localStorage.setItem(DNA_KEY, JSON.stringify(log.slice(-DNA_CAP)))
  } catch {
    /* DNA is best-effort — a full/blocked store never breaks suggestions */
  }
}

// ---- crew seeds (Horizon 3.4): open group-input ideas feed the engine ----
export interface CrewSeed {
  name: string
  category?: string
  lat: number
  lng: number
}

/** Open ideas with usable coords become seeds; declined/coord-less ones drop. */
export function crewSeedsFromSuggestions(
  suggestions: { status: string; title: string; category?: string; lat: number; lng: number }[],
): CrewSeed[] {
  return suggestions
    .filter(s => s.status !== 'declined' && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .map(s => ({ name: s.title, category: s.category, lat: s.lat, lng: s.lng }))
}

/** Seeds in planned-stop shape — near-duplicate corridor hits get suppressed. */
export function crewSeedsToPlannedStops(seeds: CrewSeed[]): { lat: number; lng: number; name: string }[] {
  return seeds.map(s => ({ lat: s.lat, lng: s.lng, name: s.name }))
}

/** Each seed biases its kind ('seed' action — affinity without accept credit). */
export function crewSeedEvents(tripId: string, seeds: CrewSeed[]): DnaEvent[] {
  return seeds.map(s => ({ tripId, action: 'seed' as const, category: s.category }))
}

/** "More like X" note when a hit matches a seed's kind. */
export function crewNoteForHit(
  hit: { category?: string },
  seeds: CrewSeed[],
): string | null {
  const cat = normCat(hit.category)
  if (!cat) return null
  const seed = seeds.find(s => normCat(s.category) === cat)
  return seed ? `more like ${seed.name}` : null
}
