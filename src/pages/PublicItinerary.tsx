// ============ Public itinerary page — editorial story + practical evidence (CTI §6.11) ============
// A shareable travel document, not the private workspace: destination-led hero,
// creator attribution, "why this route works" story, a practical stat cluster,
// and curated day highlights ahead of the detailed (and premium-gated) plan.
import { useEffect, useMemo } from 'react'
import type { Trip, PublishedItinerary } from '../data/types'
import { useDb, currentUser, tripById, userById, duplicateTrip, registerPubCopy, registerPubView } from '../store/store'
import { simulateDay, originOf, minutesToHM, formatInr, getAssumptions, computeTotals, isRoundTrip } from '../lib/engine'
import { useTimeFormat, formatHM, formatHMRange } from '../lib/timefmt'
import { stopKindOf, STOP_KIND_LABELS } from '../lib/stopKind'
import { useSavedPubs } from '../lib/savedPubs'
import { Avatar, Chip, EmptyState, toast, CopyButton, RouteSnapshot } from '../components/ui'

export function PublicItineraryPage({ slug, onNavigate }: { slug: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const timeFormat = useTimeFormat()
  const me = currentUser(db)
  const pub: PublishedItinerary | undefined = db.published.find(p => p.id === slug)
  const trip: Trip | undefined = pub ? tripById(pub.tripId) : undefined
  const { isSaved, toggleSaved } = useSavedPubs()

  useEffect(() => {
    if (pub) registerPubView(pub.id)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!pub || !trip) {
    return (
      <div className="container">
        <EmptyState icon="🔗" title="Itinerary not found"
          body="This public page may have been unpublished."
          action={<button className="btn btn-primary" onClick={() => onNavigate('/explore')}>Back to Explore</button>} />
      </div>
    )
  }

  const creator = userById(pub.creatorId)
  const shareLink = `${location.origin}${location.pathname}#/pub/${pub.id}`
  const price = pub.premiumPriceInr ?? 199
  const savedFlag = isSaved(pub.id)

  function copyThis() {
    if (!me) { toast('Log in to fork this trip into your plans.'); onNavigate('/auth'); return }
    duplicateTrip(trip!, me.id)
    registerPubCopy(pub!.id)
    toast(`“${pub!.title}” forked — open it from My trips ✈️`)
    onNavigate('/trips')
  }

  function saveThis() {
    const nowSaved = toggleSaved(pub!.id)
    toast(nowSaved ? '♥ Saved to this browser.' : 'Removed from saved itineraries.')
  }

  // ---- practical evidence, computed from the real trip (no schema fields) ----
  const totals = useMemo(() => computeTotals(trip), [trip])
  const orderedDays = useMemo(() => [...trip.days].sort((a, b) => a.index - b.index), [trip])
  const routePoints = useMemo(() => {
    const pts: Array<{ lat: number; lng: number; day: number }> = []
    if (trip.startLocationCoords) pts.push({ lat: trip.startLocationCoords.lat, lng: trip.startLocationCoords.lng, day: 0 })
    for (const day of orderedDays) {
      for (const s of [...day.stops].sort((a, b) => a.orderInDay - b.orderInDay)) {
        if (s.status !== 'rejected' && Number.isFinite(s.lat) && Number.isFinite(s.lng)) {
          pts.push({ lat: s.lat, lng: s.lng, day: day.index })
        }
      }
    }
    return pts.length >= 2 ? pts : undefined
  }, [trip])

  // Curated highlights: the three meatiest days, back in trip order.
  const highlights = useMemo(() => {
    const scored = orderedDays.map(day => {
      const stops = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
      const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
      const lead = stops.find(s => s.auto !== true) ?? stops[0]
      return {
        day,
        stops,
        score: stops.length + (sim.totalDistanceKm > 1 ? 1 : 0),
        kind: lead ? stopKindOf(lead) : 'drive' as const,
        meta: `${stops.length} stop${stops.length === 1 ? '' : 's'} · ~${minutesToHM(sim.totalTravelMinutes)} travel${sim.totalDistanceKm > 1 ? ` · ${sim.totalDistanceKm.toFixed(0)} km` : ''}`,
      }
    })
    return [...scored].sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.day.index - b.day.index)
  }, [trip])

  return (
    <div>
      {/* ---- Editorial hero: destination-led, creator-attributed (§6.11) ---- */}
      <section className="pub-hero">
        <div className="pub-hero-bg" aria-hidden="true" />
        <div className="container pub-hero-inner">
          <button className="btn btn-sm btn-ghost pub-hero-back" onClick={() => onNavigate('/explore')}>← Explore</button>
          <span className="pub-hero-badge">{cap(pub.travelStyle).toUpperCase()} ITINERARY</span>
          <p className="pub-hero-kicker">
            {trip.startLocation} → {trip.destinations.join(' → ')}
            {isRoundTrip(trip) && <> → {trip.startLocation}</>}
          </p>
          <h1 className="pub-hero-title">{pub.title}</h1>
          <p className="pub-hero-story">{pub.tagline}</p>
          <p className="pub-hero-byline">
            BY {creator?.profile.name ?? 'a YatraFlow traveller'} · {pub.durationDays} DAYS · {trip.travellers} TRAVELLERS · {cap(trip.transportMode)}
            {creator?.profile.isCreator && <> · ✨ VERIFIED CREATOR</>}
          </p>
        </div>
        {/* "The practical bit" — the evidence cluster, floating over the hero */}
        <aside className="pub-hero-stats">
          <span className="pub-stats-label">THE PRACTICAL BIT</span>
          <b className="pub-stats-figure">{formatInr(pub.estimatedBudgetPerPersonInr)}</b>
          <span className="pub-stats-sub">estimated per traveller</span>
          <hr className="pub-stats-divider" />
          <div className="pub-stats-row">
            <span>📍 {pub.routeSummary.length} place{pub.routeSummary.length === 1 ? '' : 's'}</span>
            <span>🛣 {totals.totalDistanceKm.toFixed(0)} km</span>
            <span>🕒 {minutesToHM(totals.totalTravelMinutes)} on the road</span>
            <span>🗓 {pub.durationDays} days</span>
          </div>
        </aside>
      </section>

      <div className="container pub-body">
        {/* ---- Paper sheet: the editorial layer over the hero ---- */}
        <div className="paper-sheet">
          <div className="pub-actions">
            <b>Made to be copied, adjusted and made your own.</b>
            <div className="pub-actions-btns">
              <button className="btn save-btn" onClick={saveThis} aria-pressed={savedFlag}>
                {savedFlag ? '♥ Saved' : '♡ Save itinerary'}
              </button>
              <button className="btn fork-btn" onClick={copyThis}>Fork this trip →</button>
            </div>
          </div>

          <div className="two-col pub-editorial">
            <div>
              <span className="editorial-kicker">THE JOURNEY</span>
              <h2 className="editorial-title">Why this route works</h2>
              <p className="editorial-body">{pub.tagline}</p>
              {pub.travelTips.length > 0 && (
                <>
                  <h3 className="editorial-sub">Route philosophy</h3>
                  <ul className="editorial-list">
                    {pub.travelTips.map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                </>
              )}
              <p className="editorial-body">
                Built around {minutesToHM(totals.totalTravelMinutes)} of real road time across {pub.durationDays} days —
                pacing, breaks and costs are all in the plan below.
              </p>
            </div>
            <aside className="card route-snap route-glance">
              <span className="route-glance-label">THE ROUTE AT A GLANCE</span>
              <RouteSnapshot
                count={trip.days.length}
                startLabel={trip.startLocation}
                endLabel={trip.destinations[trip.destinations.length - 1]}
                roundTripNote={isRoundTrip(trip) ? `↩ returns to ${trip.startLocation}` : undefined}
                points={routePoints}
              />
              <div className="route-glance-list">{pub.routeSummary.join(' · ')}</div>
              <span className="route-glance-meta">{pub.durationDays} days · {totals.totalDistanceKm.toFixed(0)} km · {totals.stopCount} stops</span>
            </aside>
          </div>

          {highlights.length > 0 && (
            <div className="pub-highlights">
              <span className="editorial-kicker">TRIP HIGHLIGHTS</span>
              <h2 className="editorial-title">The rhythm of {pub.durationDays} days</h2>
              <div className="day-highlight-row">
                {highlights.map(h => (
                  <div key={h.day.id} className="day-highlight-card">
                    <div className="day-highlight-top">
                      <span className="editorial-kicker">DAY {String(h.day.index + 1).padStart(2, '0')} · {STOP_KIND_LABELS[h.kind].toUpperCase()}</span>
                      <span className={`stop-kind-tag kind-${h.kind}`}>{STOP_KIND_LABELS[h.kind]}</span>
                    </div>
                    <b className="day-highlight-title">{h.day.title ?? `Day ${h.day.index + 1}`}</b>
                    <span className="day-highlight-meta">{h.meta}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="two-col">
          <div>
            {/* ---- Creator ---- */}
            <div className="card">
              <div className="creator-line">
                <Avatar user={creator} size="lg" />
                <div>
                  <b>{creator?.profile.name ?? 'Creator'}</b>{creator?.profile.isCreator && <span className="chip chip-saffron" style={{ marginLeft: 8 }}>✨ Creator</span>}
                  {creator?.profile.creatorBio && <p className="small muted" style={{ margin: '5px 0 0' }}>{creator.profile.creatorBio}</p>}
                </div>
              </div>
              {creator?.profile.socialLinks && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  {creator.profile.socialLinks.youtube && <a className="chip chip-info" href={creator.profile.socialLinks.youtube} target="_blank" rel="noreferrer">▶ YouTube</a>}
                  {creator.profile.socialLinks.instagram && <a className="chip chip-info" href={creator.profile.socialLinks.instagram} target="_blank" rel="noreferrer">📷 Instagram</a>}
                </div>
              )}
              {creator?.profile.socialLinks?.instagram == null && creator?.profile.socialLinks?.youtube == null && (
                <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }}>Book a planning consultation</button>
              )}
            </div>

            {/* ---- Day-by-day (free vs premium) ---- */}
            {trip.days.map(day => {
              const isFree = pub.freeDayIndexes.includes(day.index)
              const sim = simulateDay(day, trip, originOf(trip, day.index), day.index)
              const A = getAssumptions(trip)
              const stops = [...day.stops].filter(s => s.status !== 'rejected').sort((a, b) => a.orderInDay - b.orderInDay)
              return (
                <div key={day.id} className="day-section" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div className="day-header">
                    <div className="day-badge"><small>DAY</small><b>{day.index + 1}</b></div>
                    <div>
                      <h3>{day.title ?? `Day ${day.index + 1}`}</h3>
                      <div className="small muted">
                        {sim.activeStops.length <= 1 && sim.totalDistanceKm < 0.5
                          ? 'Local day — no drive planned'
                          : `${stops.length} stops · ~${minutesToHM(sim.totalTravelMinutes)} travel`}
                      </div>
                    </div>
                    {!isFree && <Chip tone="saffron">🔒 Premium</Chip>}
                  </div>

                  {isFree ? (
                    stops.map((s, i) => {
                      // Auto anchors are pure travel, not activities — show the
                      // drive (times, duration, distance, cost) as a travelling
                      // strip instead of an empty stop-card.
                      if (s.auto === true) {
                        const cleanName = (s.locationName || s.title).replace(/ \((start|end)\)$/, '')
                        // Stay day: the journey never leaves this place — a
                        // plain base marker, not a travelling strip.
                        if (sim.activeStops.length <= 1 && sim.totalDistanceKm < 0.5) {
                          return (
                            <div key={s.id} className="travel-anchor">
                              <div className="travel-anchor-title">
                                <span className="travel-anchor-ico">📍</span>
                                <span>Based in {cleanName}</span>
                              </div>
                            </div>
                          )
                        }
                        const inbound = i > 0 ? sim.legs[i - 1] : null
                        const dep = inbound ? (sim.departures[i - 1] ?? '--:--') : (sim.departures[i] ?? '--:--')
                        const arr = sim.arrivalTimes[i] ?? dep
                        const cost = inbound ? Math.round(inbound.distanceKm * (A.inrPerKm ?? 8)) : 0
                        const depHM = dep !== '--:--' ? formatHM(dep, timeFormat) : dep
                        const arrHM = arr !== '--:--' ? formatHM(arr, timeFormat) : arr
                        return (
                          <div key={s.id} className="travel-anchor">
                            <div className="travel-anchor-title">
                              <span className="travel-anchor-ico">{i === 0 ? '🏁' : '🚗'}</span>
                              <span>{i === 0 ? `Start · ${cleanName}` : `Travelling to ${cleanName}`}</span>
                            </div>
                            <div className="travel-anchor-meta">
                              {inbound ? (
                                <>
                                  <span>🕰 Depart {depHM} → arrive {arrHM}</span>
                                  <span>⏱ {minutesToHM(inbound.durationMinutes)}</span>
                                  <span>📍 {inbound.distanceKm.toFixed(0)} km</span>
                                  <span>🚗 est ₹{formatInr(cost)} ({A.mode})</span>
                                </>
                              ) : (
                                <span>Departure {depHM}</span>
                              )}
                            </div>
                          </div>
                        )
                      }
                      return (
                        <div key={s.id} className="stop-card">
                          <div className={`stop-num cat-${s.category}`}>{i + 1}</div>
                          <div className="stop-main">
                            <div className="stop-toprow">
                              <span className="stop-title">{s.title}</span>
                              <Chip tone="info">{labelCat(s.category)}</Chip>
                              {s.openTime && <span className="small muted">🕒 {formatHMRange(s.openTime, s.closeTime, timeFormat)}</span>}
                            </div>
                            <div className="stop-meta">
                              <span>📍 {s.locationName}</span>
                              <span>⏱ {minutesToHM(s.visitMinutes)}</span>
                              {s.entryFeeInrPerPerson > 0 && <span>🎫 ₹{s.entryFeeInrPerPerson}/person</span>}
                            </div>
                            {s.description && <div className="stop-desc">{s.description}</div>}
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <>
                      <div className="locked-overlay">
                        <div style={{ filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none' }} aria-hidden="true">
                          {stops.slice(0, 3).map((s, i) => (
                            <div key={s.id} className="stop-card"><div className="stop-num">{i + 1}</div><div className="stop-main"><div className="stop-title">{s.title}</div></div></div>
                          ))}
                        </div>
                        <div className="locked-cta">
                          <b>🔒 {stops.length} more stops on this day</b>
                          <p className="small">Unlock the full day-by-day plan with stay contacts, timings and budget breakdown.</p>
                          <button className="btn btn-saffron" onClick={() => toast('Premium unlock is a placeholder — no payments in this MVP.')}>Unlock Premium · ₹{price}</button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}

            {/* ---- Tips & warnings ---- */}
            <div className="two-col" style={{ marginTop: 16 }}>
              <div className="card">
                <h3>Travel tips</h3>
                <hr className="divider" />
                <ul style={{ paddingLeft: 18, lineHeight: 1.9, margin: 0 }}>
                  {pub.travelTips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
              <div className="card">
                <h3>Warnings & assumptions</h3>
                <hr className="divider" />
                <ul style={{ paddingLeft: 18, lineHeight: 1.9, margin: 0 }}>
                  {pub.warningsAndAssumptions.map((t, i) => <li key={i}>⚠️ {t}</li>)}
                </ul>
              </div>
            </div>
          </div>

          {/* ---- Sidebar ---- */}
          <div>
            <div className="card" style={{ position: 'sticky', top: 80 }}>
              <h3>Take this trip with you</h3>
              <p className="hint-text" style={{ margin: '8px 0 14px' }}>
                Forks the full plan into your YatraFlow account — editable timeline, impact previews and collaboration included.
              </p>
              <button className="btn fork-btn btn-lg" style={{ width: '100%' }} onClick={copyThis}>
                🍴 Fork this trip
              </button>
              <button className="btn btn-saffron btn-lg" style={{ width: '100%', marginTop: 10 }}
                onClick={() => toast('Premium unlock is a placeholder — no payments in this MVP.')}>
                🔒 Unlock Premium · ₹{price}
              </button>
              {pub.subscriberCta && <p className="hint-text" style={{ textAlign: 'center', marginTop: 8 }}>{pub.subscriberCta}</p>}
              <hr className="divider" />
              <div className="share-link-box"><code>{shareLink}</code><CopyButton text={shareLink} label="Share" /></div>
              {!me && <p className="hint-text" style={{ marginTop: 10 }}>You’ll need a free account to fork trips.</p>}
            </div>
          </div>
        </div>

        <p className="pub-footer-line">Published with YatraFlow · Plan real trips, together</p>
      </div>
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function labelCat(c: string): string { return c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) }
