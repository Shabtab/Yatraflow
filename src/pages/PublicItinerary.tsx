// ============ Public itinerary page ============
import { useEffect } from 'react'
import type { Trip, PublishedItinerary } from '../data/types'
import { useDb, currentUser, tripById, userById, duplicateTrip, registerPubCopy, registerPubView } from '../store/store'
import { simulateDay, originOf, minutesToHM, formatInr, getAssumptions } from '../lib/engine'
import { useTimeFormat, formatHM, formatHMRange } from '../lib/timefmt'
import { Avatar, Chip, EmptyState, toast, CopyButton } from '../components/ui'

export function PublicItineraryPage({ slug, onNavigate }: { slug: string; onNavigate: (r: string) => void }) {
  const db = useDb()
  const timeFormat = useTimeFormat()
  const me = currentUser(db)
  const pub: PublishedItinerary | undefined = db.published.find(p => p.id === slug)
  const trip: Trip | undefined = pub ? tripById(pub.tripId) : undefined

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

  function copyThis() {
    if (!me) { toast('Log in to copy this trip into your plans.'); onNavigate('/auth'); return }
    duplicateTrip(trip!, me.id)
    registerPubCopy(pub!.id)
    toast(`“${pub!.title}” copied — open it from My trips ✈️`)
    onNavigate('/trips')
  }

  return (
    <div>
      {/* ---- Cover hero ---- */}
      <section className="pub-hero">
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <button className="btn btn-sm btn-ghost" style={{ color: '#fff' }} onClick={() => onNavigate('/explore')}>← Explore</button>
          <h1 style={{ fontSize: 'clamp(1.9rem, 4.5vw, 3rem)', marginTop: 12 }}>{pub.title}</h1>
          <p style={{ opacity: .92, maxWidth: 640 }}>{pub.tagline}</p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }} className="small">
            <span>🗓 {pub.durationDays} days</span>
            <span>💰 ~{formatInr(pub.estimatedBudgetPerPersonInr)} per person</span>
            <span>🧭 {cap(pub.travelStyle)} travel</span>
            {pub.bestSeason && <span>🌤 Best: {pub.bestSeason}</span>}
            <span>👁 {pub.views} views</span>
          </div>
        </div>
      </section>

      <div className="container" style={{ paddingTop: 22 }}>
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

            {/* ---- Route summary ---- */}
            <div className="card">
              <h3>The route</h3>
              <hr className="divider" />
              <div className="route-flow">
                {pub.routeSummary.map((place, i) => (
                  <span key={i} className="route-node">{i > 0 && <span className="route-arrow">→</span>}{place}</span>
                ))}
              </div>
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
                Copies the full plan into your YatraFlow account — editable timeline, impact previews and collaboration included.
              </p>
              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={copyThis}>
                📋 Copy This Trip
              </button>
              <button className="btn btn-saffron btn-lg" style={{ width: '100%', marginTop: 10 }}
                onClick={() => toast('Premium unlock is a placeholder — no payments in this MVP.')}>
                🔒 Unlock Premium · ₹{price}
              </button>
              {pub.subscriberCta && <p className="hint-text" style={{ textAlign: 'center', marginTop: 8 }}>{pub.subscriberCta}</p>}
              <hr className="divider" />
              <div className="share-link-box"><code>{shareLink}</code><CopyButton text={shareLink} label="Share" /></div>
              {!me && <p className="hint-text" style={{ marginTop: 10 }}>You’ll need a free account to copy trips.</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1) }
function labelCat(c: string): string { return c.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) }
