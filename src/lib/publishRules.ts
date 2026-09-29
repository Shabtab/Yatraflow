// ============ Publication rules — what may be published, in one place =======
//
// Six rules decide whether a row can go on Explore, and until #354 every one of
// them lived ONLY inside `PublicationForm`. The writer (`publishItinerary`)
// enforced none of them and the database had no CHECK either, so any caller
// other than that one form — a future surface, a console, a test — could write a
// row that is broken in a way no reader can see from inside the app:
//
//   * a coverless row, whose link silently previews as the brand card
//     (`api/i.js` falls back to `og-default.png` when `cover_image_url` is null);
//   * a row priced above the gateway's ceiling, which 503s AT CHECKOUT with no
//     visible cause (`purchase_orders.amount_inr` caps at 100000);
//   * a priced row whose every day is free — a paid unlock that reveals content
//     the reader can already see, i.e. charged for nothing;
//   * a premium row with no call-to-action.
//
// WHY A MODULE AND NOT A FUNCTION IN THE FORM: the writer and the form must
// refuse for the SAME reason with the SAME words, and two copies of six rules is
// exactly how that pairing starts drifting. A pure function of six scalars and a
// string map is cheap to share and trivial to test in node, which is what lets
// the writer import it without importing the page.
//
// The return type is a FIELD-KEYED map rather than one string (#389) because six
// rules over four fields cannot honestly collapse into a single message: a reader
// told only "Premium days need a call-to-action" still has to work out which
// control it means, and a screen-reader user is told nothing at all about where.

/** `purchase_orders.amount_inr` caps at 100000 — the gateway's sensible
 *  test-mode ceiling. Named so no caller can restate it. */
export const MAX_PREMIUM_PRICE_INR = 100000

/** The cover literal. THREE call sites — this module, `PublicationForm`'s own
 *  check, and `api/i.js` — and `tests/share-preview.test.ts` pins all three to
 *  the same source string. `api/i.js` is plain JS outside `src` and must not
 *  import client code, so the pin is a literal test rather than a shared import
 *  (the same rule the sitemap's origin literal follows). */
export const COVER_URL_PATTERN = /^https:\/\/\S+$/

/** The order the checks run in, and therefore the order a reader is TALKED
 *  through them: top of the form to bottom. The form's first-invalid focus walks
 *  this list, so a submission failing three rules lands on the topmost field a
 *  reader would fix first, not on whichever key happened to be inserted first.
 *  The writer uses it to pick which refusal to throw. */
export const PUBLISH_FIELD_ORDER = ['cover', 'price', 'freeDays', 'cta'] as const
export type PublishField = typeof PUBLISH_FIELD_ORDER[number]

/** What a field is called in the assertive summary, so the announcement names
 *  the field as well as the complaint ("Premium price: …"). */
export const PUBLISH_FIELD_LABELS: Record<PublishField, string> = {
  cover: 'Cover photo', price: 'Premium price', freeDays: 'Free days', cta: 'Unlock call-to-action',
}

export interface PublishValidationInput {
  /** Already trimmed by the caller — the handler never trims, so the trim has
   *  to happen before this decides anything. */
  coverImageUrl: string | undefined
  priceNum: number
  /** True when the publication carries no price at all (every day free). */
  entirelyFree: boolean
  freeDayCount: number
  totalDays: number
  cta: string
  hasPremiumDay: boolean
}

/**
 * The rules. Returns a field-keyed map of what is wrong; empty means publishable.
 *
 * The messages are the form's original wording, unchanged on purpose: rewording
 * a publish form's copy is not part of making the rule enforceable, and a reader
 * who has read the old sentence should not meet a new one.
 */
export function publishValidation(input: PublishValidationInput): Partial<Record<PublishField, string>> {
  const { coverImageUrl, priceNum, entirelyFree, freeDayCount, totalDays, cta, hasPremiumDay } = input
  const errs: Partial<Record<PublishField, string>> = {}
  // The publication's cover IS the link preview: `api/i.js` serves it as
  // og:image/twitter:image. Publishing without one — or with a URL the handler's
  // own test rejects — ships a link that previews as the brand card instead of
  // this trip, which is the one thing a creator cannot see from inside the app.
  if (!coverImageUrl) errs.cover = 'Add a cover photo — it is the picture your share link previews with.'
  else if (!COVER_URL_PATTERN.test(coverImageUrl)) errs.cover = 'The cover must be an https image URL — link previews ignore anything else.'
  if (!Number.isFinite(priceNum) || priceNum < 0) errs.price = 'Price must be a number of rupees, 0 or more.'
  else if (!entirelyFree && priceNum > MAX_PREMIUM_PRICE_INR) errs.price = 'The maximum premium price is ₹1,00,000.'
  else if (!Number.isInteger(priceNum)) errs.price = 'Price must be a whole number of rupees.'
  // A price over content the reader can already see is charged for nothing, so
  // a priced publication must withhold at least one day.
  else if (!entirelyFree && freeDayCount >= totalDays) errs.freeDays = 'Every day is free — clear the price or lock a day.'
  // The ≥1-free-day rule used to live ONLY in the day toggle's guard, so it was
  // enforced by interaction rather than at the point of writing: a publication
  // hydrated with `freeDayIndexes: []` slipped past the toggle entirely and
  // published a premium plan with zero free days — `0 >= totalDays` is false,
  // and every day button renders as free. Re-asserted here for both callers;
  // the toggle keeps its friendly version for the interactive case.
  else if (!entirelyFree && freeDayCount < 1) errs.freeDays = 'At least one day must stay free — it is the preview readers see.'
  if (hasPremiumDay && !cta) errs.cta = 'Premium days need a call-to-action — tell readers what they get when they unlock.'
  return errs
}

/**
 * A publication the WRITER refused — thrown before anything is written.
 *
 * Carries the field key as well as the message, so a form can put the message on
 * the control it is about instead of in a generic banner. It is a distinct type
 * rather than a bare `Error` so a caller can tell "you asked for something
 * invalid" from "the network failed", and react differently: the first is
 * something to fix in the form, the second is something to retry.
 *
 * Nothing is committed and nothing is rolled back when this is thrown — it is
 * raised before the first cache write, which is the point of putting it first.
 */
export class PublishRejected extends Error {
  readonly field: PublishField
  readonly errors: Partial<Record<PublishField, string>>
  constructor(message: string, field: PublishField, errors: Partial<Record<PublishField, string>>) {
    super(message)
    this.name = 'PublishRejected'
    this.field = field
    this.errors = errors
  }
}
