// The browser-tab title for each route.
//
// `index.html` carries one static title, so every route shared it: a traveller
// with four tabs open saw one site title four times,
// and a bookmark of a specific itinerary was indistinguishable from a bookmark
// of the site. The route is the only thing that changes, so the mapping lives
// here rather than inline in the shell.
//
// Pure and argument-taking, so it is testable without a router or a DOM. The
// route segments are passed already split (App.tsx splits them for the router
// anyway) and the `subject` — a trip name, an itinerary title, a creator's
// name — is supplied by whoever holds that data. App deliberately slices its
// store subscriptions, so it does not read the trips table just to title a tab;
// the page that already has the record refines the title itself.

import { FAQ_DESCRIPTION, FAQ_TITLE } from './faqContent'
import { HOW_IT_WORKS_DESCRIPTION, HOW_IT_WORKS_TITLE } from './howItWorksContent'

export const SITE = 'YatraFlow'

/** Route head -> title, for the routes that need nothing looked up. */
const STATIC: Record<string, string> = {
  '': `${SITE}: Plan Indian trips together`,
  about: `About · ${SITE}`,
  auth: `Sign in · ${SITE}`,
  trips: `Your trips · ${SITE}`,
  new: `New trip · ${SITE}`,
  explore: `Explore itineraries · ${SITE}`,
  creators: `Creator rankings · ${SITE}`,
  'creator-hub': `Creator hub · ${SITE}`,
  purchases: `My purchases · ${SITE}`,
  admin: `Admin · ${SITE}`,
  profile: `Profile · ${SITE}`,
  join: `Join a trip · ${SITE}`,
  invite: `Join a trip · ${SITE}`,
  share: `A shared trip · ${SITE}`,
  faq: FAQ_TITLE,
  'how-it-works': HOW_IT_WORKS_TITLE,
}

/** Route head -> the meta description a page carries. Every other route keeps
 *  the site description that index.html ships. */
const DESCRIPTIONS: Record<string, string> = {
  faq: FAQ_DESCRIPTION,
  'how-it-works': HOW_IT_WORKS_DESCRIPTION,
}

/** Routes whose title is the record's own name when we have it. */
const NAMED: Record<string, string> = {
  pub: 'Itinerary',
  trip: 'Trip',
  creator: 'Creator',
}

/** The route's segments, with a query string stripped — it rides on the head
 *  segment (`/auth?mode=signup` must still match `auth`). App.tsx derives its
 *  router segments from this same helper, so a title and the route it names
 *  can never disagree about what a URL means. */
export function routeParts(route: string): string[] {
  return route.split('/').filter(Boolean).map(s => s.split('?')[0])
}

export function pageTitle(parts: string[], subject?: string | null): string {
  const head = parts[0] ?? ''
  if (!head) return STATIC['']
  if (head in NAMED) return `${subject || NAMED[head]} · ${SITE}`
  return STATIC[head] ?? SITE
}

/** The title and the meta description for one route. App applies both, so a
 *  page's own SEO copy ships with the route rather than with a DOM call. */
export function pageMeta(parts: string[], subject?: string | null): { title: string; description: string | null } {
  return {
    title: pageTitle(parts, subject),
    description: DESCRIPTIONS[parts[0] ?? ''] ?? null,
  }
}
