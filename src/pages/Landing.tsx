// ============ Landing page ============
import { useRef, type ReactNode } from 'react'
import { InlineIcon } from '../components/icons'
import { ArrowDown, ArrowRight, Clock, MapPin, Plane, Route, TriangleAlert, Users, Zap } from 'lucide-react'
import { RouteSquiggle, useInView, usePageVisible } from '../components/ui'
import { PlanBench } from '../components/PlanBench'
import { scrollBehavior } from '../lib/motion'
import { CREATE_ROUTE, CREATE_PATH } from '../lib/routes'
import { useReveal } from '../hooks/useReveal'
import { useDb, currentUser } from '../store/store'

export function LandingPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  useReveal()
  const db = useDb()
  const me = currentUser(db)
  // Flow-aware hero CTA (Trip Ticket flow, Sep 2026): signed-in visitors go
  // straight to the create-trip page; everyone else funnels through signup and
  // lands back on it via the auth page's `next` param — both forms read from
  // lib/routes now, so this CTA cannot drift from the route the router matches.
  const startPlanningHref = me ? CREATE_ROUTE : `#/auth?mode=signup&next=${encodeURIComponent(CREATE_PATH)}`
  // One label per action (review finding 8): the hero CTA funnels signed-out
  // visitors through signup AND lands them in the create-trip flow (the
  // `next` param), so it says what it does rather than reusing the chrome
  // CTA's name — three identical link names on one page pointing at two
  // different targets made every link list ambiguous.
  const heroCtaLabel = me ? 'Plan a new trip' : 'Start a trip plan'
  return (
    <div>
      {/* ---------- Hero (split layout, per CTI homepage mockup) ---------- */}
      {/* hero-blob spans + hero-rise choreography: the atmosphere drifts slowly
          and the copy rises in one orchestrated stagger on load. */}
      {/* One continuous atmospheric canvas behind the whole page - hero, bench and
          sections share a single fixed-attachment ramp, so there are no section
          seams; the canvas is pulled up behind the floating nav pill too. */}
      <div className="landing-canvas">
      <section className="hero">
        <span className="hero-blob hero-blob-a" aria-hidden="true" />
        <span className="hero-blob hero-blob-b" aria-hidden="true" />
        <div className="container hero-split">
          <div className="hero-copy">
            <span className="chip chip-saffron hero-rise">Built for Indian travellers</span>
            <h1 className="hero-rise rise-d1 hero-title">
              Plan trips that actually <span style={{ color: 'var(--yf-teal-600)' }}>flow together</span>
            </h1>
            <p className="hero-sub hero-rise rise-d2">
              Build the route, see every time and cost impact,
              and keep your whole crew on the same page.
            </p>
            <div className="hero-ctas hero-rise rise-d3">
              <a className="btn btn-primary btn-lg btn-trail" href={startPlanningHref}>
                {heroCtaLabel}
                <span className="btn-trail-icon" aria-hidden="true"><InlineIcon icon={ArrowRight} size={15} gap={0} /></span>
              </a>
              <a className="btn btn-saffron btn-lg" href="#/explore">Explore itineraries</a>
            </div>
          </div>

          {/* Adventure preview card (dark navy, animated multi-trip route, mockup) */}
          <div className="hero-adventure hero-rise rise-d2" aria-hidden="true">
            <div className="ha-kicker">Your next adventure</div>
            {/* RouteSquiggle is a scenario carousel - it draws a different India trip
                on autopilot (Leh, Kerala, Spiti, Meghalaya) with a live caption AND
                count-up stats + warn/sync rows that change with each trip. */}
            <RouteSquiggle />
          </div>
        </div>
      </section>

      {/* ---------- Handoff strip: the two "already halfway in" entries ----------
          Directly below the hero, where a visitor who skipped the main CTA still
          finds a next step. The boarding-pass ticket issues a pass to the Plan
          Bench (bigger than a pill, unmistakably the next step); the invite-code
          entry serves friends who got a code, not a link - it routes to
          #/join/<code>, which previews the trip and asks for login only if
          needed. The reassurance line lives here, not under the hero CTAs. */}
      <section className="container handoff" aria-label="Other ways to start">
        {/* Ticket first: it is the product-led next step, so it sits under the
            headline column (the hero's card sits right, the strip's ticket sits
            left) and the invite form follows as the secondary entry. */}
        <button type="button" className="hero-bench-cta"
          onClick={() => document.getElementById('plan-bench')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })}>
          <span className="hbc-stub" aria-hidden="true">
            <span className="hbc-plane"><Plane size={18} aria-hidden /></span>
          </span>
          <span className="hbc-text">
            <span className="hbc-label">Price a trip in 10 seconds</span>
            <span className="hbc-sub">Boarding pass · no signup needed</span>
          </span>
          <span className="hbc-tear" aria-hidden="true" />
          <span className="hbc-code" aria-hidden="true">
            <b>YF-10S</b>
            <span>SEAT 1A</span>
            <span className="hbc-arrow"><ArrowDown size={14} aria-hidden /></span>
          </span>
        </button>
        <div className="handoff-join">
          <p className="handoff-lead">Invited to a trip?</p>
          <form className="invite-entry"
            onSubmit={e => {
              e.preventDefault()
              const code = new FormData(e.currentTarget).get('invite-code')
              if (typeof code === 'string' && code.trim()) onNavigate(`/join/${encodeURIComponent(code.trim())}`)
            }}>
            <label className="sr-only" htmlFor="invite-code-input">Trip invite code</label>
            <input id="invite-code-input" className="input" name="invite-code"
              placeholder="Trip code, e.g. GOA-K7QF" autoComplete="off"
              style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'var(--mono, monospace)' }} />
            <button type="submit" className="btn btn-outline">Join</button>
          </form>
          <p className="small muted handoff-note">Free to plan, no card needed. Your planning data stays yours.</p>
        </div>
      </section>

      {/* Infinite destination ticker - hero hands off to the Plan Bench over a living
          marquee of common + offbeat India spots (pure CSS loop, hover-pause). */}
      <DestTicker />

      {/* ---------- Plan Bench (interactive cost calculator) - the showpiece, one scroll from the fold ---------- */}
      <PlanBench />

      {/* ---------- What changes for you ---------- */}
      <section className="container" style={{ paddingBottom: 8, position: 'relative' }}>
        <TravelMotifs mode="features" />
        {/* --ink-teal, not the accent (review finding 2): at 12.5px this is body
            text and --yf-teal-600 measures 3.80:1 on cream (the same figure the
            focus-ring ledger at styles.css:129 documents for a 3:1 non-text
            use). --ink-teal is the text-grade teal, and re-resolves to
            --teal-deep in dark. */}
        <p className="small reveal" style={{ textAlign: 'center', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-teal)', marginBottom: 8 }}>One place for the reality of a trip</p>
        <h2 className="section-title reveal reveal-d1" style={{ maxWidth: 640, margin: '0 auto 26px' }}><span className="reveal-underline">From “let’s go” to a plan everyone can actually follow.</span></h2>
        {/* Three items, three cells: one tall photo cell beside two stacked
            cells. No empty tile, and each cell carries a different surface
            (photo / tinted / plain) so the row never reads as three identical
            cards. */}
        <div className="feature-strip feature-bento">
          <FeatureCard cls="reveal feature-photo" icon={<Zap size={20} aria-hidden />} title="See the impact before you change" body="Every move shows time, distance and budget consequences. No surprises later.">
            {/* A mini echo of the real Impact Preview panel (deltas + warnings
                with their fixes), so the tallest cell shows the feature instead
                of describing it. Forced-light literals: it is an artifact of the
                product's own dialog sitting on the dark photo in both themes. */}
            <div className="feature-preview">
              <div className="feature-preview-head">
                <Zap size={12} aria-hidden />
                <span>Impact preview</span>
                <span className="fp-chip">+1 warning</span>
              </div>
              <div className="fp-deltas">
                <div className="fp-delta"><b>+2h 15m</b><span>Time on the road</span></div>
                <div className="fp-delta"><b>+38 km</b><span>Distance</span></div>
                <div className="fp-delta"><b>+₹1,240</b><span>Est. cost</span></div>
              </div>
              <div className="fp-warn"><InlineIcon icon={TriangleAlert} size={12} gap={4} />Day 3 is overloaded<span>Add a rest halt to protect your arrival time.</span></div>
              <div className="fp-tip"><InlineIcon icon={Clock} size={12} gap={4} />Fort Kochi closes at 5 PM<span>Reach by 4:30, or swap with the naval museum.</span></div>
            </div>
          </FeatureCard>
          <FeatureCard cls="reveal reveal-d1 feature-tint" icon={<Route size={20} aria-hidden />} title="Plan around real road time" body="Route days, break suggestions and arrival times designed for how journeys really work." />
          <FeatureCard cls="reveal reveal-d2" icon={<Users size={20} aria-hidden />} title="Keep the whole group aligned" body="Share the itinerary, decide together, and know what still needs an answer." />
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      {/* A route, not a card grid: the four steps sit as stops along one dashed
          road line, so the section reads as a journey (collapses to a vertical
          timeline on narrow screens). */}
      <section className="container" style={{ paddingBottom: 'var(--landing-section-pad)', position: 'relative' }}>
        <h2 className="section-title reveal"><span className="reveal-underline">From chaos to itinerary in four steps</span></h2>
        <div className="steps-route">
          <Step cls="reveal" n={1} title="Create a trip" body="Dates, travellers, transport mode, budget, and searchable real locations." />
          <Step cls="reveal reveal-d1" n={2} title="Build the timeline" body="Add stops day by day; every change previews its impact instantly." />
          <Step cls="reveal reveal-d2" n={3} title="Invite the crew" body="Share a link; friends suggest, vote and comment right inside the plan." />
          <Step cls="reveal reveal-d3" n={4} title="Lock it & go" body="Resolve decisions, confirm bookings-worthy stops, publish if you like." />
        </div>
      </section>

      {/* ---------- Demo CTA ---------- */}
      <section className="container" style={{ paddingBottom: 'var(--landing-section-pad)' }}>
        <div className="cta-band reveal">
          <h2>See the whole product on a real trip</h2>
          <p>
            {/* The band's own verb (review finding 8): the chrome CTA keeps
                "Start planning free" as the one owner of that name. */}
            A 4-day Kerala road trip (Kochi → Munnar → Thekkady → Alleppey) with real stops, timings,
            votes, decisions and budgets, loaded into your account the moment you sign up.
          </p>
          <DemoButtons />
        </div>
      </section>
      </div>
    </div>
  )
}

/** Destination marquee: two identical tracks translate -50% for a seamless,
 *  fully-CSS infinite loop. Hover pauses, and so does the page being offscreen
 *  or hidden - a nonessential loop must not keep the compositor busy. Mixes
 *  common + offbeat Indian spots. */
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
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const visible = usePageVisible()
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
          saffron-on-cream can never reach AA contrast - a shape is exempt. */}
      <span className="ticker-sep" aria-hidden="true">
        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
          <path d="M5 1 L9 5 L5 9 L1 5 Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </span>
    </div>
  )
  return (
    <div className="dest-ticker" role="region" aria-label="Popular and offbeat Indian travel destinations"
      ref={ref} data-motion-paused={!inView || !visible}>
      <div className="ticker-track">
        {set(false)}
        {set(true)}
      </div>
    </div>
  )
}

/** Lightweight travel-silhouette SVG motifs behind the feature/steps grids -
 *  spinning compass, floating plane, bobbing trekker, swaying boat, drifting
 *  hot-air balloon, gliding birds. transform-only, off under reduced motion. */
function TravelMotifs({ mode }: { mode: 'features' | 'steps' }) {
  // aria-hidden on the wrapper spans (review finding 7): the SVGs are pure
  // atmosphere and used to surface as unnamed `image` nodes in the
  // accessibility tree — 4–9 of them, one reading-flow noise node each.
  return (
    <>
      {mode === 'features' ? (<>
        <span className="motif motif-compass" style={{ top: 30, right: 44 }} aria-hidden="true"><CompassSvg /></span>
        <span className="motif motif-float" style={{ bottom: 34, left: 24 }} aria-hidden="true"><PlaneSvg /></span>
        <span className="motif motif-rise" style={{ top: '38%', right: '8%' }} aria-hidden="true"><BalloonSvg /></span>
        <span className="motif motif-birds" style={{ top: 70, left: '12%' }} aria-hidden="true"><BirdsSvg /></span>
      </>) : (<>
        <span className="motif motif-bob" style={{ top: 22, left: 48 }} aria-hidden="true"><TrekkerSvg /></span>
        <span className="motif motif-float" style={{ bottom: 40, right: 34 }} aria-hidden="true"><PlaneSvg /></span>
        <span className="motif motif-sway" style={{ bottom: 90, left: '6%' }} aria-hidden="true"><BoatSvg /></span>
        <span className="motif motif-birds" style={{ top: 90, right: '14%' }} aria-hidden="true"><BirdsSvg /></span>
        <span className="motif motif-rise" style={{ top: '30%', left: '22%' }} aria-hidden="true"><BalloonSvg /></span>
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

function DemoButtons() {
  return (
    <div className="cta-buttons">
      <a className="btn btn-navy btn-lg" href="#/auth?mode=signup">
        Create a free account
      </a>
      <BrandHint />
    </div>
  )
}

function BrandHint() {
  return <span className="small cta-hint">Demo trips are added to your account automatically on first sign-in</span>
}

function Step({ cls, n, title, body }: { cls?: string; n: number; title: string; body: string }) {
  return (
    <div className={`step-card ${cls ?? ''}`.trim()}>
      <span className="step-num">{n}</span>
      <div className="step-body">
        <h3>{title}</h3>
        <p className="small muted">{body}</p>
      </div>
    </div>
  )
}

function FeatureCard({ cls, icon, title, body, children }: { cls?: string; icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className={`card feature-card ${cls ?? ''}`.trim()}>
      {/* Double-Bezel: the .feature-card element is the outer tray, this is the
          inner plate. The plate's radius is derived from the tray's minus its
          own inset (see the .feature-core rule), so the curves stay concentric. */}
      <div className="feature-core">
        <div className="feature-ico" aria-hidden="true">{icon}</div>
        <h3>{title}</h3>
        <p className="small muted">{body}</p>
        {children}
      </div>
    </div>
  )
}
