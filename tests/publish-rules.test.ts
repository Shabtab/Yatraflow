// ============ Wave C2 — publish, share, cover (#354, #361, #389, #390, #391) ===
//
// The wave's theme: a rule that lived in one place, and a write that had no
// way back. Six rules governed publishing and only the FORM enforced them; three
// writes were optimistic with no rollback; and every failure was reported in a
// way that could not be acted on.
//
// This file pins the RULES (pure, so they run for real here) and the SHAPES of
// the fixes that only exist as source (the store's rollback paths, the form's
// field wiring, the picker's affordances). A node suite cannot render any of
// these surfaces, so source-scanning guards are the honest instrument — and each
// one below reads comment-stripped source, because a guard satisfied by prose
// describing the fix proves nothing about the fix.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  publishValidation, PUBLISH_FIELD_ORDER, PUBLISH_FIELD_LABELS,
  PublishRejected, MAX_PREMIUM_PRICE_INR,
} from '../src/lib/publishRules'

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')
/** Code only — comments removed. Every file here explains itself at length, so
 *  an assertion about what a file DOES must not be satisfiable by a sentence
 *  describing it. */
const codeOf = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(line => !/^\s*(\/\/|--|\*)/.test(line))
  .join('\n')

const STORE = codeOf(src('../src/store/store.ts'))
const SHARE = codeOf(src('../src/pages/trip/ShareTab.tsx'))
const PICKER = codeOf(src('../src/components/CoverImagePicker.tsx'))
const RULES = src('../src/lib/publishRules.ts')

/** A valid publication's fields, as a base to break one rule at a time. */
const ok = (over: Partial<Parameters<typeof publishValidation>[0]> = {}) => ({
  coverImageUrl: 'https://images.example.test/k.jpg',
  priceNum: 199,
  entirelyFree: false,
  freeDayCount: 1,
  totalDays: 3,
  cta: 'The full checklist, with stay contacts.',
  hasPremiumDay: true,
  ...over,
})

// ---- #354: the rules are the rules, wherever they are checked ---------------

describe('#354 — the publish rules refuse, and they are ONE set of rules', () => {
  it('accepts a well-formed publication', () => {
    expect(publishValidation(ok())).toEqual({})
  })

  it('refuses a coverless row — the link would preview as the brand card', () => {
    const e = publishValidation(ok({ coverImageUrl: undefined }))
    expect(e.cover).toBe('Add a cover photo — it is the picture your share link previews with.')
  })

  it('refuses a cover the OG handler will not serve', () => {
    // The handler's own rule, so a stored URL can never be one it will reject.
    expect(publishValidation(ok({ coverImageUrl: 'http://insecure.example.test/k.jpg' })).cover)
      .toContain('https')
    expect(publishValidation(ok({ coverImageUrl: 'not a url' })).cover).toBeDefined()
    expect(publishValidation(ok({ coverImageUrl: 'https://has space.jpg' })).cover).toBeDefined()
  })

  it('refuses a price the gateway cannot take, which 503s at checkout', () => {
    // `purchase_orders.amount_inr` caps at 100000. A row above it is accepted by
    // the form today and fails only when a buyer tries to pay.
    expect(publishValidation(ok({ priceNum: MAX_PREMIUM_PRICE_INR + 1 })).price)
      .toBe('The maximum premium price is ₹1,00,000.')
    // …and the boundary itself is allowed.
    expect(publishValidation(ok({ priceNum: MAX_PREMIUM_PRICE_INR })).price).toBeUndefined()
  })

  it('refuses a negative, non-finite or fractional price', () => {
    expect(publishValidation(ok({ priceNum: -1 })).price).toBeDefined()
    expect(publishValidation(ok({ priceNum: Number.NaN })).price).toBeDefined()
    expect(publishValidation(ok({ priceNum: 199.5 })).price).toBe('Price must be a whole number of rupees.')
  })

  it('refuses a price over content the reader can already see', () => {
    // The "charged for nothing" row: every day free, a price nonetheless. The
    // unlock CTA would appear and reveal nothing.
    const e = publishValidation(ok({ freeDayCount: 3, totalDays: 3 }))
    expect(e.freeDays).toBe('Every day is free — clear the price or lock a day.')
  })

  it('refuses a premium plan with no free day at all', () => {
    // The hole the toggle's guard could not see: a publication hydrated with
    // `freeDayIndexes: []` never reaches the toggle.
    const e = publishValidation(ok({ freeDayCount: 0, totalDays: 3 }))
    expect(e.freeDays).toBe('At least one day must stay free — it is the preview readers see.')
  })

  it('refuses a premium plan with nothing to unlock towards', () => {
    expect(publishValidation(ok({ cta: '', hasPremiumDay: true })).cta)
      .toBe('Premium days need a call-to-action — tell readers what they get when they unlock.')
  })

  it('leaves an entirely-free publication alone', () => {
    // Every free-day rule is exempt when nothing is priced — asserting one
    // unconditionally would refuse a plan nobody is charging for.
    expect(publishValidation(ok({ entirelyFree: true, priceNum: 0, freeDayCount: 5, totalDays: 5, cta: '', hasPremiumDay: false })))
      .toEqual({})
  })

  it('the WRITER enforces them, and the form calls the same function', () => {
    // The defect was that the rules were only ever checked by one screen. Both
    // call sites are pinned, and the writer's refusal is a distinct type so a
    // form can tell "you asked for something invalid" from "the network failed".
    expect(STORE).toContain('const violations = publishValidation({')
    expect(STORE).toContain('throw new PublishRejected(')
    expect(SHARE).toContain('publishValidation({')
    // …and the form routes a refusal back onto its FIELDS rather than a banner.
    expect(SHARE).toContain('if (e instanceof PublishRejected)')
  })

  it('the refusal is thrown before anything is written', () => {
    // Ordering, by position: the check must precede the first cache write, or a
    // refused publication is a half-applied one.
    const fn = STORE.slice(STORE.indexOf('export async function publishItinerary'))
    const checkAt = fn.indexOf('publishValidation({')
    const firstCommitAt = fn.indexOf('commit()')
    expect(checkAt).toBeGreaterThan(-1)
    expect(firstCommitAt).toBeGreaterThan(-1)
    expect(checkAt, 'validation must run before the first commit').toBeLessThan(firstCommitAt)
  })

  it('a refused publish carries the FIELD, not just a sentence', () => {
    // Six rules over four fields cannot collapse into one string honestly — this
    // is why the return type is a map (#389), and the writer reuses it.
    const e = publishValidation(ok({ coverImageUrl: undefined, cta: '' }))
    expect(Object.keys(e).sort()).toEqual(['cover', 'cta'])
    const r = new PublishRejected(e.cover!, 'cover', e)
    expect(r).toBeInstanceOf(Error)
    expect(r.field).toBe('cover')
    expect(r.errors.cta).toBeDefined()
  })
})

// ---- #354: the visibility flip is awaited, not fired ------------------------

describe('#354 — a rejected visibility flip cannot leave a live card over a dead page', () => {
  const fn = STORE.slice(STORE.indexOf('export async function publishItinerary'))

  it('awaits the flip instead of firing it', () => {
    // The split state this fixes: the CACHE said public while `get_public_trip`
    // (which requires `visibility = 'public'`) served nothing — an Explore card
    // pointing at a page that does not exist, with nothing said.
    expect(fn).toContain("from('trips').update({ visibility: 'public' })")
    expect(fn).toMatch(/const \{ error: flipError \} = await supabase/)
    // The old shape must be gone from this function.
    expect(fn).not.toMatch(/fire\('trips', supabase\.from\('trips'\)\.update\(\{ visibility/)
  })

  it('rolls the visibility back to the value it had BEFORE the publish', () => {
    // Not a hardcoded 'private': the trip may have been 'link', and a guess
    // would either narrow a shared trip or widen a private one.
    expect(fn).toContain("const tripVisibilityBefore = tripBefore?.visibility ?? 'private'")
    expect(fn).toMatch(/visibility: tripVisibilityBefore/)
    // …and the capture happens before the optimistic write.
    expect(fn.indexOf('tripVisibilityBefore')).toBeLessThan(fn.indexOf('commit()'))
  })

  it('says so when the flip is refused', () => {
    // A rollback nobody is told about is a rollback that reads as success.
    expect(fn).toContain("console.error('[yatraflow] publish visibility flip failed'")
    expect(fn).toMatch(/toast\('Published to Explore, but the public page could not be opened/)
  })
})

// ---- #354: the DB backstop, and the two ways to build a database -----------

describe('#354 — the database refuses the same rows the client does', () => {
  const MIGRATION = src('../supabase/migrations/20260929_published_itineraries_publish_rules.sql')
  const SCHEMA = src('../supabase/schema.sql')

  it('is idempotent — re-running adds nothing twice', () => {
    // `drop constraint if exists` before each add, or a second run errors on a
    // duplicate constraint name and a re-applied migration looks like a failure.
    const names = ['published_itineraries_cover_https', 'published_itineraries_price_in_range', 'published_itineraries_priced_withholds_a_day']
    for (const n of names) {
      const drops = MIGRATION.match(new RegExp(`drop constraint if exists ${n}`, 'g')) ?? []
      const adds = MIGRATION.match(new RegExp(`add constraint ${n}`, 'g')) ?? []
      expect(drops, `${n} has no drop guard`).toHaveLength(1)
      expect(adds, `${n} is not added`).toHaveLength(1)
      // …and the drop comes FIRST, which is the whole of idempotency here.
      expect(MIGRATION.indexOf(`drop constraint if exists ${n}`)).toBeLessThan(MIGRATION.indexOf(`add constraint ${n}`))
    }
  })

  it('grandfathers existing rows rather than failing the migration', () => {
    // NOT VALID: enforced for every new INSERT/UPDATE, existing rows untouched.
    // Without it, applying this to a project that published before the cover
    // rule existed would fail outright — and the alternative (rewriting a
    // creator's live publication) is worse.
    const adds = MIGRATION.match(/add constraint published_itineraries_\w+\s*\n?\s*check \([\s\S]*?\) not valid;/g) ?? []
    expect(adds).toHaveLength(3)
    for (const a of adds) expect(a).toMatch(/not valid;\s*$/)
  })

  it('pins the price ceiling to the one the gateway enforces', () => {
    // purchase_orders.amount_inr caps at 100000. Two constants that must not
    // drift: this SQL and `MAX_PREMIUM_PRICE_INR` in publishRules.ts.
    expect(MIGRATION).toContain('premium_price_inr <= 100000')
    expect(MAX_PREMIUM_PRICE_INR).toBe(100000)
    // The ceiling is stated ONCE in executable SQL. The file also quotes the
    // number in its diagnostic block at the foot (a count query the owner may run
    // before VALIDATE), so the scan is over the constraint itself rather than the
    // whole file — otherwise a helpful comment reads as a second constant.
    const constraint = MIGRATION.slice(
      MIGRATION.indexOf('add constraint published_itineraries_price_in_range'),
      MIGRATION.indexOf(') not valid;', MIGRATION.indexOf('add constraint published_itineraries_price_in_range')),
    )
    expect(constraint.match(/100000/g) ?? []).toHaveLength(1)
  })

  it('uses the handler\'s own cover literal, so no stored URL is one it rejects', () => {
    const rule = String.raw`'^https://\S+$'`
    expect(MIGRATION).toContain(rule)
    expect(MIGRATION).toContain(String.raw`cover_image_url ~ '^https://\S+$'`)
  })

  it('guards the jsonb array before counting it', () => {
    // The poisoned-scalar lesson from #352: `get_public_trip` raised for EVERY
    // visitor when this column was a scalar rather than an array. A CHECK that
    // called jsonb_array_length on a scalar would raise the same way, at write
    // time. So the type is tested FIRST and a non-array is left alone.
    const fn = MIGRATION.slice(MIGRATION.indexOf('published_itineraries_priced_withholds_a_day'))
    expect(fn).toContain("jsonb_typeof(free_day_indexes) <> 'array'")
    expect(fn.indexOf('jsonb_typeof')).toBeLessThan(fn.indexOf('jsonb_array_length'))
  })

  it('schema.sql and the migration carry THE SAME predicate for each rule', () => {
    // schema.sql is a second, independent way to build the database (AGENTS §4),
    // so a fix in the migration series alone leaves a fresh instance wide open.
    // The PREDICATE text is compared, not just the constraint name — a
    // hand-edited divergence (one side loosened, the other not) is invisible to a
    // name check and is exactly the failure this pair exists to prevent.
    // `not valid;` is the ONLY intended difference and it sits outside the
    // extracted predicate.
    // Whitespace inside the slice, INCLUDING the space a wrapped predicate
    // leaves just inside its own parens. The migration wraps (`check (\n  a\n  or
    // (b)\n)`) and the inline schema does not (`check (a or (b))`), so after
    // collapsing runs the two still differ by one space before the closing paren.
    // Stripping spaces adjacent to parens makes the comparison about the
    // PREDICATE rather than about which file wraps its lines — and a hand-edited
    // divergence (one side loosened, the other not) still fails, which is the
    // only thing this check is for.
    const predicate = (source: string, from: number) => {
      const start = source.indexOf('check (', from)
      let depth = 0
      for (let i = source.indexOf('(', start); i < source.length; i++) {
        if (source[i] === '(') depth++
        else if (source[i] === ')') {
          depth--
          if (depth === 0) {
            return source.slice(start, i + 1)
              .replace(/\s+/g, ' ')
              .replace(/\(\s+/g, '(')
              .replace(/\s+\)/g, ')')
              .trim()
          }
        }
      }
      return ''
    }
    for (const n of ['published_itineraries_cover_https', 'published_itineraries_price_in_range', 'published_itineraries_priced_withholds_a_day']) {
      expect(SCHEMA, `${n} missing from schema.sql`).toContain(`constraint ${n}`)
      expect(MIGRATION, `${n} missing from the migration`).toContain(n)
      // The two files are formatted differently on purpose (a migration wraps its
      // predicate across lines, an inline schema does not), and `predicate()`
      // already normalises the whitespace inside the slice — so the ONLY tolerated
      // difference is the `not valid;` that grandfathering adds, and that sits
      // outside the extracted predicate. A hand-edited divergence (one side
      // loosened) shows up here; a reformat does not.
      expect(predicate(SCHEMA, SCHEMA.indexOf(`constraint ${n}`)), `${n} in schema.sql`)
        .toBe(predicate(MIGRATION, MIGRATION.indexOf(`add constraint ${n}`)))
    }
  })
})

describe('#361 — a published row never durably references a third-party cover', () => {
  const fn = STORE.slice(STORE.indexOf('export async function publishItinerary'))

  it('owns the cover before the first commit', () => {
    // The old order committed the Wikimedia URL, awaited the copy, then
    // committed the owned one — so a share link copied in that window served
    // someone else's host at the moment this feature exists to prevent exactly
    // that. Ordering is the whole fix and it is a positional fact.
    const copyAt = fn.indexOf('await ownSuggestedCover(')
    const firstCommitAt = fn.indexOf('commit()')
    expect(copyAt).toBeGreaterThan(-1)
    expect(copyAt, 'owning must resolve before the publication is committed').toBeLessThan(firstCommitAt)
    // The row object itself carries the owned URL, so the upsert cannot write
    // the suggestion even if the cache were read mid-flight.
    expect(fn).toContain('if (ownedUrl) p.coverImageUrl = ownedUrl')
  })

  it('rolls the TRIP cover back too, not just the publication', () => {
    // The half-rollback this fixes: the publication went back to the old cover
    // while the trip card kept the owned one, so a fix-and-republish cycle left
    // the two showing different pictures.
    const errAt = fn.indexOf("'[yatraflow] publish persist failed'")
    const restoreAt = fn.indexOf('updateTrip(p.tripId, { coverImageUrl: tripCoverBefore })')
    expect(errAt).toBeGreaterThan(-1)
    expect(restoreAt, 'the trip cover must be restored on a failed upsert').toBeGreaterThan(errAt)
    // Captured before any write, which is the only time it is knowable.
    expect(fn).toContain('const tripCoverBefore = tripBefore?.coverImageUrl')
    expect(fn.indexOf('tripCoverBefore =')).toBeLessThan(fn.indexOf('commit()'))
  })

  it('restores the trip cover through the same coalescing write path', () => {
    // `updateTrip` participates in the 600ms debounced coalescer. A rollback
    // that went around it would land in a different queue and lose to the
    // coalesced snapshot it is trying to undo.
    expect(fn).toMatch(/updateTrip\(p\.tripId, \{ coverImageUrl: tripCoverBefore \}\)/)
  })

  it('keeps the bounded fallback — a failed copy still publishes', () => {
    // The feature is an improvement, never a new failure mode.
    expect(fn).toContain('cover_image_url: p.coverImageUrl')
    expect(fn).toMatch(/const ownedUrl = owned\.owned && owned\.url \? owned\.url : undefined/)
  })
})

// ---- #389: six rules, four fields, a message on each ------------------------

describe('#389 — the publish form reports a rule against its own field', () => {
  it('mounts the ONE assertive summary, naming the field', () => {
    // Interrupt once, inform per field — the CreateTrip F-15 split, not a new
    // system. The summary reads the FIRST key, which is why the order is fixed.
    expect(SHARE).toContain('<FormErrorSummary errors={errs} labels={PUBLISH_FIELD_LABELS} />')
    expect(PUBLISH_FIELD_ORDER).toEqual(['cover', 'price', 'freeDays', 'cta'])
    // Every field in the order has a name for the announcement.
    for (const k of PUBLISH_FIELD_ORDER) expect(PUBLISH_FIELD_LABELS[k]).toBeTruthy()
  })

  it('focuses the FIRST invalid field, in form order', () => {
    // The bug: one banner at the bottom, no field marked, focus left on the
    // submit button. A keyboard user had no way to find which of six rules failed.
    expect(SHARE).toContain('const first = PUBLISH_FIELD_ORDER.find(k => k in next)')
    expect(SHARE).toMatch(/const target = first \? fieldRefs\.current\[first\] : null/)
    expect(SHARE).toContain('if (target) target.focus()')
    // The fallback for a field with no focusable element of its own, made
    // focusable for the occasion.
    expect(SHARE).toContain("firstErr.setAttribute('tabindex', '-1'); firstErr.focus()")
  })

  it('registers a focus target for every field that can fail', () => {
    // All four, or a failure on the unregistered one silently moves focus to
    // whichever message happens to be first in the document.
    for (const field of PUBLISH_FIELD_ORDER) {
      expect(SHARE, `no focus ref for ${field}`).toContain(`fieldRefs.current.${field} = el`)
    }
  })

  it('wires the price and CTA through Field error= and the rest by hand', () => {
    // `Field` owns the aria wiring for a host control (aria-invalid +
    // describedby) and the picker and the day group are not `Field`s, so they
    // carry it themselves — every failing control is marked either way.
    expect(SHARE).toContain('<Field label="Premium price (₹)" error={errs.price}')
    expect(SHARE).toContain('error={errs.cta}')
    expect(SHARE).toContain('aria-invalid={errs.cover ? true : undefined}')
    expect(SHARE).toContain('aria-invalid={errs.freeDays ? true : undefined}')
  })

  it('keeps field messages POLITE and the summary the only assertive beat', () => {
    // The split that makes a multi-field failure interrupt ONCE: every field
    // message is `role="status"`, and the single `role="alert"` is the
    // write-failure banner, which is genuinely whole-form — a dropped connection
    // is not a field's fault and must not point at the price box.
    //
    // The count is 2 here and 1 in the picker, because the price and CTA inherit
    // their politeness from `Field` (ui.tsx renders `error` as a `role="status"`
    // sibling) while the cover and the day group carry it by hand. Asserting
    // "three" in this file would be counting a message that is not here.
    expect(SHARE.match(/role="status"/g) ?? []).toHaveLength(2)
    expect(SHARE.match(/role="alert"/g) ?? []).toHaveLength(1)
    expect(SHARE).toContain('role="alert">{saveErr}</p>')
    // The picker's own message is polite too — it is a field message, and it
    // shares one node with the form's cover message.
    expect(PICKER).toContain('role="status" aria-live="polite"')
    // And `Field` really does render an `error` politely, or the price/CTA
    // messages would be unannounced.
    expect(src('../src/components/ui.tsx')).toMatch(/role="status"/)
  })

  it('clears each field on its own edit, and a write failure separately', () => {
    // Correcting the price must not silently wipe a still-true complaint about
    // the call-to-action, which a blanket "clear everything" would do.
    expect(SHARE).toContain("clearErr('price')")
    expect(SHARE).toContain("clearErr('cta')")
    expect(SHARE).toContain('setSaveErr(null)')
  })

  it('keeps the awaited publish and its busy guard', () => {
    // #388's work, which #389 must not undo: a publish is a network write, and
    // a double-click must not become two upserts.
    expect(SHARE).toContain('await publishItinerary(')
    expect(SHARE).toContain('disabled={!isOwner || busy}')
  })
})

// ---- #390: the picker stops accepting anything as a URL --------------------

describe('#390 — the cover picker validates what it stores', () => {
  it('refuses a custom URL the publish form or the handler would reject', () => {
    expect(PICKER).toContain('const refusal = coverUrlError(v)')
    expect(PICKER).toContain('if (refusal) { setError(refusal); return }')
    // It must be checked BEFORE the store write, not after.
    const fn = PICKER.slice(PICKER.indexOf('function onCustom()'))
    expect(fn.indexOf('coverUrlError(v)')).toBeLessThan(fn.indexOf('setCover(v)'))
  })

  it('validates with the SAME literal, and it is pinned to all three sites', () => {
    const rule = String.raw`/^https:\/\/\S+$/`
    expect(RULES).toContain(rule)
    expect(PICKER).toContain(rule)
    // The handler is plain JS outside `src` and must not import client code, so
    // this is a literal pin rather than a shared import.
    expect(src('../api/i.js')).toContain(rule)
  })

  it('says so when no suggested photo is found, instead of clearing silently', () => {
    // `fetchFirstAvailableThumb` never throws — a total miss resolves undefined,
    // so this used to clear the cover with no message and no sign of anything.
    const fn = PICKER.slice(PICKER.indexOf('async function onAuto()'))
    expect(fn).toContain('No suggested photo found for these places')
    expect(fn).toMatch(/if \(u\) \{ setCover\(u\); return \}/)
    // …and a thrown lookup is caught rather than escaping the finally.
    expect(fn).toContain('catch (e)')
  })

  it('turns a missing storage bucket into copy a creator can act on', () => {
    // The raw text was "Upload failed: Bucket not found" — a deployment state
    // (the migration unapplied) shown as if it were their file.
    expect(PICKER).toContain('function isBucketMissing(')
    expect(PICKER).toContain("Cover uploads aren’t set up on this project yet")
    // The raw message is logged, not shown — the cause stays diagnosable.
    expect(PICKER).toMatch(/console\.error\('\[yatraflow\] cover upload failed — storage bucket missing'/)
  })

  it('keeps the uploader-id behaviour the bucket policies require', () => {
    // An editor setting a cover uploads under their OWN id. "Fixing" this to
    // the trip owner's id would violate the bucket's folder policy.
    expect(PICKER).toContain('await uploadCover(me.id, file)')
  })
})

// ---- #391: writes that have a way back --------------------------------------

describe('#391 — a refused member write is rolled back and said', () => {
  const removeMember = STORE.slice(STORE.indexOf('export function removeMember'))
  const setRole = STORE.slice(STORE.indexOf('export function setMemberRole'))

  it('no longer fires the delete without watching it', () => {
    // The defect: the row left the cache, the delete fired, and a refused delete
    // resurrected the member on the next hydrate with no message at all.
    expect(removeMember).not.toMatch(/fire\('trip_members'/)
    expect(removeMember).toContain('const removed = before.find(m => m.userId === userId)')
    expect(removeMember).toContain('restore()')
  })

  it('restores the exact row, including joinedAt, and not twice', () => {
    // The cache's own captured row — not a re-read of the server, which is
    // exactly the thing that just refused us.
    expect(removeMember).toContain('current.members = [...(current.members ?? []), removed]')
    expect(removeMember).toContain('if (current.members?.some(m => m.userId === userId)) return')
  })

  it('rolls a role change back to the role it had', () => {
    expect(setRole).not.toMatch(/fire\('trip_members'/)
    expect(setRole).toContain('const previousRole = m.role')
    expect(setRole).toContain('if (dm) dm.role = previousRole')
    // A no-op write is not a write: clicking the current role fires nothing.
    expect(setRole).toContain('if (!t || !m || m.role === role) return')
  })

  it('fails LOUD on both — a quiet failure reads as success', () => {
    expect(removeMember).toMatch(/toast\(`Couldn't remove that traveller/)
    expect(setRole).toMatch(/toast\(`Couldn't change that role/)
    // …and distinguishes a refused write from a dropped connection.
    expect(removeMember).toContain("console.error('[yatraflow] trip_members write failed'")
    expect(setRole).toContain('Couldn’t change that role — check your connection.')
  })

  it('keeps the undo window, which covers intent rather than failure', () => {
    // Both are wanted and they are different failures: the undo restores a
    // removal the user regrets; this restores one the server refused. Dropping
    // either half would leave a stranded member.
    expect(removeMember).toContain('const removed = before.find(')
    expect(src('../src/store/store.ts')).toContain('export function restoreMember')
  })

  it('guards the snapshot link, which could fail in silence', () => {
    // `encodeTripSnapshot` is async and can reject (no CompressionStream, or a
    // plan too large for a URL), which used to leave a button that did nothing:
    // no link, no message.
    expect(SHARE).toContain('const [busy, setBusy] = useState(false)')
    expect(SHARE).toContain('if (busy) return')
    expect(SHARE).toMatch(/catch \(e\) \{[\s\S]*?toast\('Couldn’t build a snapshot link/)
    // The in-flight state is said, and the control is guarded.
    expect(SHARE).toContain("{busy ? 'Building…' : 'Create snapshot link'}")
    expect(SHARE).toContain('disabled={busy}')
  })
})
