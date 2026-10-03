// A soft-unpublished publication (#350) leaves every PUBLIC catalog surface:
// Explore's gallery, its featured card and style counts, the crawler's card
// and sitemap, and the creator's public page. The row itself survives — buyers
// keep the plan they paid for and the creator's own hub keeps its sales
// history — so this filter answers "what can a visitor see", never "what
// exists".
//
// Exported because the test suite runs in node env and cannot render a page:
// `tests/soft-unpublish.test.ts` calls this rather than re-implementing the
// predicate and asserting its own copy.
import type { PublishedItinerary } from '../data/types'

export function livePubs(pubs: PublishedItinerary[]): PublishedItinerary[] {
  return pubs.filter(p => !p.unpublishedAt)
}
