// ============ Story arcs (Horizon 3.5) ============
// Pure, provider-agnostic. Candidate sights cluster by theme — fort, spice,
// backwater, pilgrimage, beach, waterfall, museum — from category plus
// name/description keywords (Wikipedia text gives the tags). Arcs with two or
// more hits qualify as a themed bundle for one-tap multi-add.
export interface StoryArc {
  theme: string
  label: string
  hitIds: (string | number)[]
}

const CATEGORY_THEME: Record<string, string> = {
  fort: 'fort',
  palace: 'fort',
  temple: 'pilgrimage',
  church: 'pilgrimage',
  mosque: 'pilgrimage',
  beach: 'beach',
  waterfall: 'waterfall',
  museum: 'museum',
  market: 'spice',
  spice: 'spice',
  lake: 'backwater',
  backwater: 'backwater',
}

const KEYWORD_THEME: [RegExp, string][] = [
  [/fort|palace|citadel|mahal/i, 'fort'],
  [/temple|shrine|pilgrim|church|mosque|ghat\b/i, 'pilgrimage'],
  [/beach|coast|island/i, 'beach'],
  [/waterfall|falls|cascade/i, 'waterfall'],
  [/spice|market|bazaar|plantation/i, 'spice'],
  [/backwater|lagoon|houseboat|lake/i, 'backwater'],
  [/museum|gallery|heritage/i, 'museum'],
]

const THEME_DAY: Record<string, string> = {
  fort: 'Fort day',
  pilgrimage: 'Temple trail',
  beach: 'Beach day',
  waterfall: 'Waterfall run',
  spice: 'Spice trail',
  backwater: 'Backwater day',
  museum: 'Museum day',
}

/** Theme for one candidate, or null when nothing matches. */
export function themeForHit(hit: { category?: string; name?: string; description?: string }): string | null {
  const cat = (hit.category ?? '').trim().toLowerCase()
  if (cat && CATEGORY_THEME[cat]) return CATEGORY_THEME[cat]
  const text = `${hit.name ?? ''} ${hit.description ?? ''}`
  for (const [re, theme] of KEYWORD_THEME) {
    if (re.test(text)) return theme
  }
  return null
}

/** Group hits into themed arcs; singletons don't make a story. */
export function clusterStoryArcs<T extends { id: string | number; name?: string; category?: string; description?: string }>(
  hits: T[],
): StoryArc[] {
  const groups = new Map<string, T[]>()
  for (const h of hits) {
    const theme = themeForHit(h)
    if (!theme) continue
    const list = groups.get(theme) ?? []
    list.push(h)
    groups.set(theme, list)
  }
  const arcs: StoryArc[] = []
  for (const [theme, members] of groups) {
    if (members.length < 2) continue
    const day = THEME_DAY[theme] ?? `${theme} day`
    arcs.push({
      theme,
      label: `${day}: ${members.map(m => m.name ?? m.id).join(' → ')}`,
      hitIds: members.map(m => m.id),
    })
  }
  // biggest story first
  arcs.sort((a, b) => b.hitIds.length - a.hitIds.length)
  return arcs
}
