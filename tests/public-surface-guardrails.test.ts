// ============ The public surface's promises are pinned (2026-09-17) ============
// Two failures were invisible to tsc, the tests and the build, because nothing
// renders these components in CI:
//   • the page offered "Unlock Premium · ₹199" in two places while no payment
//     rail exists — the click could only toast a notice that payments are off;
//   • a rename left the trip-highlights block on `.pub-highlightsN` while the
//     stylesheet defines `.pub-highlights`, so the section silently lost its
//     spacing (the same shape as a class going dead in any rename).
// Both are one edit away from returning, so pin both here — source invariants,
// the same pattern tests/trip-road.test.ts uses for the road measurement.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('the public itinerary page sells what it can deliver', () => {
  it('offers the real unlock now that the payment rail exists', () => {
    const page = read('../src/pages/PublicItinerary.tsx')
    // The rail landed (M7): the price is an action wired to the checkout, not a
    // label beside a notice that payments are switched off.
    expect(page).not.toMatch(/Unlock Premium/)
    expect(page).not.toMatch(/no payments in this MVP/)
    expect(page).not.toMatch(/paid unlock is not live/)
    expect(page).toMatch(/Unlock full plan · \{formatInr\(price\)\}/)
    expect(page).toMatch(/onClick=\{unlockThis\}/)
  })

  it('keeps every section class it styles itself with in the stylesheet', () => {
    const page = read('../src/pages/PublicItinerary.tsx')
    const css = read('../src/styles.css')
    const used = [...page.matchAll(/className="(pub-[a-z-]+)"/g)].map(m => m[1]).sort()
    expect(used.length).toBeGreaterThan(5)
    expect(used.filter(c => !css.includes(`.${c}`))).toEqual([])
  })
})

describe('the gallery explains its own vocabulary', () => {
  it('says what Fork means before the first card that offers it', () => {
    const explore = read('../src/pages/Explore.tsx')
    const gloss = explore.indexOf('Fork any itinerary to copy it into your own trips')
    expect(gloss).toBeGreaterThan(-1)
    expect(gloss).toBeLessThan(explore.indexOf('<PubCard'))
  })

  it('does not show the featured plan a second time as a grid card', () => {
    const explore = read('../src/pages/Explore.tsx')
    // The featured pick is derived from the unfiltered set, so without this the
    // most-forked plan rendered twice on a three-item shelf.
    expect(explore).toMatch(/pubs\.filter\(p => p\.id !== featured\.id\)/)
    // The grid, its paging and its "Load more" count all read the deduped list…
    expect(explore).not.toMatch(/pubs\.slice\(0, visibleCount\)/)
    expect(explore).toMatch(/gridPubs\.slice\(0, visibleCount\)/)
    expect(explore).toMatch(/gridPubs\.length > visibleCount/)
    // …while the empty state stays keyed on the full match list: a lone match
    // that IS the featured card must not read as "nothing matches". The ternary
    // now reads `pubs.length === 0` after a read-state guard (#364 — a failed
    // catalog read must not print "just getting started"), so the assertion
    // pins the CONDITION rather than the exact opening of the expression.
    expect(explore).toMatch(/pubs\.length === 0 \?/)
  })

  it('claims "outside your filters" only when the featured pick really is', () => {
    const explore = read('../src/pages/Explore.tsx')
    // It used to key off `filtersActive` alone, so a filtered page labelled the
    // matching card itself as being outside the filters.
    expect(explore).toMatch(/const featuredOutsideFilters = !!featured && !pubs\.some\(p => p\.id === featured\.id\)/)
    expect(explore).toMatch(/Featured itinerary\{featuredOutsideFilters &&/)
  })
})

describe('the catalog is honest about the login wall behind Fork', () => {
  it('labels the shared card button for what it does when nobody is signed in', () => {
    const card = read('../src/components/PubCard.tsx')
    expect(card).toMatch(/needsLogin \? 'Log in to fork' : 'Fork this trip'/)
    // Every surface that renders the card has to opt in, or a signed-out click
    // goes back to being a silent redirect.
    expect(read('../src/pages/Explore.tsx')).toMatch(/needsLogin=\{!me\}/)
    expect(read('../src/pages/CreatorPage.tsx')).toMatch(/needsLogin=\{!me\}/)
  })

  it('says the account requirement before the click, on every fork button', () => {
    // Explore explains it once, above the cards.
    expect(read('../src/pages/Explore.tsx')).toMatch(/You’ll need a free account to fork trips/)
    const page = read('../src/pages/PublicItinerary.tsx')
    const forkButtons = [...page.matchAll(/className="btn fork-btn/g)].length
    const labelled = [...page.matchAll(/\{me \? 'Fork this trip' : 'Log in to fork'\}/g)].length
    expect(forkButtons).toBe(2)
    expect(labelled).toBe(forkButtons)
  })
})

describe('the invite and snapshot gates name no cause they cannot know', () => {
  it('does not declare the link broken when the fetch merely failed', () => {
    const app = read('../src/App.tsx')
    // Both resolvers log the error and return null, so a failed lookup and a
    // dead code are indistinguishable to the caller.
    expect(app).not.toMatch(/This invite link is broken/)
    expect(app).not.toMatch(/This snapshot link is broken/)
    expect(app).toMatch(/This invite didn’t load/)
    expect(app).toMatch(/This snapshot didn’t load/)
    // joinViaInvite reports false for an RLS refusal or a dropped connection
    // just as readily as for a stale code.
    expect(app).not.toMatch(/the link may be old/)
  })

  it('offers a retry, because a dropped connection is one of the real causes', () => {
    const app = read('../src/App.tsx')
    // The resolve effect has to actually re-run when the button bumps the tick…
    expect(app).toMatch(/\}, \[codeOrTripId, retryTick\]\)/)
    // …and the button must drop back to the spinner rather than sit on the failure.
    expect(app).toMatch(/setStatus\('loading'\); setRetryTick\(t => t \+ 1\)/)
  })
})

describe('the public page names no cause it cannot know', () => {
  it('describes a failed load without picking one explanation', () => {
    const page = read('../src/pages/PublicItinerary.tsx')
    // fetchSharedTrip resolves null for a deleted row AND for a failed select,
    // so "unpublished" was a guess dressed as a diagnosis.
    expect(page).not.toMatch(/may have been unpublished/)
    expect(page).toMatch(/we can’t tell which from here/)
  })
})

// ============ Card-grid geometry and one-recipe type (2026-09-17) ============
// Three layout defects on the two public surfaces, each invisible to tsc, the
// tests and the build because nothing renders them in CI:
//   • `.card + .card { margin-top: 14px }` also matched GRID items, so every card
//     after the first rendered 14px lower and 14px shorter than its row-mate
//     (measured live: tops 839/853, heights 477/463, and a 26px gap where the
//     grid declared 12);
//   • the public itinerary's Travel-tips / Warnings row was a `.two-col` nested
//     inside the 782px content column, so its two peer cards came out 424/340
//     instead of equal halves;
//   • `.trip-enter`'s `cardIn` ran with `fill-mode: both`, which pinned
//     `transform: none` over `.itin-card:hover`'s lift forever — the shelf's
//     hover answered with a shadow change and no movement.
describe('grid cards are laid out by the grid, not by the stacked-card beat', () => {
  const css = read('../src/styles.css')

  it('zeroes the stacked-card margin inside every grid container that holds cards', () => {
    // The list is an inventory, not a sample: a DOM sweep of every reachable
    // route found exactly these three grids holding `.card` children (Explore,
    // CreatorPage and TripsList share the first), and the landing feature strip
    // was the one the first pass missed.
    const override = css.match(/\.explore-grid > \.card \+ \.card,[\s\S]*?margin-top: 0;/)?.[0] ?? ''
    expect(override).toMatch(/\.explore-grid > \.card \+ \.card/)
    expect(override).toMatch(/\.two-col > \.card \+ \.card/)
    expect(override).toMatch(/\.feature-strip > \.card \+ \.card/)
  })

  it('gives two peer cards equal halves instead of a phantom sidebar', () => {
    expect(css).toMatch(/\.two-col--even \{ grid-template-columns: 1fr 1fr; \}/)
    expect(read('../src/pages/PublicItinerary.tsx')).toMatch(/className="two-col two-col--even"/)
    // …and the pair still collapses with every other two-col on a narrow screen.
    expect(css).toMatch(/@media \(max-width: 980px\) \{ \.two-col, \.two-col--even \{/)
  })

  it('lets the entrance animation release the transform so hover can lift', () => {
    const enter = css.match(/\.trip-enter \{ animation: cardIn[^}]*\}/)?.[0] ?? ''
    expect(enter).toMatch(/backwards/)
    expect(enter).not.toMatch(/\bboth\b/)
  })
})

describe('the published hero keeps its evidence card inside itself', () => {
  const css = read('../src/styles.css')

  it('never hangs the floating card into an overflow:hidden clip', () => {
    const hero = css.match(/\.pub-hero \{[\s\S]*?\}/)?.[0] ?? ''
    const stats = css.match(/\.pub-hero-stats \{[\s\S]*?\}/)?.[0] ?? ''
    // The hero clips its children, so a negative `bottom` is silently deleted —
    // which is how "28h 09m on the road" and "10 days" stopped being painted.
    expect(hero).toMatch(/overflow: hidden/)
    const bottom = Number(stats.match(/bottom: (-?\d+)px/)?.[1])
    expect(Number.isFinite(bottom)).toBe(true)
    expect(bottom).toBeGreaterThanOrEqual(0)
  })

  it('keeps the hero text off the card column at mid widths', () => {
    // Each cap must NARROW its element's own measure, never replace it: a bare
    // `min(100%, …)` handed the title 816px at a 1200px viewport.
    expect(css).toMatch(/@media \(max-width: 1279px\) \{[\s\S]*?\.pub-hero-title \{ max-width: min\(720px, calc\(100% - 324px\)\); \}/)
    expect(css).toMatch(/@media \(max-width: 1279px\) \{[\s\S]*?\.pub-hero-story \{ max-width: min\(640px, calc\(100% - 324px\)\); \}/)
    expect(css).toMatch(/@media \(max-width: 1279px\) \{[\s\S]*?\.pub-hero-byline \{ max-width: calc\(100% - 324px\); \}/)
  })
})

describe('one kicker recipe, and no capitals typed in components', () => {
  const css = read('../src/styles.css')

  /**
   * The declaration block of a rule whose selector starts its own line. The
   * anchor is load-bearing: the recipe's selector list ends `.poi-grp-k,
   * .poi-reason-k {`, so an unanchored scan reads the recipe's own declarations
   * back as this class's. Scanned rather than built into a `RegExp(` from the
   * class name — a class name is not a pattern, and escaping one fails as "no
   * such rule" rather than as a bad pattern.
   */
  function ruleOnOwnLine(selector: string): string {
    const at = css.indexOf(`\n${selector} {`)
    if (at === -1) return ''
    const start = at + 1
    const end = css.indexOf('}', start)
    return end === -1 ? '' : css.slice(start, end + 1)
  }

  it('routes both hero micro-labels through the single recipe', () => {
    const recipe = css.match(/Kicker unification: one recipe[\s\S]*?text-transform: uppercase;/)?.[0] ?? ''
    expect(recipe).toMatch(/\.pub-hero-badge/)
    expect(recipe).toMatch(/\.pub-hero-byline/)
  })

  it('does not shout in JSX what CSS already uppercases', () => {
    // DESIGN_TOKENS: "Never type capitals in components." The day-highlight
    // kicker uppercases its kind while the tag chip beside it prints the same
    // label — the transform is the kicker block's job, not the call site's.
    const page = read('../src/pages/PublicItinerary.tsx')
    expect(page).not.toMatch(/toUpperCase\(\)/)
  })

  it('leaves the map rail\'s label classes on the kicker recipe, not on their own', () => {
    // DESIGN_TOKENS documents ONE micro-label recipe (10.5 / 700 / .06em /
    // uppercase). The rail's two label classes carried their own declarations
    // and one of them had lost the weight — so they now only set colour, and
    // join the shared list. Pills (`.poi-best`, `.poi-rchip`) and the facts
    // line (`.poi-facts`) are a different role and stay as they are.
    // Matched through to the recipe's own declarations — the first `{` after
    // the comment belongs to the enclosing `@media screen`, not the rule.
    const recipe = css.match(/Kicker unification:[\s\S]*?text-transform: uppercase;/)?.[0] ?? ''
    expect(recipe).toMatch(/\.poi-grp-k, \.poi-reason-k/)
    for (const sel of ['.poi-grp-k', '.poi-reason-k']) {
      const rule = ruleOnOwnLine(sel)
      expect(rule, `${sel} must exist`).not.toBe('')
      const declared = rule
        .slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'))
        .split(';')
        .map(d => d.split(':')[0].trim())
      for (const prop of ['font-size', 'font-weight', 'letter-spacing', 'text-transform']) {
        expect(declared, `${sel} must take ${prop} from the recipe`).not.toContain(prop)
      }
    }
  })
})
