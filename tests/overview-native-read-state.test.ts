// ============ #704 — a failed read is never shown as empty: Overview weather and native Home ============
//
// The bugs this pins. The Overview weather card mapped a failed forecast read to
// 'unavailable', and that state renders nothing, so the card vanished. The native
// Home read trips with no verdict at all, so a failed trips read printed "No trips
// yet". Each surface now branches on a verdict. Failed, loading and empty are three
// separate renderings, and the empty copy shows only after a read that succeeded.
// The branch order is the whole fix, so this guard reads the source.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// Comments name the copy under test, and a source guard reads prose as readily
// as code. Strip them, so a comment can never satisfy or break an order check.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const overview = stripComments(read('../src/pages/trip/OverviewTab.tsx'))
const weatherStart = overview.indexOf('function WeatherCard')
const weatherEnd = overview.indexOf('\nfunction ', weatherStart + 1)
const weather = overview.slice(weatherStart, weatherEnd)

const home = stripComments(read('../src/pages/NativeHome.tsx'))
const homeBody = home.slice(home.indexOf('export function NativeHomePage'))

describe('#704 — the Overview weather card says when the forecast read failed', () => {
  it('reads the card from its own source block', () => {
    expect(weatherStart).toBeGreaterThan(-1)
    expect(weatherEnd).toBeGreaterThan(weatherStart)
  })

  it('a failed fetch sets its own failed state, not the unavailable state that renders nothing', () => {
    expect(weather).toMatch(/useState<'loading' \| 'ready' \| 'unavailable' \| 'failed'>\('loading'\)/)
    expect(weather).toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setState\('failed'\) \}\)/)
    expect(weather).not.toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setState\('unavailable'\)/)
  })

  it('the failed branch shows a short line with Try again, before the quiet fallthrough', () => {
    const failedAt = weather.indexOf("if (state === 'failed') {")
    const quietAt = weather.indexOf("if (state !== 'ready') return null")
    expect(failedAt, 'the failed branch').toBeGreaterThan(-1)
    expect(quietAt, 'the quiet fallthrough').toBeGreaterThan(failedAt)
    expect(weather.slice(failedAt, quietAt)).toMatch(
      /Weather could not be loaded\. <button className="btn btn-outline btn-sm" onClick=\{retryWeather\}>Try again<\/button>/,
    )
  })

  it('Try again shows the loading line and re-pulls the forecast past the cache', () => {
    expect(weather).toMatch(/const retryWeather = \(\) => \{\s*setState\('loading'\)\s*setRetries\(r => r \+ 1\)\s*\}/)
    expect(weather).toMatch(/\{ force: tick > 0 \|\| retries > 0 \}/)
    expect(weather).toMatch(/\}, \[dayAnchors, tick, retries\]\)/)
  })

  it('the no-data case stays quiet: no anchored day returns null before any loading or failed copy', () => {
    const noDataAt = weather.indexOf('if (dayAnchors.length === 0) return null')
    expect(noDataAt).toBeGreaterThan(-1)
    expect(noDataAt).toBeLessThan(weather.indexOf("if (state === 'loading')"))
    expect(noDataAt).toBeLessThan(weather.indexOf("if (state === 'failed')"))
  })

  it('a successful call with no usable day still renders nothing, never the failure line', () => {
    expect(weather).toMatch(/setState\(Object\.keys\(merged\)\.length > 0 \? 'ready' : 'unavailable'\)/)
    const failedAt = weather.indexOf("if (state === 'failed')")
    const quietAt = weather.indexOf("if (state !== 'ready') return null")
    expect(weather.indexOf('Weather could not be loaded')).toBeGreaterThan(failedAt)
    expect(weather.indexOf('Weather could not be loaded')).toBeLessThan(quietAt)
  })
})

describe('#704 — native Home reads the trips verdict before it renders', () => {
  it('reads the trips verdict through sliceState and nothing else', () => {
    expect(home).toMatch(/import \{[^}]*\bsliceState\b[^}]*\} from '\.\.\/lib\/readState'/)
    expect(home).toMatch(/import \{[^}]*\buseSliceReads\b[^}]*\} from '\.\.\/store\/store'/)
    expect(home).toMatch(/const tripsRead = sliceState\(sliceReads, 'trips'\)/)
    expect(home).not.toMatch(/'memberships'/)
  })

  it('the trip list is read on every render, with no memo keyed on the session, so a retry shows its rows', () => {
    expect(home).toMatch(/const trips = tripsForUser\(meId\)/)
    expect(home).not.toMatch(/\[meId\]/)
    expect(home).not.toMatch(/useMemo\(/)
  })

  it('the retry re-reads the trips slice', () => {
    expect(home).toMatch(/import \{[^}]*\brereadTrips\b[^}]*\} from '\.\.\/store\/store'/)
    expect(home).toMatch(/const retryTrips = \(\) => \{ void rereadTrips\(\) \}/)
  })

  it('reading shows a loading row, failed shows its own message, and empty shows only after a successful read', () => {
    const readingAt = homeBody.indexOf("trips.length === 0 && tripsRead === 'reading'")
    const failedAt = homeBody.indexOf("trips.length === 0 && tripsRead === 'failed'")
    const readyAt = homeBody.indexOf("trips.length === 0 && tripsRead === 'ready'")
    const rowsAt = homeBody.indexOf('trips.length > 0 && (')
    expect(readingAt, 'the reading branch').toBeGreaterThan(-1)
    expect(failedAt, 'the failed branch').toBeGreaterThan(readingAt)
    expect(readyAt, 'the ready branch').toBeGreaterThan(failedAt)
    expect(rowsAt, 'the rows branch').toBeGreaterThan(readyAt)
    expect(homeBody.slice(readingAt, failedAt)).toMatch(/<StateBlock kind="loading" icon=\{<span className="spinner" aria-hidden="true" \/>\} title="Loading trips…" \/>/)
    expect(homeBody.slice(failedAt, readyAt)).toMatch(/Couldn’t load trips[\s\S]*onClick=\{retryTrips\}>Try again<\/button>/)
    expect(homeBody.slice(readyAt, rowsAt)).toContain('No trips yet.')
  })

  it('the failed branch never carries the empty copy', () => {
    const failedAt = homeBody.indexOf("trips.length === 0 && tripsRead === 'failed'")
    const readyAt = homeBody.indexOf("trips.length === 0 && tripsRead === 'ready'")
    expect(homeBody.slice(failedAt, readyAt)).not.toContain('No trips yet')
  })

  it('a failed read with loaded trips keeps the rows and adds one note with Try again above them', () => {
    expect(homeBody).toMatch(
      /\{trips\.length > 0 && \(\s*<>\s*\{tripsRead === 'failed' && \(\s*<p className="small muted">Couldn’t refresh your trips — showing what was loaded\. <button className="btn btn-outline btn-sm" onClick=\{retryTrips\}>Try again<\/button><\/p>\s*\)\}/,
    )
  })

  it('"Nothing planned yet" waits for a read that succeeded, unless trips are loaded', () => {
    const heroAt = homeBody.indexOf("(trips.length > 0 || tripsRead === 'ready') && (")
    const planAt = homeBody.indexOf('Nothing planned yet')
    expect(heroAt, 'the hero gate').toBeGreaterThan(-1)
    expect(planAt, 'the empty sentence').toBeGreaterThan(heroAt)
    expect(homeBody.slice(heroAt, planAt)).not.toMatch(/\)\}/)
  })
})

describe('#704 — the store publishes each read verdict to the pages', () => {
  // A retry and a resume both reach this write directly, with no commit after
  // it. Without the commit, the page keeps the verdict it had before the read.
  const store = read('../src/store/store.ts')

  it('a hydrate commits between writing the per-slice verdicts and the demo seed step', () => {
    const verdictAt = store.indexOf('patch({ sliceReads: sliceReadReport(partial, askedSlices) })')
    const seedAt = store.indexOf('if (tripList.length === 0 && seedIfEmpty', verdictAt)
    expect(verdictAt, 'the verdict write').toBeGreaterThan(-1)
    expect(seedAt, 'the seed step').toBeGreaterThan(verdictAt)
    expect(store.slice(verdictAt, seedAt)).toMatch(/\bcommit\(\)/)
  })

  it('trips is always asked, so a memberships read that succeeds with no rows reports ready', () => {
    expect(store).toMatch(/const askedSlices: string\[\] = \['profiles', 'memberships', 'suggested itineraries', 'trips'\]/)
    expect(store).not.toMatch(/askedSlices\.push\('trips'/)
  })

  it('a failed memberships read marks trips failed and keeps the cached trips', () => {
    expect(store).toMatch(/hydrate memberships failed', myMembershipsRes\.error\); partial\.push\('memberships'\); tripCountUnknown = true; tripsReadFailed = true \}/)
  })

  it('the auto-seed sets the flag addDemoTrips checks, so the Load demo button cannot seed a second set', () => {
    expect(store).toMatch(/demoSeedInFlight = true\s*try \{ await seedDemoFor\(userId, gen\) \} finally \{ demoSeedInFlight = false \}/)
  })
})
