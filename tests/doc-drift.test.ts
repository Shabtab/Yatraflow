// ============ Doc drift: a claim about the product's state, checked against the code ============
//
// WHY THIS EXISTS. A doc line in the future tense about shipped work is a defect
// class no gate could see. A sweep once found the monetisation plan still
// inventorying `Payment rail` and `Entitlements` as things that did not exist
// weeks after v0.61.0 shipped them, and `ARCHITECTURE.md` still promising what
// M7 had to add — and the *seed* of that drift was a code comment
// (`premiumPriceInr // placeholder for future payments`) that the plan quoted as
// its own evidence. Nothing in `tsc`, the node suite or the build reads prose.
//
// HOW IT WORKS, and why it fails CLOSED:
//
//   1. DISCOVERY. Every line of every live doc — and of live SOURCE copy,
//      because user-facing strings make claims too — is scanned for an absence
//      cue ("does not exist", "unbuilt", "not wired", "no payments"…).
//   2. EVERY HIT MUST BE REGISTERED, with a reason it is still true today. A
//      new sentence fails the build until someone either fixes it or writes down
//      why it is true — which is the whole point: the M7 drift was not a wrong
//      sentence, it was an unexamined one.
//   3. A REGISTERED CLAIM MAY CARRY A MARKER: repo evidence that the thing now
//      exists. If the marker appears, the claim is a lie and the build fails.
//      This is the half that catches drift by itself — "there is no payouts
//      table" fails the moment a payouts migration lands.
//   4. A REGISTERED CLAIM THAT NO LONGER MATCHES ANY LINE ALSO FAILS, so the
//      registry cannot rot into a list of sentences nobody wrote any more.
//   5. A CLAIM MAY CARRY `requires` — the INVERSE polarity. A live sentence
//      naming shipped work ("…paid itinerary unlocks") stays true only while
//      that evidence exists; if it disappears, the gate fails and the copy
//      must be rewritten with it (#392's second half).
//
// MAINTAINING IT: reword a registered sentence → update its `contains` in the
// same commit. Ship the thing → delete the entry and fix the doc. Neither is
// optional, and the failure message names which one you are in.
//
// WHAT IT DELIBERATELY DOES NOT POLICE: dated snapshots. A report with a status
// date plus a version baseline is the record of a decision, and rewriting it to
// agree with today is how this repo lost its evidence once already (AGENTS §9's
// cousin). Those files are exempt — but only while they still earn it by
// carrying a date, which is asserted below.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** Docs whose sentences describe what the product does TODAY. */
const LIVE = [
  '../README.md',
  '../ROADMAP.md',
  '../AGENTS.md',
  '../docs/ARCHITECTURE.md',
  '../docs/DEPLOYMENT.md',
  '../docs/DESIGN-SYSTEM-GUARDRAILS.md',
  '../docs/UI-PAGE-AUDIT.md',
  '../docs/MOTION-TOKENS.md',
  '../docs/commercial/PLAN-MONETISATION.md',
]

/**
 * Live SOURCE copy: user-facing strings make claims too, and the app footer
 * denied the shipped payments rail for weeks with nothing scanning it (#392).
 * Same machinery as the docs — a line here is a claim like any other. The
 * registered App.tsx claim below doubles as proof this list is scanned: drop
 * the file from here and its claim stops matching a hit, failing the
 * stale-registry test.
 */
const SOURCE_COPY = ['../src/App.tsx']

/**
 * Dated snapshots: exempt, because their claims are about their date. Each must
 * actually carry a date (asserted below) — an exemption that stops being earned
 * fails rather than silently widening.
 *
 * `docs/history/**` is exempt wholesale and not listed: it is an archive by
 * definition (see docs/history/README.md), and nothing in it was ever a claim
 * about today.
 */
const SNAPSHOTS = [
  '../docs/commercial/PLAN-COMMERCIAL-EXECUTION.md',
  '../docs/commercial/REPORT-2026-09-15-strategy-and-position.md',
  '../docs/commercial/RESEARCH-2026-09-18-creator-market-and-paywall-value.md',
]

/**
 * The cue phrases. Kept HIGH-PRECISION on purpose: these are phrasings that
 * claim something is absent or still coming. Note what is deliberately NOT here
 * — "planned", "soon", "future" — because this codebase says "planned road km"
 * and "planned clock anchor" in the middle of perfectly current sentences, and a
 * checker that cries wolf gets deleted.
 */
const CUES = [
  'does not exist', "doesn't exist", 'do not exist', "don't exist",
  'not wired', 'reads nothing from', 'still to come', 'still to be',
  'will be wired', 'will be added', 'unbuilt', 'is not built', 'not implemented',
  'no payouts table', 'to be wired', 'yet to be', 'nothing from them',
  // The shipped-work absence phrasings: the slots decision block (2026-09-22) said
  // three plan items "did not ship" hours before #303 shipped them, and no cue here
  // could see the claim. Zero live-doc hits on the day this line was added.
  'did not ship', 'never shipped', 'has not shipped', 'not yet shipped',
  // The product-scope denials. 'no bookings' / 'no payments' claim the product
  // does not do something; the footer said "no payments" for weeks after the
  // v0.61.0 money rail shipped (#392). Live source copy is scanned too.
  'no bookings', 'no payments',
]

/** Repo evidence that would make a claim false. `paths` takes a file or a
 *  `dir/*.ext` glob; `contains` is matched against the file's text. */
interface Marker {
  what: string
  paths: string[]
  contains: RegExp
}

interface Claim {
  file: string
  /** A stable snippet of the registered sentence — the line must contain it. */
  contains: string
  /** Why this is still true today. A reader should be able to check it. */
  why: string
  /** Counter-evidence: what shipping the thing would look like in the repo.
   *  A hit means the claim is a lie (the claim says absent; the marker shows
   *  present). */
  marker?: Marker
  /** The inverse polarity: repo evidence that must KEEP existing for the
   *  sentence to stay true. A live sentence naming shipped work goes stale
   *  when the thing disappears — the next monetization change must fail the
   *  gate instead of drifting the copy (#392). */
  requires?: Marker
}

// ---- The markers -----------------------------------------------------------

/** The payout rail. Both the card copy and the architecture note say RUNS are
 *  not automated and there is no payouts table; either claim dies with this. */
const PAYOUTS_TABLE: Marker = {
  what: 'a payouts table (payout runs would then have something to be)',
  paths: ['../supabase/schema.sql', '../supabase/migrations/*.sql'],
  contains: /create table[^;]{0,80}\bpayouts\b/i,
}

/** Payout-account / KYC fields on profiles (I-14). */
const KYC_FIELDS: Marker = {
  what: 'payout-account or KYC fields (bank / UPI / PAN) on profiles',
  paths: ['../supabase/schema.sql', '../supabase/migrations/*.sql'],
  contains: /\b(upi_id|bank_account|pan_number|ifsc_code)\b/i,
}

/** The money rail (v0.61.0). The shell footer and AGENTS both name paid
 *  itinerary unlocks; `requires`-watching this keeps them honest when the
 *  rail changes shape. */
const PAYMENTS_RAIL: Marker = {
  what: 'the paid-unlock rail (premiumPriceInr / purchase_orders)',
  paths: ['../src/types.ts', '../src/lib/payments.ts', '../supabase/schema.sql', '../supabase/migrations/*.sql'],
  contains: /\bpremiumPriceInr\b|\bpurchase_orders\b/,
}

// ---- The registry ----------------------------------------------------------

const CLAIMS: Claim[] = [
  {
    file: '../ROADMAP.md',
    contains: 'Before picking up a row',
    why: 'Describes how to work the bank (verify a row against the repo before quoting it) — a rule about the document, not a claim about the product.',
  },
  {
    file: '../ROADMAP.md',
    contains: 'a complete index of unbuilt work',
    why: 'Names what the Idea bank is: the index of what is not built. True by construction while the bank exists.',
  },
  {
    file: '../ROADMAP.md',
    contains: 'still listed as unbuilt in the Sep-6',
    why: 'Past tense about a Sep-6 table that no longer said only that — part of the shipped record for the budget pool.',
  },
  {
    file: '../ROADMAP.md',
    contains: 'the events do not exist to read yet',
    why: "A QUOTATION of the bank's own former blocker, inside the shipped record for I-22/I-15. The events are recorded as of that release; the quoted sentence is history, and the surrounding prose says what shipped.",
  },
  {
    file: '../ROADMAP.md',
    contains: 'is still to come here',
    why: "A QUOTATION of the Analytics tab's deleted promise, in the record of the read that replaced it.",
  },
  {
    file: '../ROADMAP.md',
    contains: 'the part that is not built',
    why: 'Payout RUNS are still not automated — no payouts table, no gateway payout API — and the payout card says so in as many words.',
    marker: PAYOUTS_TABLE,
  },
  {
    file: '../ROADMAP.md',
    contains: 'no payouts table, no gateway payout API',
    why: 'Same fact, stated in the record of the payout-runs ledger.',
    marker: PAYOUTS_TABLE,
  },
  {
    file: '../docs/ARCHITECTURE.md',
    contains: 'there is no payouts table and no gateway payout API',
    why: 'The contract that payout runs are a schedule and a ledger, not a disbursement. It must stay true until a rail exists.',
    marker: PAYOUTS_TABLE,
  },
  {
    file: '../docs/commercial/PLAN-MONETISATION.md',
    contains: 'a product surface that does not exist',
    why: 'Payout-account and KYC collection (I-14) has no surface: a creator cannot enter bank details anywhere. The plan flags it as the dependency most likely to be underestimated, which is the reason to keep the sentence.',
    marker: KYC_FIELDS,
  },
  {
    file: '../AGENTS.md',
    contains: 'directory that does not exist',
    why: 'Records a correction inside §1.1: a previous status block reported a directory this clone does not have.',
  },
  {
    file: '../AGENTS.md',
    contains: 'does not exist in this clone',
    why: 'A checked fact about this working copy, with the date it was checked.',
  },
  {
    file: '../AGENTS.md',
    contains: 'A sweep for',
    why: 'THE LEARNING ENTRY for this defect class: it quotes the stale phrases on purpose, as the example of what was found. Registering it here is the intended recursion.',
  },
  {
    file: '../AGENTS.md',
    contains: 'even on iOS where',
    why: 'A platform fact — iOS implements no Vibration API — not a claim about this product. It cannot become false by us shipping something.',
  },
  {
    file: '../AGENTS.md',
    contains: '`404 PGRST205` means it does not exist',
    why: 'A probe RECIPE, not a claim about this product: the sentence explains what two PostgREST codes mean when you ask for a table. It cannot become false by us shipping something — it would only go stale the day PostgREST renumbers its codes, which is their fact and not ours.',
  },
  {
    file: '../AGENTS.md',
    contains: 'every unbuilt idea',
    why: "Describes ROADMAP's Idea bank, same as the ROADMAP entries above.",
  },
  {
    file: '../AGENTS.md',
    contains: 'still listed as unbuilt, though',
    why: 'Past tense, in the record of a Sep-6 table that had mis-filed a shipped engine helper.',
  },
  {
    file: '../src/App.tsx',
    contains: 'No bookings — planning plus paid itinerary unlocks',
    why: "The shell footer's honest scope line (#392): bookings do not exist (a true absence), and paid itinerary unlocks DO (v0.61.0) — the sentence names both halves. The requires-marker is the fix's second half: the day the rail's evidence disappears, this copy overstates the product and the gate says so.",
    requires: PAYMENTS_RAIL,
  },
  {
    file: '../AGENTS.md',
    contains: 'No bookings — planning plus paid itinerary unlocks',
    why: 'The project description states the same scope as the footer (the #392 sibling sweep swept both) — same two halves, same requires-marker.',
    requires: PAYMENTS_RAIL,
  },
]

// ---- The scan --------------------------------------------------------------

interface Hit { file: string; line: number; text: string; cue: string }

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const file of [...LIVE, ...SOURCE_COPY]) {
    read(file).split(/\r?\n/).forEach((text, i) => {
      const low = text.toLowerCase()
      const cue = CUES.find(c => low.includes(c))
      if (cue) hits.push({ file, line: i + 1, text, cue })
    })
  }
  return hits
}

const hits = scan()

/** Every file a marker watches: a plain path, or `dir/*.ext` expanded. */
function markerPaths(marker: Marker): string[] {
  const out: string[] = []
  for (const path of marker.paths) {
    if (!path.includes('*')) { out.push(path); continue }
    const [dir, suffix] = path.split('*')
    for (const name of readdirSync(new URL(`${dir}/`, import.meta.url))) {
      if (name.endsWith(suffix!)) out.push(`${dir}/${name}`)
    }
  }
  return out
}

/** The marker's evidence, if the repo now holds it. */
function contradiction(marker: Marker): string | null {
  for (const path of markerPaths(marker)) {
    const url = new URL(path, import.meta.url)
    if (!existsSync(url)) continue
    if (marker.contains.test(readFileSync(url, 'utf8'))) return path
  }
  return null
}

describe('doc drift — a live doc cannot claim something the repo already has', () => {
  it('scans real files (a scan of nothing would pass silently)', () => {
    expect(LIVE.length).toBeGreaterThan(4)
    expect(SOURCE_COPY.length).toBeGreaterThan(0)
    for (const file of [...LIVE, ...SOURCE_COPY]) expect(existsSync(new URL(file, import.meta.url)), `${file} is missing`).toBe(true)
    // And the cues actually fire somewhere, or this checker is inert.
    expect(hits.length).toBeGreaterThan(0)
  })

  it('accounts for every absence claim in live docs and source copy', () => {
    const unregistered = hits.filter(
      h => !CLAIMS.some(c => c.file === h.file && h.text.includes(c.contains)),
    )
    // A hit here is either a doc to fix or a claim to register WITH A REASON.
    // Do not add a cue to silence it, and do not register it without saying why
    // it is still true.
    expect(unregistered.map(h => `${h.file}:${h.line} [${h.cue}] ${h.text.trim().slice(0, 120)}`)).toEqual([])
  })

  it('never registers a sentence that has been rewritten away', () => {
    // Otherwise the registry becomes a list of quotes nobody reads, and the
    // next session cannot tell a live restriction from an archaeology entry.
    const stale = CLAIMS.filter(
      c => !hits.some(h => h.file === c.file && h.text.includes(c.contains)),
    )
    expect(stale.map(c => `${c.file} :: ${c.contains} — reword it in the doc, or fix this entry`)).toEqual([])
  })

  it('fails when a registered claim is contradicted by the code', () => {
    // The half that catches drift on its own: these claims name evidence that
    // would make them false, and the build goes red the moment it appears —
    // or, for a `requires` claim, the moment it disappears.
    const broken = CLAIMS
      .flatMap(c => [
        ...(c.marker ? [{ c, at: contradiction(c.marker), gone: false }] : []),
        ...(c.requires ? [{ c, at: contradiction(c.requires), gone: true }] : []),
      ])
      .filter(({ at, gone }) => (gone ? at === null : at !== null))
      .map(({ c, at, gone }) => (gone
        ? `${c.file} says "${c.contains}" but ${c.requires!.what} is no longer in the repo — the sentence overstates the product`
        : `${c.file} says "${c.contains}" but ${c.marker!.what} now exists (${at})`))
    expect(broken).toEqual([])
  })

  it('makes every marker watch something real (a glob that expands to nothing cannot fire)', () => {
    for (const claim of CLAIMS) {
      for (const marker of [claim.marker, claim.requires].filter((m): m is Marker => m !== undefined)) {
        const paths = markerPaths(marker)
        expect(paths.length, `${marker.what} expands to no files`).toBeGreaterThan(0)
        // A PLAIN path is allowed to be absent: that absence is exactly what the
        // doc claims, and the marker fires the day the file appears. A GLOB is
        // not — one matching nothing would never fire, so it would guard a claim
        // while watching nothing at all.
        if (marker.paths.some(p => p.includes('*'))) {
          expect(
            paths.some(p => existsSync(new URL(p, import.meta.url))),
            `${marker.what} watches a glob that matches only missing paths`,
          ).toBe(true)
        }
      }
    }
  })

  it('the marker machinery actually fires (proved in both directions)', () => {
    // No real claim is contradicted today, so a green run above is weak
    // evidence on its own. This proves the mechanism against live files: the
    // first case MUST return a path and the second MUST return null. If the
    // first ever stops returning one, a real marker has gone quiet rather than
    // the repo having stayed honest.
    expect(contradiction({ what: 'synthetic', paths: ['../supabase/schema.sql'], contains: /create or replace function public\.is_admin/ }))
      .toBe('../supabase/schema.sql')
    expect(contradiction({ what: 'synthetic', paths: ['../supabase/schema.sql'], contains: /create table[^;]{0,80}\bpayouts\b/i }))
      .toBeNull()
  })

  it('the payments requirement is armed (a sentence naming paid unlocks cannot outlive the rail)', () => {
    // `requires` polarity in the real world: evidence FOUND means the
    // registered footer/AGENTS sentences stand. The day this returns null,
    // the rail changed shape and the copy naming it must be rewritten in the
    // same commit — that is the next monetization change failing here instead
    // of drifting the copy (#392).
    expect(
      contradiction(PAYMENTS_RAIL),
      'PAYMENTS_RAIL finds no evidence — rewrite the footer/AGENTS sentences that name paid itinerary unlocks (and this marker) in the same commit',
    ).not.toBeNull()
  })

  it('grants a snapshot exemption only to a file that still carries its date', () => {
    for (const file of SNAPSHOTS) {
      expect(existsSync(new URL(file, import.meta.url)), `${file} is missing`).toBe(true)
      const name = file.split('/').pop()!
      const head = read(file).split(/\r?\n/).slice(0, 6).join('\n')
      expect(
        /20\d\d-\d\d-\d\d/.test(name) || /20\d\d-\d\d-\d\d/.test(head),
        `${file} is exempt as a dated snapshot but carries no date in its name or its first lines`,
      ).toBe(true)
    }
  })

  it('keeps the archive out of the scan on purpose', () => {
    for (const file of LIVE) expect(file).not.toContain('docs/history/')
    for (const file of SNAPSHOTS) expect(file).not.toContain('docs/history/')
  })
})

// ---- The sibling sweep (#392): source copy may not deny what the product does ----

/** The denial phrasings — a product-scope claim that something money-shaped
 *  does not exist. "Free to plan, no card needed" is deliberately NOT one:
 *  that stays true and is verified-still-true copy. */
const DENIALS = /\bno\s+payments?\b|\bno\s+checkout\b|never\s+charges|\bplanning\s+only\b/i

/** Every .ts/.tsx under `src/`, walked the boring way (paths relative to this
 *  file, so `read` and the failure messages agree). */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...sourceFiles(`${dir}${e.name}/`))
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(`${dir}${e.name}`)
  }
  return out
}

describe('live source copy does not deny the shipped money rail', () => {
  it('the denial phrasings match real denials, and not the verified-still-true neighbours', () => {
    // Teeth for the sweep itself: a regex that matches nothing would pass
    // silently forever, and one that is too wide would force rewording copy
    // the product still earns.
    expect(DENIALS.test('All costs are transparent estimates. No bookings, no payments, planning only.')).toBe(true)
    expect(DENIALS.test('Free to plan, no card needed')).toBe(false)
  })

  it('has no denial phrasing anywhere in src/ (the reversal-sweeps-its-own-strings rule)', async () => {
    // The footer's "no payments" was the only hit when #392 was filed, and it
    // survived weeks past the v0.61.0 rail. Docs are policed by the
    // cue+registry machinery above instead, because a doc may QUOTE a stale
    // phrase with a reason — the AGENTS learning entries do exactly that.
    // The reads run in parallel on purpose: this box charges ~12ms per sync
    // read (AV), which alone timed the walk out under full-suite load.
    const files = sourceFiles('../src/')
    const texts = await Promise.all(files.map(f => readFile(new URL(f, import.meta.url), 'utf8')))
    const found: string[] = []
    files.forEach((file, i) => {
      texts[i]!.split(/\r?\n/).forEach((text, j) => {
        if (DENIALS.test(text)) found.push(`${file}:${j + 1} ${text.trim().slice(0, 100)}`)
      })
    })
    expect(found).toEqual([])
  })
})
