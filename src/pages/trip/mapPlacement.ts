/**
 * #418 — what a discovered place may be filed into, and why not.
 *
 * The Map tab can already discover a place in several places (the corridor search,
 * a slot's own search, the rail's candidates) and can already file one in several
 * ways (a day, an empty part, the shortlist, a crew vote). What it had no single
 * surface for was *discover here, then decide where it goes* — so this module owns
 * that decision as a pure list of choices, and the omnibar renders it.
 *
 * Two rules are the whole point, and both are contracts rather than styling:
 *
 *  - **nothing is filed implicitly.** Every option is a choice the user makes; a
 *    search result on its own changes no plan. A disabled option always carries
 *    the reason it is disabled, in words.
 *  - **an unplaced hit cannot be filed.** A hit whose coordinates have not
 *    resolved (the Mappls placeholder, or a provider that answered without a
 *    position) is offered no option at all — the same `hasCoords` gate the rails
 *    use, so no placeholder can reach trip data through this surface.
 */
import type { PlaceHit } from '../../lib/geocode'
import { hasCoords } from '../../lib/providers/hits'

export type PlacementKind = 'day' | 'slot' | 'shortlist' | 'vote'

export type PlacementOption = {
  kind: PlacementKind
  /** present on a slot option — the empty part it would fill */
  slotKey?: string
  /** the button's own words */
  label: string
  /** the sentence under the button: what this would do, or what it already does */
  hint: string
  disabled: boolean
  /** why it is disabled. Always present when `disabled` — never implied. */
  reason?: string
}

export type PlacementInput = {
  /** the selected discovery, or null when nothing is selected */
  hit: (Pick<PlaceHit, 'name' | 'latitude' | 'longitude'> & { id?: PlaceHit['id'] }) | null
  /** the day the map is planning (the rail's active day). Its empty parts are
   *  the filing options, so their hints name this day. */
  dayIndex: number
  /** The day the stop editor will open on. The caller resolves it through the
   *  same road-position lookup the editor uses. When the position is unknown,
   *  pass the editor's own fallback: the trip's first day. The day option names
   *  THIS day, so the label and the editor cannot disagree (#I-41). */
  placeDayIndex: number
  /** the placement day's own title, when it has one */
  placeDayLabel?: string | null
  /** the hit's road position, when the route could place it (km) */
  km?: number | null
  /** empty parts of the active day this hit's own category can serve */
  filingOptions: Array<{ key: string; label: string; noun: string }>
  /** the hit is already in the plan (any day, matched the way the rails match) */
  alreadyAdded: boolean
  /** the hit is already on the shortlist */
  shortlisted: boolean
  /** how many OTHER hits the shortlist tray holds */
  shortlistCount: number
}

/** The one place that decides a hit is placeable at all. */
export function canPlaceHit(hit: PlacementInput['hit']): boolean {
  return hit != null && hasCoords(hit as PlaceHit)
}

/** What the surface asks once a hit is selected — the explicit placement step. */
export function placementPrompt(hitName: string): string {
  return `Where should “${hitName}” go?`
}

/** How many shortlisted places a vote needs before it can be raised. */
export const VOTE_MIN_PLACES = 2

/**
 * The choices, in the order they are offered. Empty when nothing is selected;
 * every option disabled (with its reason) when the hit cannot be placed.
 */
export function placementOptions(input: PlacementInput): PlacementOption[] {
  const { hit, dayIndex, placeDayIndex, filingOptions, alreadyAdded, shortlisted, shortlistCount } = input
  if (hit == null) return []

  const dayName = `Day ${dayIndex + 1}`
  // #I-41: the day option names the day the stop editor will open on. The
  // caller resolves one day and passes it here and to the click, so the label
  // and the editor cannot drift apart.
  const placeDayName = `Day ${placeDayIndex + 1}`
  const km = input.km
  const dayHint = km == null
    ? `No road position for this place, so ${placeDayName} is a guess — you can change it in the stop editor.`
    : `~${Math.round(km)} km into the route, so it lands on the day that covers that stretch.`

  // A vote is raised FROM the tray, so the hit has to be in it: offering "ask the
  // crew" for a place that is not on the shortlist would either promise a poll
  // that cannot be posted or quietly shortlist it for you — the implicit write
  // this surface exists to avoid.
  const trayAfterThis = shortlisted ? shortlistCount + 1 : shortlistCount
  const voteBlocked = !shortlisted || trayAfterThis < VOTE_MIN_PLACES

  const options: PlacementOption[] = [
    {
      kind: 'day',
      label: `Add to ${placeDayName}`,
      hint: input.placeDayLabel ? `${placeDayName}: ${input.placeDayLabel}. ${dayHint}` : dayHint,
      disabled: false,
    },
    ...filingOptions.map(f => ({
      kind: 'slot' as const,
      slotKey: f.key,
      label: f.label,
      hint: `Fills ${dayName}'s empty ${f.noun} with this place, at its real detour cost.`,
      disabled: false,
    })),
    {
      kind: 'shortlist',
      label: shortlisted ? 'Remove from the shortlist' : 'Put it on the shortlist',
      hint: shortlisted
        ? 'Takes it back off the shortlist. Nothing in the plan changes.'
        : 'Collects it for the tray without touching the plan — decide later.',
      disabled: false,
    },
    {
      kind: 'vote',
      label: voteBlocked ? `Ask the crew to vote (needs ${VOTE_MIN_PLACES} places)` : 'Ask the crew to vote',
      hint: 'Posts the shortlist as one open decision — resolving it lands the winner.',
      disabled: voteBlocked,
      reason: !shortlisted
        ? 'A vote compares places: put this one on the shortlist first, then ask.'
        : `A vote needs ${VOTE_MIN_PLACES} places — shortlist one more, then ask.`,
    },
  ]

  if (!canPlaceHit(hit)) {
    return options.map(o => ({
      ...o,
      disabled: true,
      reason: 'This place has no map position yet, so it cannot be filed — pick another result.',
    }))
  }

  if (alreadyAdded) {
    return options.map(o => ({
      ...o,
      disabled: true,
      reason: `“${hit.name}” is already in your trip.`,
    }))
  }

  return options
}
