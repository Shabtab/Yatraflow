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
import { stateBlockRole } from '../src/components/page/StateBlock'

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

  it('a failed first read sets its own failed state, not the unavailable state that renders nothing', () => {
    expect(weather).toMatch(/useState<'loading' \| 'ready' \| 'unavailable' \| 'failed'>\('loading'\)/)
    expect(weather).toMatch(/else setState\('failed'\)/)
    expect(weather).not.toMatch(/\.catch\(\(\) => \{ if \(!cancelled\) setState\('unavailable'\)/)
  })

  it('a failed refresh keeps the forecast on screen, and only a read with nothing loaded fails', () => {
    expect(weather).toMatch(/byDateRef\.current = merged/)
    const catchAt = weather.indexOf('.catch(() => {')
    expect(catchAt).toBeGreaterThan(-1)
    expect(weather.slice(catchAt)).toMatch(/if \(Object\.keys\(byDateRef\.current\)\.length > 0\) setRefreshFailed\(true\)\s*else setState\('failed'\)/)
  })

  it('the failed branch is an alert with a short line and Try again, before the quiet fallthrough', () => {
    const failedAt = weather.indexOf("if (state === 'failed') {")
    const quietAt = weather.indexOf("if (state !== 'ready') return null")
    expect(failedAt, 'the failed branch').toBeGreaterThan(-1)
    expect(quietAt, 'the quiet fallthrough').toBeGreaterThan(failedAt)
    expect(weather.slice(failedAt, quietAt)).toMatch(
      /<StateBlock kind="failed" size="compact" title="Couldn’t load the forecast\." actions=\{<button className="btn btn-outline btn-sm" onClick=\{retryWeather\}>Try again<\/button>\} \/>/,
    )
    expect(stateBlockRole('failed')).toBe('alert')
  })

  it('the loading line is a status, so a screen reader hears that the forecast is coming', () => {
    expect(weather).toMatch(/<StateBlock kind="loading" size="compact" title="Loading forecast…" \/>/)
    expect(stateBlockRole('loading')).toBe('status')
  })

  it('a kept forecast adds a status note with Try again in the ready branch', () => {
    const readyAt = weather.indexOf("if (state !== 'ready') return null")
    expect(readyAt).toBeGreaterThan(-1)
    const keptNote = /\{refreshFailed && refreshFailedFor === anchorSignature && entries\.length > 0 && \(\s*<div className="ovw-weather-kept"><StateBlock\s+kind="kept"\s+size="compact"\s+title="Couldn’t refresh the forecast\. Showing the last one\."\s+actions=\{<button className="btn btn-outline btn-sm" onClick=\{retryWeather\}>Try again<\/button>\}\s*\/>\s*<\/div>\s*\)\}/
    expect(weather.slice(readyAt)).toMatch(keptNote)
    expect(stateBlockRole('kept')).toBe('status')
  })

  it('Try again shows the loading line only while nothing has loaded, and re-pulls the forecast past the cache', () => {
    expect(weather).toMatch(/const retryWeather = \(\) => \{\s*if \(Object\.keys\(byDateRef\.current\)\.length === 0\) setState\('loading'\)\s*setRetries\(r => r \+ 1\)\s*\}/)
    expect(weather).toMatch(/\{ force: tick > 0 \|\| retries > 0 \}/)
    expect(weather).toMatch(/\}, \[dayAnchors, tick, retries\]\)/)
  })

  it('the no-data case stays quiet: no anchored day returns null before any loading or failed copy', () => {
    const noDataAt = weather.indexOf('if (dayAnchors.length === 0) return null')
    expect(noDataAt).toBeGreaterThan(-1)
    expect(noDataAt).toBeLessThan(weather.indexOf("if (state === 'loading')"))
    expect(noDataAt).toBeLessThan(weather.indexOf("if (state === 'failed')"))
  })

  it('a successful call with no usable day and nothing loaded still renders nothing, never the failure line', () => {
    expect(weather).toMatch(/\} else \{\s*setState\('unavailable'\)\s*\}/)
    const failedAt = weather.indexOf("if (state === 'failed')")
    const quietAt = weather.indexOf("if (state !== 'ready') return null")
    expect(weather.indexOf('Couldn’t load the forecast')).toBeGreaterThan(failedAt)
    expect(weather.indexOf('Couldn’t load the forecast')).toBeLessThan(quietAt)
  })

  it('the card is keyed by trip, so one trip’s forecast never stands in for another', () => {
    expect(overview).toMatch(/<WeatherCard key=\{trip\.id\} trip=\{trip\} \/>/)
  })

  it('the failed line and the kept note enter like the error line, with the reduced-motion opt-out', () => {
    const css = read('../src/styles.css')
    expect(css).toMatch(/\.ovw-weather-failed, \.ovw-weather-kept \{ animation: errIn var\(--motion-med\) var\(--ease-out\); \}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.ovw-weather-failed, \.ovw-weather-kept \{ animation: none; \} \}/)
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

  it('the retry re-reads the trips slice, and Try again is disabled while the read runs', () => {
    expect(home).toMatch(/import \{[^}]*\brereadTrips\b[^}]*\} from '\.\.\/store\/store'/)
    expect(home).toMatch(/const \[retrying, setRetrying\] = useState\(false\)/)
    expect(home).toMatch(/const retryTrips = \(\) => \{\s*setRetrying\(true\)\s*void rereadTrips\(\)\.finally\(\(\) => \{ setRetrying\(false\) \}\)\s*\}/)
    expect(home).toContain("{retrying ? 'Trying…' : 'Try again'}")
    expect(home.match(/disabled=\{retrying\}/g)?.length ?? 0).toBe(2)
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
    expect(homeBody.slice(failedAt, readyAt)).toMatch(
      /<StateBlock\s+kind="failed"\s+icon=\{<TriangleAlert size=\{26\} aria-hidden \/>\}\s+title="Couldn’t load trips"\s+body="The request failed\. That does not mean you have no trips\."/,
    )
    expect(homeBody.slice(failedAt, readyAt)).toMatch(
      /actions=\{<button className="btn btn-primary" onClick=\{retryTrips\} disabled=\{retrying\}>\{retrying \? 'Trying…' : 'Try again'\}<\/button>\}/,
    )
    expect(homeBody.slice(readyAt, rowsAt)).toContain('No trips yet.')
  })

  it('the failed branch never carries the empty copy, and is the shared failed block, not the empty markup', () => {
    const failedAt = homeBody.indexOf("trips.length === 0 && tripsRead === 'failed'")
    const readyAt = homeBody.indexOf("trips.length === 0 && tripsRead === 'ready'")
    expect(homeBody.slice(failedAt, readyAt)).not.toContain('No trips yet')
    expect(homeBody.slice(failedAt, readyAt)).not.toContain('app-home-empty')
  })

  it('a failed read with loaded trips keeps the rows and adds one status note with Try again above them', () => {
    expect(homeBody).toMatch(
      /\{trips\.length > 0 && \(\s*<>\s*\{tripsRead === 'failed' && \(\s*<p className="small muted" role="status">Couldn’t refresh your trips — showing what was loaded\. <button className="btn btn-outline btn-sm" onClick=\{retryTrips\} disabled=\{retrying\}>\{retrying \? 'Trying…' : 'Try again'\}<\/button><\/p>\s*\)\}/,
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
    const verdictAt = store.indexOf('patch({ sliceReads: { ...cache.sliceReads, ...sliceReadReport(partial, askedSlices), ...installed.verdicts } })')
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
