// ============ Publication funnel: views → forks → unlocks (I-22 / I-15) ======
//
// Two halves, because the funnel has two halves of its own:
//
//   * the DERIVATION, which is pure and so runs for real here — windows,
//     boundary days, zero denominators, and the case where forks outnumber
//     visits (possible for a real reason, so it must not be clamped away);
//
//   * the RECORDING, which only exists as SQL. There is no live database in
//     this suite, so what is pinned is the contract the code depends on: one
//     write path for the counter and the log, a gate no client can write
//     around, and a reader scoped to the caller. The live behaviour of those
//     policies is `supabase/tests/rls_contract.test.sql`'s job.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildPubFunnels, conversionPct, describePreLog, formatPct, funnelBarPos, funnelBarScale, funnelGlance, funnelWindowStart, utcDayKey, utcDayStart,
  FUNNEL_WINDOWS, type FunnelDailyRow, type FunnelPub, type FunnelSale,
} from '../src/lib/pubFunnel'
// The fixture's traffic plan. A PURE module rather than the CLI script itself:
// `scripts/seedCreatorFixture.mjs` runs its whole seed on import, so a test
// cannot import it to check its numbers.
import { funnelTotals, planFunnelEvents, PLAN_WINDOWS, windowTotals } from '../scripts/fixtureFunnelPlan.mjs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

/** Code only — comments removed. Every file here explains itself at length, so
 *  an assertion about what a file DOES must not be satisfied by a sentence
 *  describing it (the trap `tests/purchase-share-card.test.ts` documents). */
function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*(\/\/|--)/.test(line))
    .join('\n')
}

/** One SQL function's own text, from its declaration through its terminating
 *  semicolon — INCLUDING the security/language modifiers after the body.
 *
 *  Sliced by the `$$ … $$` body delimiters rather than by a closing clause,
 *  because the two functions here close differently (`language plpgsql security
 *  definer …` vs `language sql security definer … stable as $$…`), and an
 *  assertion about how a function is declared must not be able to miss the
 *  clause that declares it. */
function sqlFunction(src: string, name: string): string {
  const marker = `create or replace function public.${name}`
  const start = src.indexOf(marker)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  const open = src.indexOf('$$', start)
  expect(open, `${name} has no body`).toBeGreaterThan(-1)
  const close = src.indexOf('$$', open + 2)
  expect(close, `${name} body is unterminated`).toBeGreaterThan(-1)
  const end = src.indexOf(';', close + 2)
  expect(end, `${name} has no terminator`).toBeGreaterThan(-1)
  return src.slice(start, end + 1).replace(/\r\n/g, '\n').trim()
}

const DAY = 86400000
/** 2026-09-21 12:00 UTC — midday, so a UTC-day boundary is unambiguous. */
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0)
const dayKey = (daysAgo: number) => utcDayKey(NOW - daysAgo * DAY)

const pub = (over: Partial<FunnelPub> = {}): FunnelPub => ({
  id: 'pub_1', title: 'Kerala Hills', priceInr: 199, lifetimeViews: 0, lifetimeForks: 0, ...over,
})
const row = (pubId: string, daysAgo: number, views: number, forks: number): FunnelDailyRow =>
  ({ pubId, day: dayKey(daysAgo), views, forks })
const sale = (pubId: string, daysAgo: number): FunnelSale =>
  ({ pubId, grantedAt: NOW - daysAgo * DAY })

const build = (over: Partial<Parameters<typeof buildPubFunnels>[0]> = {}) => buildPubFunnels({
  daily: [], sales: [], pubs: [pub()], days: 30, now: NOW, ...over,
})

describe('the window is counted in whole UTC days', () => {
  it('buckets a day by UTC, so the client window and the SQL buckets agree', () => {
    // The SQL groups by `(at at time zone 'utc')::date`. A local-midnight
    // window would put today's traffic in or out of the window depending on the
    // reader's timezone — the same bucket, two answers.
    expect(utcDayKey(NOW)).toBe('2026-09-21')
    expect(utcDayStart(NOW)).toBe(Date.UTC(2026, 8, 21))
    // 23:59 UTC is still the SAME day, in every timezone the test runs in.
    expect(utcDayStart(Date.UTC(2026, 8, 21, 23, 59, 59))).toBe(Date.UTC(2026, 8, 21))
  })

  it('a 7-day window is seven whole days INCLUDING today', () => {
    expect(funnelWindowStart(7, NOW)).toBe(Date.UTC(2026, 8, 21) - 6 * DAY)
  })

  it('includes a row on the window\'s first day and excludes the day before', () => {
    const days = build({
      days: 7,
      daily: [row('pub_1', 6, 5, 1), row('pub_1', 7, 3, 9)],
      pubs: [pub()],
    })
    expect(days[0].views).toBe(5)
    expect(days[0].forks).toBe(1)
    // The excluded day is still the log's history — the reason the row exists.
    expect(days[0].recordingSinceDay).toBe(dayKey(7))
  })

  it('offsers a 1-day window that is today only', () => {
    const days = build({ days: 1, daily: [row('pub_1', 0, 4, 0), row('pub_1', 1, 9, 0)] })
    expect(days[0].views).toBe(4)
  })
})

describe('the stages and their conversions', () => {
  it('reads each rate off the stage before it', () => {
    const [f] = build({
      daily: [row('pub_1', 0, 100, 20)],
      sales: [sale('pub_1', 0), sale('pub_1', 1), sale('pub_1', 2), sale('pub_1', 3), sale('pub_1', 4)],
    })
    expect(f.views).toBe(100)
    expect(f.forks).toBe(20)
    expect(f.unlocks).toBe(5)
    expect(f.forkRatePct).toBe(20)
    expect(f.unlockRatePct).toBe(25)
    expect(f.viewToUnlockPct).toBe(5)
  })

  it('a zero denominator is 0, never NaN or Infinity', () => {
    const [f] = build({ daily: [row('pub_1', 0, 0, 0)] })
    // No traffic at all in the window: three zeroes, and three honest 0%s.
    expect(f.views).toBe(0)
    expect(f.unlocks).toBe(0)
    for (const rate of [f.forkRatePct, f.unlockRatePct, f.viewToUnlockPct]) {
      expect(Number.isFinite(rate)).toBe(true)
      expect(rate).toBe(0)
    }
    // Directly, including the defensive branches.
    expect(conversionPct(0, 5)).toBe(0)
    expect(conversionPct(-3, 5)).toBe(0)
    expect(formatPct(0)).toBe('0%')
  })

  it('does NOT clamp a fork rate above 100% — because a fork needs no visit', () => {
    // Explore's card carries its own Fork CTA, and a visit is counted once per
    // browser session on the plan's own page — so forks can outnumber visits,
    // and clamping that to 100 would hide a real product fact.
    const [f] = build({ daily: [row('pub_1', 0, 10, 14)] })
    expect(f.forks).toBe(14)
    expect(f.forkRatePct).toBe(140)
    expect(f.forksExceedViews).toBe(true)
  })

  it('flags an ordinary funnel as NOT exceeding', () => {
    const [f] = build({ daily: [row('pub_1', 0, 100, 40)] })
    expect(f.forksExceedViews).toBe(false)
  })
})

// ---- #358: the bar must not contradict the number beside it ----------------
// The rate above 100% is deliberate and pinned. The BAR, however, was clamped at
// `min(100, …)`, so a 140% row drew a full-width bar indistinguishable from a
// 100% one and pushed the unlock mark to `calc(100% + 3px)` — off its own track.
// These pin the fix on the scale rather than on the markup, because the markup
// is where the cap used to hide.
describe('the funnel bar is drawn on a scale that fits the number (#358)', () => {
  it('leaves an ordinary funnel on the same 0-100 track it always had', () => {
    expect(funnelBarScale({ forkRatePct: 40, unlockRatePct: 25 })).toBe(100)
    expect(funnelBarPos(40, 100)).toBe('40.00%')
    expect(funnelBarPos(25, 100)).toBe('25.00%')
  })

  it('scales the TRACK, never the rate, when forks exceed visits', () => {
    // 10 views / 14 forks = 140%, and a 20% unlock rate (2 unlocks / 10 forks).
    // The scale becomes 140 — the largest rate on the row — so the fork mark
    // lands at 100% (it IS the maximum) and the unlock mark stays proportionately
    // below it. Both on-track, and the inversion still visible.
    const scale = funnelBarScale({ forkRatePct: 140, unlockRatePct: 20 })
    expect(scale).toBe(140)
    expect(funnelBarPos(140, scale)).toBe('100.00%')
    expect(funnelBarPos(20, scale)).toBe('14.29%')
    // The decisive property: nothing lands beyond the track. The old bar put the
    // unlock mark at `calc(100% + 3px)` here.
    for (const rate of [140, 20]) {
      expect(parseFloat(funnelBarPos(rate, scale))).toBeLessThanOrEqual(100)
      expect(parseFloat(funnelBarPos(rate, scale))).toBeGreaterThanOrEqual(0)
    }
  })

  it('lets the UNLOCK rate set the scale too, when it is the larger', () => {
    // The scale is the row's maximum, not just the fork rate's — a 10% fork rate
    // with a 250% unlock-of-forks rate must not draw the second mark off-track.
    const scale = funnelBarScale({ forkRatePct: 10, unlockRatePct: 250 })
    expect(scale).toBe(250)
    expect(parseFloat(funnelBarPos(250, scale))).toBeLessThanOrEqual(100)
  })

  it('never lets an unread unlock stage raise the scale', () => {
    // While the sales ledger is unread the unlock rate is 0 BY SUBSTITUTION, not
    // a measurement — it must not stretch the track for a number nobody read.
    expect(funnelBarScale({ forkRatePct: 40, unlockRatePct: 0, hasUnlock: false })).toBe(100)
  })

  it('keeps a degenerate row on the track instead of dividing by zero', () => {
    expect(funnelBarScale({ forkRatePct: 0, unlockRatePct: 0 })).toBe(100)
    expect(funnelBarPos(0, 0)).toBe('0.00%')
    // A negative or non-finite rate cannot throw the mark off the far end.
    expect(funnelBarPos(-5, 100)).toBe('0.00%')
    expect(funnelBarPos(Number.NaN, 100)).toBe('0.00%')
  })

  it('the hub draws both marks through the shared helper, with no clamp of its own', () => {
    // The guard that matters: the page must not keep a private `Math.min(100, …)`
    // beside a shared helper. Either the bar uses the scale or it does not.
    const hub = codeOf(read('../src/pages/CreatorHubPage.tsx'))
    expect(hub).toContain('funnelBarScale({ forkRatePct: f.forkRatePct, unlockRatePct: f.unlockRatePct')
    expect(hub).toContain('funnelBarPos(f.forkRatePct, scale)')
    expect(hub).toContain('funnelBarPos(f.unlockRatePct, scale)')
    // And the old cap is gone from the bar entirely.
    expect(hub).not.toMatch(/Math\.min\(100, Math\.max\(0, f\.(fork|unlock)RatePct\)\)/)
  })

  it('the rate itself is still NOT clamped — the bar followed the number, not the reverse', () => {
    // The counter-instance. If a future change "fixes" this by capping the rate,
    // the product fact the module documents disappears — so the unclamped value
    // is asserted here, at the same altitude as the bar fix.
    expect(conversionPct(10, 14)).toBe(140)
    const [f] = build({ daily: [row('pub_1', 0, 10, 14)] })
    expect(f.forkRatePct).toBe(140)
    expect(f.forksExceedViews).toBe(true)
  })
})

// ---- #358: the two "recording began" dates are both true --------------------
// The page dates the log from the GLOBAL earliest day and each row from its own
// publication's earliest. Both were true and the two sat side by side, so the
// labels are QUALIFIED rather than reconciled — the dates are different
// questions, and the fix is to name which is which.
describe('the two recording dates name their scope (#358)', () => {
  const NOW = Date.UTC(2026, 8, 21, 12)
  const row = (day: string) => ({ pubId: 'p1', day, views: 1, forks: 0 })

  it('a row says which PLAN its date belongs to', () => {
    const f = buildPubFunnels({
      daily: [row(utcDayKey(NOW)), row(utcDayKey(NOW - 20 * DAY))],
      sales: [], days: 7, now: NOW,
      pubs: [{ id: 'p1', title: 'P', priceInr: 199, lifetimeViews: 9, lifetimeForks: 3 }],
    })[0]
    const line = describePreLog(f)!
    expect(line).toContain("this plan's recording began")
    // The DATE itself is untouched — the pinned per-pub value still renders
    // (21 Sep minus 20 days), and the day the row is windowed on never reaches
    // the reader.
    expect(line).toContain('1 Sept 2026')
    expect(line).not.toContain('21 Sept 2026')
  })

  it('the page says its date is the earliest of the whole account', () => {
    const hub = read('../src/pages/CreatorHubPage.tsx')
    expect(hub).toContain('the earliest of your plans')
    // …and it is still derived from the global minimum, unchanged.
    expect(hub).toMatch(/daily\.reduce\(\(min, r\) => \(r\.day < min \? r\.day : min\), daily\[0\]\.day\)/)
  })
})

describe('unlocks come from the dated ledger, windowed the same way', () => {
  it('counts the window and the lifetime separately', () => {
    const [f] = build({ days: 30, sales: [sale('pub_1', 0), sale('pub_1', 40)] })
    expect(f.unlocks).toBe(1)
    expect(f.lifetimeUnlocks).toBe(2)
  })

  it('includes a sale exactly on the window boundary', () => {
    const start = funnelWindowStart(30, NOW)
    const [f] = build({
      days: 30,
      sales: [{ pubId: 'pub_1', grantedAt: start }, { pubId: 'pub_1', grantedAt: start - 1 }],
    })
    expect(f.unlocks).toBe(1)
    expect(f.lifetimeUnlocks).toBe(2)
  })
})

describe('a publication with nothing to read says so instead of showing zeroes', () => {
  it('marks a publication the log has never reported as unreported', () => {
    const [f] = build({ pubs: [pub({ lifetimeViews: 1284, lifetimeForks: 96 })] })
    expect(f.unreported).toBe(true)
    expect(f.recordingSinceDay).toBeNull()
    // The lifetime counters still ride along — the pre-log history is real and
    // the row shows it beside the empty trend rather than hiding it.
    expect(f.lifetimeViews).toBe(1284)
  })

  it('does not mark a publication as unreported just because the WINDOW is empty', () => {
    // Traffic 200 days ago, a 30-day window: the trend exists, this window is
    // genuinely zero. Different truth from "never reported", so different flag.
    const [f] = build({ days: 30, daily: [row('pub_1', 200, 50, 3)] })
    expect(f.unreported).toBe(false)
    expect(f.views).toBe(0)
    expect(f.recordingSinceDay).toBe(dayKey(200))
  })
})

describe('the shape a dashboard needs', () => {
  it('returns one entry per publication, in the order given', () => {
    const funnels = build({
      pubs: [pub({ id: 'pub_a' }), pub({ id: 'pub_b' }), pub({ id: 'pub_c' })],
      daily: [row('pub_b', 0, 7, 2)],
    })
    expect(funnels.map(f => f.pubId)).toEqual(['pub_a', 'pub_b', 'pub_c'])
    expect(funnels[1].views).toBe(7)
    // A publication with no traffic is not dropped: its absence from a list of
    // a creator's own plans would read as a bug, not as an empty funnel.
    expect(funnels[0].views).toBe(0)
  })

  it('ignores a sale for a publication it was not given', () => {
    const funnels = build({ sales: [sale('pub_ghost', 0)] })
    expect(funnels).toHaveLength(1)
    expect(funnels[0].unlocks).toBe(0)
  })

  it('carries the publication\'s own identity and price through', () => {
    const [f] = build({ pubs: [pub({ id: 'pub_x', title: 'Spiti Loop', priceInr: 499 })] })
    expect(f.title).toBe('Spiti Loop')
    expect(f.priceInr).toBe(499)
  })
})

describe('the windows the hub offers are declared once', () => {
  it('lists the days and their labels together', () => {
    expect(FUNNEL_WINDOWS.map(w => w.days)).toEqual([7, 30, 90])
    for (const w of FUNNEL_WINDOWS) expect(w.label).toMatch(/\d+ days/)
  })
})

describe('formatPct shows a decimal only when it carries information', () => {
  it('rounds small rates to one decimal and large ones to a whole percent', () => {
    expect(formatPct(9.1666)).toBe('9.2%')
    expect(formatPct(0.44)).toBe('0.4%')
    expect(formatPct(12.34)).toBe('12%')
    expect(formatPct(100)).toBe('100%')
    expect(formatPct(140)).toBe('140%')
    expect(formatPct(0)).toBe('0%')
  })
})

// ============ The recording, as a contract ============

const migration = read('../supabase/migrations/20260921_pub_funnel_events.sql')
const migrationCode = codeOf(migration)
const hubCode = read('../src/pages/CreatorHubPage.tsx')
const publicCode = read('../src/pages/PublicItinerary.tsx')
const schema = read('../supabase/schema.sql')

describe('the log is written by the ONE function that moves the counter', () => {
  it('records the event in the same statement that bumps the counter', () => {
    const fn = sqlFunction(migration, 'bump_published_stats')
    expect(fn).toMatch(/update public\.published_itineraries set views = views \+ 1/)
    expect(fn).toMatch(/update public\.published_itineraries set copies = copies \+ 1/)
    expect(fn).toMatch(/insert into public\.pub_events \(pub_id, kind\) values \(p_id, v_kind\)/)
  })

  it('keeps the counter and the log consistent — no event without a counter bump', () => {
    // Without this guard an event could describe a step whose counter never
    // moved; with it, the anon-callable RPC also cannot stuff the log with
    // ids that do not exist.
    const fn = sqlFunction(migration, 'bump_published_stats')
    expect(fn).toMatch(/if not found then/)
    expect(fn.indexOf('if not found then')).toBeLessThan(fn.indexOf('insert into public.pub_events'))
  })

  it('keeps its anon callers working: same name, same parameters, same grants', () => {
    // Client bundles already call this. A rename or an added parameter would
    // silently stop counting views and forks for every shipped install.
    expect(migrationCode).toMatch(/function public\.bump_published_stats\(p_id text, p_kind text\)/)
    expect(migrationCode).toMatch(/grant execute on function public\.bump_published_stats\(text, text\) to anon, authenticated/)
    expect(migrationCode).toMatch(/p_kind = 'views'/)
    expect(migrationCode).toMatch(/p_kind = 'copies'/)
  })

  it('is byte-identical to the canonical schema.sql copy', () => {
    // Two definitions under one name is how the trip-touch trigger diverged
    // (AGENTS: whichever ran last won, silently). A fresh instance built from
    // schema.sql and a migrated one must define the same function.
    expect(sqlFunction(schema, 'bump_published_stats')).toBe(sqlFunction(migration, 'bump_published_stats'))
  })

  it('is a definer with a pinned search_path', () => {
    const fn = sqlFunction(migration, 'bump_published_stats')
    expect(fn).toMatch(/security definer/)
    expect(fn).toMatch(/set search_path = public/)
  })
})

describe('the log is a gate no client writes around', () => {
  it('constrains the kind and cascades with its publication', () => {
    expect(migrationCode).toMatch(/check \(kind in \('view', 'fork'\)\)/)
    expect(migrationCode).toMatch(/references public\.published_itineraries \(id\) on delete cascade/)
  })

  it('turns RLS on with no client write policy', () => {
    expect(migrationCode).toMatch(/alter table public\.pub_events enable row level security/)
    // A write policy would let a client fabricate funnel steps. Only the
    // definer function above may write.
    expect(migrationCode).not.toMatch(/create policy[^;]*on public\.pub_events\s+for (insert|update|delete|all)/i)
  })

  it('lets a creator read only their own publications\' events', () => {
    expect(migrationCode).toMatch(/create policy "pub_events read own publications" on public\.pub_events/)
    expect(migrationCode).toMatch(/p\.creator_id = auth\.uid\(\)/)
  })

  it('carries no identity — a step happened, never who took it', () => {
    expect(migrationCode).not.toMatch(/user_id/)
    expect(migrationCode).not.toMatch(/ip_address|user_agent/)
  })
})

describe('the reader is scoped to the caller and unreachable by anon', () => {
  it('filters by the caller\'s own publications inside the function', () => {
    const fn = sqlFunction(migration, 'get_creator_funnel')
    expect(fn).toMatch(/where p\.creator_id = auth\.uid\(\)/)
    expect(fn).toMatch(/security definer/)
  })

  it('is authenticated only — `revoke from public` does not revoke from anon', () => {
    expect(migrationCode).toMatch(/revoke all on function public\.get_creator_funnel\(integer\) from public, anon/)
    expect(migrationCode).toMatch(/grant execute on function public\.get_creator_funnel\(integer\) to authenticated/)
    expect(migrationCode).not.toMatch(/grant execute on function public\.get_creator_funnel\(integer\) to[^;]*anon/)
  })

  it('clamps the requested range instead of aggregating unbounded', () => {
    const fn = sqlFunction(migration, 'get_creator_funnel')
    expect(fn).toMatch(/least\(coalesce\(p_days, 180\), 730\)/)
  })

  it('is pinned by the live RLS contract test too', () => {
    const contract = read('../supabase/tests/rls_contract.test.sql')
    expect(contract).toContain('pub_events')
    expect(contract).toContain('get_creator_funnel')
    expect(contract).toMatch(/get_creator_funnel must never be granted to anon/)
  })
})

// ============ The wiring the gate cannot see ============

describe('the client writes through one path', () => {
  const store = codeOf(read('../src/store/store.ts'))

  it('excludes the creator\'s own fork, exactly as the view counter does', () => {
    // Both stages have to agree about who a reader is; the fork stage used to
    // count the creator testing their own plan while the view stage refused it.
    const viewFn = store.slice(store.indexOf('export function registerPubView'), store.indexOf('export function registerPubCopy'))
    const copyFn = store.slice(store.indexOf('export function registerPubCopy'), store.indexOf('export function registerPubCopy') + 1200)
    expect(viewFn).toMatch(/p\.creatorId === cache\.sessionUserId\) return/)
    expect(copyFn).toMatch(/p\.creatorId === cache\.sessionUserId\) return/)
  })

  it('sends both stages through the same RPC, so the counters and the log cannot drift', () => {
    const rpcCalls = store.match(/bump_published_stats/g) ?? []
    expect(rpcCalls).toHaveLength(2)
    expect(store).toMatch(/supabase\.rpc\('bump_published_stats', \{ p_id: id, p_kind: 'views' \}\)/)
    expect(store).toMatch(/supabase\.rpc\('bump_published_stats', \{ p_id: id, p_kind: 'copies' \}\)/)
  })
})

describe('the hub reads the funnel it says it does', () => {
  const hub = read('../src/pages/CreatorHubPage.tsx')

  it('derives every row through the one pure builder', () => {
    expect(hub).toMatch(/import\s*\{[^}]*buildPubFunnels[^}]*\}\s*from\s*'\.\.\/lib\/pubFunnel'/)
    expect(hub).toMatch(/buildPubFunnels\(\{/)
  })

  it('offers the windows from the shared list, so a new window cannot be half-added', () => {
    expect(hub).toMatch(/import\s*\{[^}]*FUNNEL_WINDOWS[^}]*\}/)
    expect(hub).toMatch(/FUNNEL_WINDOWS\.map\(/)
  })

  it('rounds every rate through the shared formatter', () => {
    expect(hub).toMatch(/import\s*\{[^}]*formatPct[^}]*\}/)
    expect(hub).toContain('formatPct(f.forkRatePct)')
    expect(hub).toContain('formatPct(f.unlockRatePct)')
  })

  it('labels the tiles as all-time, so they are not read as the window', () => {
    // The counters predate the log. A lifetime total sitting above a window
    // control is the exact pair a reader compares and concludes wrongly from.
    expect(hub).toContain('Views (all time)')
    expect(hub).toContain('Forks (all time)')
  })

  it('separates "nothing recorded" from "the log could not be read"', () => {
    expect(hub).toContain('No recorded traffic yet')
    expect(hub).toContain('funnelError')
    expect(hub).toContain('onRetry')
  })

  it('never claims an empty trend when the read itself failed', () => {
    // The bug this pins: with nothing to derive from, every row rendered "No
    // recorded traffic yet" — a claim about traffic made from a read that never
    // happened. Two things keep that true, and the second is now the stronger:
    // the chart voids only on `daily === null`, and the read's catch no longer
    // CLEARS `daily`, so a failed refresh cannot take a loaded chart down with it.
    // The row speaks the same three truths the panel does — figures, in flight,
    // nothing to read — derived by the same function the ledger uses. Gating on the
    // error flag made the rows withhold a log they already had; gating on a boolean
    // made them announce "nothing to measure for this plan" under a panel saying
    // "Reading…", a claim about traffic made before the read that reports it.
    expect(hub).toMatch(/funnelRead=\{trafficRead\}/)
    expect(hub).toMatch(/deriveLedgerRead\(\{ hasFigures: daily !== null, reading: funnelReading, error: funnelError \}\)/)
    expect(hub).toMatch(/if \(funnelRead === 'reading'\)/)
    expect(hub).toContain('Traffic still being read…')
    expect(hub).toContain('Traffic could not be read just now')
    // The chain now opens with the IN-FLIGHT case, ahead of the failure sentence —
    // the reverse of what it was, because every attempt is bounded and retryable:
    // a read that failed and is being asked again is truthfully "reading", and a
    // retry that renders the sentence it was pressed against is a dead button.
    const reading = hub.indexOf("'Reading recorded traffic…'")
    const failed = hub.indexOf("'Recorded traffic could not be read just now")
    expect(reading).toBeGreaterThan(-1)
    expect(failed).toBeGreaterThan(reading)
    // The kept-log sentence, which exists only because the log survives a failure.
    expect(hub).toMatch(/daily !== null && dailyAt !== null/)
    expect(hub).toContain('showing the log read at')
    // The guarantee in its strongest form: the catch sets the error flag and
    // nothing else.
    expect(hub).toMatch(/\.catch\(\(\) => \{ if \(alive\) setFunnelError\(true\) \}\)/)
  })

  it('explains a fork rate above 100% rather than clamping it', () => {
    expect(hub).toContain('f.forksExceedViews')
    expect(hub).toContain('more forks than visits')
  })
})

describe('a failed funnel read is an error, not an empty funnel', () => {
  it('rejects instead of degrading to an empty log', () => {
    const unlock = read('../src/lib/unlock.ts')
    const start = unlock.indexOf('export async function fetchCreatorFunnel')
    expect(start, 'fetchCreatorFunnel not found').toBeGreaterThan(-1)
    const fn = unlock.slice(start, start + 1400)
    expect(fn).toContain('throw error')
    expect(fn).not.toMatch(/catch[^}]*return \[\]/)
    expect(fn).toContain(".rpc('get_creator_funnel'")
  })
})

describe('the creator fixture\u2019s traffic plan', () => {
  // scripts/seedCreatorFixture.mjs seeds 100 days of backdated views and forks,
  // because the hub's Visits → Forks → Unlocks table needs a TREND and the app
  // only records traffic as it happens — a fixture without events would render a
  // funnel whose every window reads zero, which is the state it was in before.
  //
  // A node suite cannot render that table (no DOM, no session), so this is the
  // answer key for the browser check — and it is produced by the SHIPPED
  // derivation run over the fixture's own rows, not by restating what the numbers
  // "ought" to be. If the window rule moves, this fails here instead of the
  // fixture quietly describing a window the app no longer computes.
  const PUBS = [
    { slug: 'kerala', id: 'pub-fixture-kerala' },
    { slug: 'goa', id: 'pub-fixture-goa' },
    { slug: 'spiti', id: 'pub-fixture-spiti' },
  ]
  const eventsOf = (p: { slug: string; id: string }) => planFunnelEvents({ slug: p.slug, pubId: p.id, now: NOW })

  /** `get_creator_funnel`'s own output shape, from the fixture's raw events. The
   *  SQL buckets them per publication per UTC day in production, so the test
   *  reproduces exactly that and nothing more. */
  const daily: FunnelDailyRow[] = (() => {
    const byKey = new Map<string, FunnelDailyRow>()
    for (const p of PUBS) {
      for (const e of eventsOf(p)) {
        const day = utcDayKey(Date.parse(e.at))
        const key = `${e.pub_id}|${day}`
        const bucket = byKey.get(key) ?? { pubId: e.pub_id, day, views: 0, forks: 0 }
        if (e.kind === 'view') bucket.views += 1
        else bucket.forks += 1
        byKey.set(key, bucket)
      }
    }
    return [...byKey.values()]
  })()

  /** The sales plan the fixture writes, reduced to what a funnel counts. */
  const sales: FunnelSale[] = [
    sale('pub-fixture-kerala', 30), sale('pub-fixture-kerala', 21),
    sale('pub-fixture-goa', 9), sale('pub-fixture-goa', 3),
    sale('pub-fixture-kerala', 0),
    sale('pub-fixture-spiti', 12), sale('pub-fixture-spiti', 5),
  ]

  const pubsForFunnel: FunnelPub[] = PUBS.map(p => {
    const totals = funnelTotals(eventsOf(p))
    return {
      id: p.id, title: p.slug, priceInr: 199,
      lifetimeViews: totals.views, lifetimeForks: totals.forks,
    }
  })

  const funnels = (days: number) => buildPubFunnels({ daily, sales, pubs: pubsForFunnel, days, now: NOW })
  const of = (days: number, slug: string) => {
    const found = funnels(days).find(f => f.pubId === `pub-fixture-${slug}`)
    if (!found) throw new Error(`no funnel for ${slug}`)
    return found
  }

  it('writes a trend, so the 7 / 30 / 90-day pills show different numbers', () => {
    // A flat plan makes every window identical, which reads like a broken window
    // control and proves nothing about it.
    const seven = of(7, 'kerala').views
    const thirty = of(30, 'kerala').views
    const ninety = of(90, 'kerala').views
    expect(seven).toBeGreaterThan(0)
    expect(thirty).toBeGreaterThan(seven)
    expect(ninety).toBeGreaterThan(thirty)
  })

  it('agrees with the fixture\u2019s own printed windows \u2014 the key is the shipped rule', () => {
    // The fixture prints these windows before it writes anything, through its own
    // `windowTotals` helper. This is the cross-check that the number a browser
    // check compares against is the number the app computes.
    for (const p of PUBS) {
      const rows = eventsOf(p)
      for (const days of PLAN_WINDOWS) {
        const printed = windowTotals(rows, days, NOW)
        const derived = of(days, p.slug)
        expect([days, p.slug, derived.views, derived.forks])
          .toEqual([days, p.slug, printed.views, printed.forks])
      }
    }
  })

  it('counts the lifetime totals from the log the fixture seeds', () => {
    // The hub shows these beside the windowed numbers, and the fixture seeds the
    // publication ROW's counters to the same totals so the two agree on screen.
    // In production they legitimately disagree — the counters predate the log —
    // and a fixture has no reason to reproduce that. It must not be `unreported`
    // either: the log holds events for every publication in the plan.
    for (const p of PUBS) {
      const totals = funnelTotals(eventsOf(p))
      const f = of(90, p.slug)
      expect([p.slug, f.lifetimeViews, f.lifetimeForks]).toEqual([p.slug, totals.views, totals.forks])
      expect([p.slug, f.unreported]).toEqual([p.slug, false])
    }
  })

  it('windows the unlocks by SALE date, exercising the boundary', () => {
    // The sale stage is READ, not recorded: these are the fixture's own sales.
    // Kerala's oldest is exactly 30 days back, and a 30-day window starts at the
    // beginning of the day 29 back — so it falls OUTSIDE, and the fixture tests
    // that boundary instead of sitting safely inside it.
    expect(of(7, 'kerala').unlocks).toBe(1)
    expect(of(30, 'kerala').unlocks).toBe(2)
    expect(of(90, 'kerala').unlocks).toBe(3)
    expect(of(7, 'goa').unlocks).toBe(1)
    expect(of(30, 'goa').unlocks).toBe(2)
    expect(of(7, 'spiti').unlocks).toBe(1)
    expect(of(30, 'spiti').unlocks).toBe(2)
  })

  it('dates the log from its first RECORDED day, not from the plan\u2019s start', () => {
    // The plan ramps up from nothing, so a publication whose first days are empty
    // must not claim to have been recording since day one. Kerala starts at one
    // visit a day — its first day IS recorded — while Goa starts at zero.
    const planStart = utcDayKey(NOW - 99 * DAY)
    expect(of(90, 'kerala').recordingSinceDay).toBe(planStart)
    expect(of(90, 'goa').recordingSinceDay! > planStart).toBe(true)
  })

  it('is what the fixture actually writes \u2014 imported, not copied', () => {
    // The wiring a node suite cannot run: the script must SEED this plan rather
    // than restate it, replace the log rather than append to it on a re-run, and
    // set the row counters from the log's own totals.
    const script = read('../scripts/seedCreatorFixture.mjs')
    expect(script).toContain("from './fixtureFunnelPlan.mjs'")
    expect(script).toContain('planFunnelEvents(')
    expect(script).toContain("sql.remove('pub_events', 'pub_id'")
    expect(script).toContain('FUNNEL_TOTALS.get(p.slug)')
  })
})

// ---- The pre-log story (thread 2) ------------------------------------------
// The lifetime counters were born before the event log, so they disagree with
// it by design — and until now nothing on screen said so. The derivation
// exposes the gap as a NUMBER with three cases that must stay distinct:
// aligned (silence), a real gap (named and dated), and a failed read (null —
// the size of the gap is simply not knowable).
describe('the pre-log story: counters vs the event log', () => {
  const NOW = Date.UTC(2026, 8, 21, 12) // 2026-09-21 noon UTC
  const pub = (lifetimeViews: number, lifetimeForks: number): FunnelPub => ({
    id: 'p1', title: 'P1', priceInr: 199, lifetimeViews, lifetimeForks,
  })
  const f = (daily: FunnelDailyRow[], lifetimeViews: number, lifetimeForks: number) =>
    buildPubFunnels({ daily, sales: [], pubs: [pub(lifetimeViews, lifetimeForks)], days: 7, now: NOW })[0]

  it('stays silent when the log accounts for the counters', () => {
    // 3 views + 1 fork all inside the window: nothing unlogged to explain.
    const daily: FunnelDailyRow[] = [{ pubId: 'p1', day: utcDayKey(NOW), views: 3, forks: 1 }]
    const row = f(daily, 3, 1)
    expect(row.preLogViews).toBe(0)
    expect(row.preLogForks).toBe(0)
    expect(describePreLog(row)).toBeNull()
  })

  it('names and dates a real gap', () => {
    // 12 lifetime views but the log only holds 3: 9 predate recording.
    const daily: FunnelDailyRow[] = [{ pubId: 'p1', day: utcDayKey(NOW), views: 3, forks: 0 }]
    const row = f(daily, 12, 5)
    expect(row.preLogViews).toBe(9)
    expect(row.preLogForks).toBe(5)
    const line = describePreLog(row)
    expect(line).toContain('9 visits')
    expect(line).toContain('5 forks')
    expect(line).toContain('predate the event log')
    expect(line).toMatch(/recording began 21 Sept 2026|no dated log yet/)
  })

  it('never claims a negative gap (a log cannot hold more than the counter saw)', () => {
    // A test-heavy re-run (counters re-synced low, log replaced) must not
    // render a phantom deficit.
    const daily: FunnelDailyRow[] = [{ pubId: 'p1', day: utcDayKey(NOW), views: 50, forks: 20 }]
    const row = f(daily, 4, 2)
    expect(row.preLogViews).toBe(0)
    expect(row.preLogForks).toBe(0)
    expect(describePreLog(row)).toBeNull()
  })

  it('says nothing on a failed read — the size of the gap is not knowable', () => {
    // The UI renders this as "could not be read"; the derivation's half of the
    // promise is that describePreLog CANNOT produce a sentence from no data.
    const row = f([], 400, 12)
    expect(row.preLogViews).toBeNull()
    expect(row.preLogForks).toBeNull()
    expect(describePreLog(row)).toBeNull()
  })

  it('renders the same explanation on both surfaces (one source)', () => {
    // The hub line and the plan page's strip both call describePreLog; the
    // tripwire is that both imports resolve to the same function.
    expect(hubCode).toContain('describePreLog(f)')
    expect(publicCode).toContain('describePreLog(f)')
  })
})

// ---- The creator's glance on the plan's own page (thread 1) -----------------
describe('funnelGlance: the strip the plan\u2019s own page shows its creator', () => {
  const NOW = Date.UTC(2026, 8, 21, 12)

  it('formats the windowed steps with the same rates the hub shows', () => {
    expect(funnelGlance({ views: 43, forks: 6, unlocks: 1, forkRatePct: 14, unlockRatePct: 16.7, unreported: false }))
      // formatPct rounds anything ≥10 to a whole percent, so 16.7 reads 17%.
      .toBe('43 visits → 6 forks (14%) → 1 unlock (17%) · last 7 days')
  })

  it('omits rate parens where a stage is zero, and pluralizes correctly', () => {
    expect(funnelGlance({ views: 1, forks: 0, unlocks: 0, forkRatePct: 0, unlockRatePct: 0, unreported: false }))
      .toBe('1 visit → 0 forks → 0 unlocks · last 7 days')
  })

  it('says nothing for an unreported plan (the caller\u2019s copy covers it)', () => {
    expect(funnelGlance({ views: 0, forks: 0, unlocks: 0, forkRatePct: 0, unlockRatePct: 0, unreported: true })).toBeNull()
  })
})

// ---- Wiring a node suite cannot run -----------------------------------------
describe('the glance strip and the pre-log line, as wired', () => {
  it('the public page gates every funnel read behind isMyPub', () => {
    const code = codeOf(publicCode)
    // A visitor's session must never run the creator reads.
    expect(code).toContain('if (!isMyPub) return')
    expect(code).toContain('fetchCreatorFunnel()')
    expect(code).toContain('fetchCreatorSales()')
    // The strip itself must be inside the isMyPub block.
    expect(code).toContain('{isMyPub && (')
    // The same derivation, the same 7-day window, as the hub's own line.
    expect(code).toContain('days: 7,')
    expect(code).toContain('funnelGlance(f)')
  })

  it('a failed read says it failed instead of rendering a measurement', () => {
    const code = codeOf(publicCode)
    expect(code).toContain('myReadFailed')
    expect(code).toContain('Recorded traffic could not be read just now')
    expect(code).toContain('Reading this link')
    expect(code).toContain('No recorded traffic for this plan yet.')
  })

  it('the hub renders the pre-log line beside the lifetime totals', () => {
    const code = codeOf(hubCode)
    expect(code).toContain('describePreLog(f)')
    expect(code).toContain('pf-prelog')
  })
})
