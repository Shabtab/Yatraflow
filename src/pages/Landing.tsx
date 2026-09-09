// ============ Landing page ============
import { useEffect, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, MapPin, Plane, Rocket, Route, Users, Zap } from 'lucide-react'
import { RouteSquiggle } from '../components/ui'
import { PlanBench } from '../components/PlanBench'
import { scrollBehavior } from '../lib/motion'
import { useDb, currentUser } from '../store/store'

export function LandingPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  useReveal()
  const db = useDb()
  const me = currentUser(db)
  // Flow-aware hero CTA (Trip Ticket flow, Sep 2026): signed-in visitors go
  // straight to the create-trip page (route /new); everyone else funnels
  // through signup and lands back on it via the auth page's `next` param.
  const startPlanningHref = me ? '#/new' : '#/auth?mode=signup&next=%2Fnew'
  return (
    <div>
      {/* ---------- Hero (split layout, per CTI homepage mockup) ---------- */}
      {/* hero-blob spans + hero-rise choreography: the atmosphere drifts slowly
          and the copy rises in one orchestrated stagger on load. */}
      {/* One continuous atmospheric canvas behind the whole page — hero, bench and
          sections share a single fixed-attachment ramp, so there are no section
          seams; the canvas is pulled up behind the floating nav pill too. */}
      <div className="landing-canvas">
      <section className="hero">
        <span className="hero-blob hero-blob-a" aria-hidden="true" />
        <span className="hero-blob hero-blob-b" aria-hidden="true" />
        <div className="container hero-split">
          <div className="hero-copy">
            <span className="chip chip-saffron hero-rise">Built for Indian travellers</span>
            <h1 className="hero-rise rise-d1" style={{ fontSize: 'clamp(2.4rem, 5vw, 3.7rem)', margin: '18px 0 14px', lineHeight: 1.12 }}>
              Plan trips that actually <span style={{ color: 'var(--yf-teal-600)' }}>flow together</span>
            </h1>
            <p className="hero-sub hero-rise rise-d2">
              Build the route, see every time and cost impact,
              and keep your whole crew on the same page.
            </p>
            <div className="hero-ctas hero-rise rise-d3">
              <a className="btn btn-primary btn-lg" href={startPlanningHref}>Start planning free <ArrowRight size={16} aria-hidden style={{ verticalAlign: '-3px', marginLeft: 4 }} /></a>
              <a className="btn btn-saffron btn-lg" href="#/explore">Explore itineraries</a>
            </div>
            {/* Boarding-pass entry: travel-themed ticket that "issues" a pass to
                the Plan Bench — bigger than a pill, unmistakably the next step */}
            <button type="button" className="hero-bench-cta hero-rise rise-d4"
              onClick={() => document.getElementById('plan-bench')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}>
              <span className="hbc-stub" aria-hidden="true">
                <span className="hbc-plane"><Plane size={18} aria-hidden /></span>
              </span>
              <span className="hbc-text">
                <span className="hbc-label">Price a trip in 10 seconds</span>
                <span className="hbc-sub">Boarding pass · no signup · dials below</span>
              </span>
              <span className="hbc-tear" aria-hidden="true" />
              <span className="hbc-code" aria-hidden="true">
                <b>YF-10S</b>
                <span>SEAT 1A</span>
                <span className="hbc-arrow"><ArrowDown size={14} aria-hidden /></span>
              </span>
            </button>
            <p className="small muted hero-rise rise-d5" style={{ marginTop: 16 }}>No card needed · Free forever · Your planning data is yours</p>
            {/* Invite-code entry: friends who got a code (not a link) land here
                and type it in — routes to #/join/<code>, which previews the trip
                and asks for login only if needed. */}
            <form className="hero-rise rise-d5 invite-entry" style={{ display: 'flex', gap: 8, marginTop: 10, maxWidth: 360 }}
              onSubmit={e => {
                e.preventDefault()
                const code = new FormData(e.currentTarget).get('invite-code')
                if (typeof code === 'string' && code.trim()) onNavigate(`/join/${encodeURIComponent(code.trim())}`)
              }}>
              <label className="sr-only" htmlFor="invite-code-input">Trip invite code</label>
              <input id="invite-code-input" className="input" name="invite-code"
                placeholder="Have a trip code? GOA-K7QF" autoComplete="off"
                style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--mono, monospace)' }} />
              <button type="submit" className="btn btn-outline">Join</button>
            </form>
          </div>

          {/* Adventure preview card (dark navy, animated multi-trip route, mockup) */}
          <div className="hero-adventure hero-rise rise-d2" aria-hidden="true">
            <div className="ha-kicker">Your next adventure</div>
            {/* RouteSquiggle is a scenario carousel — it draws a different India trip
                on autopilot (Leh, Kerala, Spiti, Meghalaya) with a live caption AND
                count-up stats + warn/sync rows that change with each trip. */}
            <RouteSquiggle />
          </div>
        </div>
      </section>

      {/* Infinite destination ticker — hero hands off to the Plan Bench over a living
          marquee of common + offbeat India spots (pure CSS loop, hover-pause). */}
      <DestTicker />

      {/* ---------- Plan Bench (interactive cost calculator) — the showpiece, one scroll from the fold ---------- */}
      <PlanBench />

      {/* ---------- What changes for you ---------- */}
      <section className="container" style={{ paddingBottom: 8, position: 'relative' }}>
        <TravelMotifs mode="features" />
        <p className="small reveal" style={{ textAlign: 'center', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--yf-teal-600)', marginBottom: 8 }}>One place for the reality of a trip</p>
        <h2 className="section-title reveal reveal-d1" style={{ maxWidth: 640, margin: '0 auto 26px' }}><span className="reveal-underline">From “let’s go” to a plan everyone can actually follow.</span></h2>
        <div className="feature-strip">
          <FeatureCard cls="reveal" icon={<Zap size={20} aria-hidden />} title="See the impact before you change" body="Every move shows time, distance and budget consequences — no surprises later." />
          <FeatureCard cls="reveal reveal-d1" icon={<Route size={20} aria-hidden />} title="Plan around real road time" body="Route days, break suggestions and arrival times designed for how journeys really work." />
          <FeatureCard cls="reveal reveal-d2" icon={<Users size={20} aria-hidden />} title="Keep the whole group aligned" body="Share the itinerary, decide together, and know what still needs an answer." />
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="container" style={{ paddingBottom: 60, position: 'relative' }}>
        <TravelMotifs mode="steps" />
        <h2 className="section-title reveal"><span className="reveal-underline">From chaos to itinerary in four steps</span></h2>
        <div className="steps-grid">
          <Step cls="reveal" n={1} title="Create a trip" body="Dates, travellers, transport mode, budget — and searchable real locations." />
          <Step cls="reveal reveal-d1" n={2} title="Build the timeline" body="Add stops day by day; every change previews its impact instantly." />
          <Step cls="reveal reveal-d2" n={3} title="Invite the crew" body="Share a link; friends suggest, vote and comment right inside the plan." />
          <Step cls="reveal reveal-d3" n={4} title="Lock it & go" body="Resolve decisions, confirm bookings-worthy stops, publish if you like." />
        </div>
      </section>

      {/* ---------- Demo CTA ---------- */}
      <section className="container" style={{ paddingBottom: 70 }}>
        <div className="cta-band reveal">
          <h2>See the whole product on a real trip</h2>
          <p>
            A 4-day Kerala road trip (Kochi → Munnar → Thekkady → Alleppey) with real stops, timings,
            votes, decisions and budgets — loaded into your account the moment you sign up.
          </p>
          <DemoButtons onNavigate={onNavigate} />
        </div>
      </section>

      <footer className="footer" style={{ justifyContent: 'center' }}>
        YatraFlow · Plan real trips, together.
      </footer>
      </div>
    </div>
  )
}

/** One IntersectionObserver arms the reveal system once and flips every .reveal
 *  into .io-inview as it scrolls into the viewport (once, not re-hidden on
 *  re-entry). Arms body.reveal-armed first so content never hides if JS is off. */
function useReveal() {
  useEffect(() => {
    if (typeof window === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    document.body.classList.add('reveal-armed')
    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal'))
    if (!els.length) return
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('io-inview')
          io.unobserve(e.target)
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    for (const el of els) io.observe(el)
    return () => {
      io.disconnect()
      document.body.classList.remove('reveal-armed')
    }
  }, [])
}

/** Destination marquee: two identical tracks translate -50% for a seamless,
 *  fully-CSS infinite loop. Hover pauses. Mixes common + offbeat Indian spots. */
const DESTINATIONS: Array<{ label: string; tag: string; off?: boolean }> = [
  { label: 'Goa', tag: 'Beach' },
  { label: 'Leh · Ladakh', tag: 'High route' },
  { label: 'Alleppey', tag: 'Backwaters', off: true },
  { label: 'Hampi', tag: 'Heritage', off: true },
  { label: 'Manali', tag: 'Hills' },
  { label: 'Jaisalmer dunes', tag: 'Desert', off: true },
  { label: 'Munnar', tag: 'Tea hills' },
  { label: 'Ziro', tag: 'Northeast', off: true },
  { label: 'Udaipur', tag: 'Lake city' },
  { label: 'Tirthan Valley', tag: 'Hidden', off: true },
  { label: 'Mysore', tag: 'Palace' },
  { label: 'Meghalaya', tag: 'The East', off: true },
  { label: 'Andamans', tag: 'Islands', off: true },
  { label: 'Rishikesh', tag: 'River' },
]

function DestTicker() {
  const set = (dup: boolean) => (
    <div className="ticker-set" aria-hidden={dup || undefined}>
      {DESTINATIONS.map(({ label, tag, off }, i) => (
        <span key={`${dup ? 'b' : 'a'}-${i}`} className="ticker-item">
          <span className="t-ico"><MapPin size={13} aria-hidden /></span>
          <span>{label}</span>
          <span className={`t-tag${off ? ' t-off' : ''}`}>{tag}</span>
        </span>
      ))}
      {/* Decorative separator as an SVG shape, not the ◇ text glyph: text at
          saffron-on-cream can never reach AA contrast — a shape is exempt. */}
      <span className="ticker-sep" aria-hidden="true">
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
          <path d="M5 1 L9 5 L5 9 L1 5 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
  return (
    <div className="dest-ticker" role="region" aria-label="Popular and offbeat Indian travel destinations">
      <div className="ticker-track">
        {set(false)}
        {set(true)}
      </div>
    </div>
  )
}

/** Lightweight travel-silhouette SVG motifs behind the feature/steps grids —
 *  spinning compass, floating plane, bobbing trekker, swaying boat, drifting
 *  hot-air balloon, gliding birds. transform-only, off under reduced motion. */
function TravelMotifs({ mode }: { mode: 'features' | 'steps' }) {
  return (
    <>
      {mode === 'features' ? (<>
        <span className="motif motif-compass" style={{ top: 30, right: 44 }}><CompassSvg /></span>
        <span className="motif motif-float" style={{ bottom: 34, left: 24 }}><PlaneSvg /></span>
        <span className="motif motif-rise" style={{ top: '38%', right: '8%' }}><BalloonSvg /></span>
        <span className="motif motif-birds" style={{ top: 70, left: '12%' }}><BirdsSvg /></span>
      </>) : (<>
        <span className="motif motif-bob" style={{ top: 22, left: 48 }}><TrekkerSvg /></span>
        <span className="motif motif-float" style={{ bottom: 40, right: 34 }}><PlaneSvg /></span>
        <span className="motif motif-sway" style={{ bottom: 90, left: '6%' }}><BoatSvg /></span>
        <span className="motif motif-birds" style={{ top: 90, right: '14%' }}><BirdsSvg /></span>
        <span className="motif motif-rise" style={{ top: '30%', left: '22%' }}><BalloonSvg /></span>
      </>)}
    </>
  )
}

function CompassSvg() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" />
    </svg>
  )
}
function PlaneSvg() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M21 3l-8 3 4 7-4 4-2-8-4 1 1 4-3 1 1-4-3-1z" />
    </svg>
  )
}
function TrekkerSvg() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="6" r="3" />
      <path d="M12 10c-4 2-6 1.4-6 1.4L7 21h10l1-9.6-5-1.4z" />
      <path d="M7 18l-2.5 3m12.5-3l2.5 3" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  )
}
function BalloonSvg() {
  return (
    <svg width="30" height="34" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 2a8 8 0 0 1 8 8c0 4.5-4.5 8-8 12-3.5-4-8-7.5-8-12a8 8 0 0 1 8-8z" fill="currentColor" opacity=".9" />
      <path d="M12 2c-2.5 2-3.5 5-3.5 8S10 16 12 22c2-6 3.5-9 3.5-12S14.5 4 12 2z" fill="none" opacity=".45" />
      <path d="M9.5 23.5h5M10.5 26h3" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
function BoatSvg() {
  return (
    <svg width="28" height="22" viewBox="0 0 28 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15h20l-3.5 5h-13z" fill="currentColor" opacity=".9" />
      <path d="M14 3v12M14 4l6 9h-6" fill="none" />
      <path d="M13 5l-5 8h5" fill="none" opacity=".55" />
      <path d="M2 20c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0 4 1.5 6 0" fill="none" strokeWidth="1.2" opacity=".5" />
    </svg>
  )
}
function BirdsSvg() {
  return (
    <svg width="34" height="14" viewBox="0 0 34 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 8c2-2.5 4-2.5 5 0 1-2.5 3-2.5 5 0" />
      <path d="M14 4c1.7-2 3.3-2 4.2 0 .9-2 2.5-2 4.2 0" opacity=".75" />
      <path d="M25 9c1.4-1.8 2.6-1.8 3.4 0 .8-1.8 2-1.8 3.4 0" opacity=".5" />
    </svg>
  )
}

function DemoButtons({ onNavigate }: { onNavigate: (r: string) => void }) {
  return (
    <div className="cta-buttons">
      <a className="btn btn-navy btn-lg" href="#/auth?mode=signup">
        <Rocket size={16} aria-hidden style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Create a free account — demo trips included
      </a>
      <BrandHint />
    </div>
  )
}

function BrandHint() {
  return <span className="small cta-hint">demo trips are added to your account automatically on first sign-in</span>
}

function Step({ cls, n, title, body }: { cls?: string; n: number; title: string; body: string }) {
  return (
    <div className={`step-card ${cls ?? ''}`.trim()}>
      <span className="step-num">{n}</span>
      <h3>{title}</h3>
      <p className="small muted">{body}</p>
    </div>
  )
}

function FeatureCard({ cls, icon, title, body }: { cls?: string; icon: ReactNode; title: string; body: string }) {
  return (
    <div className={`card feature-card ${cls ?? ''}`.trim()}>
      <div className="feature-ico" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p className="small muted">{body}</p>
    </div>
  )
}
