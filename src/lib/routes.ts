// ============ Route constants ============
// The create-trip route, in the three forms this app needs it. Those forms used
// to be three independent string literals — a hash in the bench CTA, a bare
// segment in the router's `switch`, and a path in two nav links — and the bench's
// once read `#/create`, which no route handled: the CTA looked alive, the
// router's `default:` dropped the visitor on the landing page, and the prefill
// the bench had just stashed was never read (#398). Derived from one segment, so
// a rename cannot half-land: change `CREATE_SEGMENT` and every form follows.

/** The bare segment the router's `switch` matches. */
export const CREATE_SEGMENT = 'new'

/** The path form, for comparisons such as `route === CREATE_PATH`. */
export const CREATE_PATH = `/${CREATE_SEGMENT}`

/** The hash form, for links, redirects and `location.hash = CREATE_ROUTE`. */
export const CREATE_ROUTE = `#${CREATE_PATH}`
