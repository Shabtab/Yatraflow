// ============ How it works content ============
// The one list behind /how-it-works: six steps, what the product does not do,
// and the closing calls to action. Copy carries no em dash because the app's
// copy gate forbids it in source literals; the one exception is the locked
// brand line, which keeps its own dash word for word.

export const HOW_IT_WORKS_TITLE = 'How YatraFlow works · price it, share it, vote, lock, settle'
export const HOW_IT_WORKS_DESCRIPTION =
  'Five steps from a rough budget to a settled trip: price the route, send one link, let the crew vote, lock the plan, settle up at the end. Works for road, train, flight and bus trips in India.'

export const HOW_IT_WORKS_INTRO =
  'One shared plan instead of a group chat, a notes file and three spreadsheets. Five steps, and you can stop at any of them.'

export interface HowItWorksStep {
  title: string
  body: string
  /** A quiet follow-on link under the paragraph. */
  link?: { label: string; href: `/${string}` }
}

export const HOW_IT_WORKS_STEPS: readonly HowItWorksStep[] = [
  {
    title: 'Price it before you plan it',
    body: 'Pick a route and a group size, and you get a low-to-high range in rupees: transport, stay, food, entries, buffer. Every number shows its assumption and every number is editable.',
    link: { label: 'Try a free calculator', href: '/trip-cost-calculators/' },
  },
  {
    title: 'Start the plan',
    body: 'Turn that estimate into a trip in one tap, or start empty. Dates, transport mode and party size are the only things we need, and the rest fills in as your crew talks.',
  },
  {
    title: 'Send one link',
    body: 'Share the invite into the group chat. Friends open it, see the plan so far, and join with a free account. No downloads, no group created on someone else’s phone.',
  },
  {
    title: 'Let the crew decide, then close the question',
    body: 'Everyone proposes stops and votes. Put a closing time on the decisions that stall (the hotel, the beach day, the budget cap), and when the clock runs out nobody reopens it. An editor applies the winner to the timeline.',
  },
  {
    title: 'Watch the plan hold up',
    body: 'Add a stop and you see the damage before you accept it: extra driving, extra cost, the day that now ends after dark. The map has four views for this: driving time, distance from your base, the gaps left in a day, and the legs that need fixing.',
  },
  {
    title: 'Settle up without the awkward week',
    body: 'Log what you paid as you go. At the end, YatraFlow works out who owes whom and gives the smallest number of transfers that clears everyone.',
  },
]

export const HOW_IT_WORKS_LIMITS: readonly string[] = [
  'It doesn’t book anything. It doesn’t move your money: you pay each other. It doesn’t promise your drive times to the minute; it gives you a plan you can defend and warnings when a day won’t fit.',
  'It also doesn’t need your whole crew on day one. Two people can start and the rest can join a week later without losing the thread.',
]

/** The locked brand lines, word for word. */
export const BRAND_LINE_MAIN = 'Plan Indian trips together — not in a chaotic group chat.'
export const BRAND_LINE_SUPPORT = 'Every stop, hour and rupee in one plan your group can actually follow.'

export interface HowItWorksCta {
  label: string
  href: `/${string}`
}

export const HOW_IT_WORKS_CTAS: readonly HowItWorksCta[] = [
  { label: 'Start a free plan', href: '/new' },
  { label: 'Price a trip first', href: '/trip-cost-calculators/' },
  { label: 'See it on a sample trip', href: '/explore' },
]
