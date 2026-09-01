// ============ Landing page ============
import { BrandMark } from '../components/ui'

export function LandingPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  return (
    <div>
      {/* ---------- Hero ---------- */}
      <section className="hero">
        <div className="container">
          <span className="chip chip-saffron">🇮🇳 Made for Indian travellers</span>
          <h1 style={{ fontSize: 'clamp(2.2rem, 5.5vw, 3.6rem)', margin: '18px auto 14px', maxWidth: 780 }}>
            Plan trips that actually <span style={{ color: 'var(--yf-teal-600)' }}>flow together</span>
          </h1>
          <p className="hero-sub">
            Build the route, see every time and cost impact the moment you touch it,
            and keep your whole crew on the same page.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary btn-lg" href="#/auth?mode=signup">Start planning free</a>
            <a className="btn btn-saffron btn-lg" href="#/explore">Explore itineraries</a>
          </div>
          <p className="small muted" style={{ marginTop: 14 }}>Free forever · No card needed · Your planning data is yours</p>

          {/* Product preview mock (per the CTI homepage mockup) */}
          <div className="hero-preview" aria-hidden="true">
            <div className="hp-window">
              <div className="hp-titlebar"><span /><span /><span /></div>
              <div className="hp-body">
                <div className="hp-tripname">🏔️ Leh–Ladakh road escape</div>
                <div className="hp-route">12–21 Sep · 10 days · 4 travellers · Motorcycle</div>
                <div className="hp-stats">
                  <div><b>₹5,408</b><span>est. per person</span></div>
                  <div><b>60h 15m</b><span>driving time</span></div>
                  <div><b className="hp-mid">53</b><span>trip health</span></div>
                </div>
                <div className="hp-warning">
                  <span>⚠️</span> Day 3 is overloaded — add a rest halt to protect your arrival time.
                </div>
                <div className="hp-days">
                  <span className="hp-day d0">Day 1</span>
                  <span className="hp-day d1">Day 3</span>
                  <span className="hp-day d2">Day 6</span>
                  <span className="hp-day d3">Day 10</span>
                </div>
                <div className="hp-live"><span>👥 3 friends synced</span><span>live group signal</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Feature grid ---------- */}
      <section className="container" style={{ paddingBottom: 8 }}>
        <h2 className="section-title">Everything a crew needs, nothing it doesn’t</h2>
        <p className="muted section-sub">Built around one idea: every change shows its cost before you commit.</p>
        <div className="feature-strip">
          <FeatureCard icon="⚡" title="Impact before you commit"
            body="Add or reorder a stop and instantly see travel time, distance, cost deltas, arrival shifts and schedule conflicts — before anything is saved." />
          <FeatureCard icon="🗺️" title="Real maps, real places"
            body="Search actual locations while planning, see your whole route colour-coded day by day, and click any pin to jump into its details." />
          <FeatureCard icon="🏥" title="Trip Health Score"
            body="A 0–100 score flags over-packed days, thin buffers before trains, backtracking routes and opening-hours misses — each with a suggested fix." />
          <FeatureCard icon="👥" title="Plan as a crew"
            body="Invite friends by link, propose stops, upvote ideas, comment, and settle debates in a Decisions area instead of a chaotic group chat." />
          <FeatureCard icon="🤖" title="A companion that knows your trip"
            body='Ask "make Day 2 less tiring" or "can we still catch the train?" — answers come from your actual plan, with assumptions cited.' />
          <FeatureCard icon="💰" title="Honest INR budgets"
            body="Category-wise cost estimates with essential vs optional splits, per-person totals and budget-usage tracking. Estimates only — no fake precision." />
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="container" style={{ paddingBottom: 60 }}>
        <h2 className="section-title">From chaos to itinerary in four steps</h2>
        <div className="steps-grid">
          <Step n={1} title="Create a trip" body="Dates, travellers, transport mode, budget — and searchable real locations." />
          <Step n={2} title="Build the timeline" body="Add stops day by day; every change previews its impact instantly." />
          <Step n={3} title="Invite the crew" body="Share a link; friends suggest, vote and comment right inside the plan." />
          <Step n={4} title="Lock it & go" body="Resolve decisions, confirm bookings-worthy stops, publish if you like." />
        </div>
      </section>

      {/* ---------- Demo CTA ---------- */}
      <section className="container" style={{ paddingBottom: 70 }}>
        <div className="cta-band">
          <h2>Try the full product in demo mode</h2>
          <p>
            A 4-day Kerala road trip (Kochi → Munnar → Thekkady → Alleppey) with real stops, timings,
            votes, decisions and budgets already loaded. No signup needed.
          </p>
          <DemoButtons onNavigate={onNavigate} />
        </div>
      </section>
    </div>
  )
}

function DemoButtons({ onNavigate }: { onNavigate: (r: string) => void }) {
  return (
    <div className="cta-buttons">
      <a className="btn btn-navy btn-lg" href="#/auth?mode=signup">
        🚀 Create a free account
      </a>
      <BrandHint />
    </div>
  )
}

function BrandHint() {
  return <span className="small cta-hint">demo trips are added to your account automatically on first sign-in</span>
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="step-card">
      <span className="step-num">{n}</span>
      <h3>{title}</h3>
      <p className="small muted">{body}</p>
    </div>
  )
}

function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="card feature-card">
      <div className="feature-ico">{icon}</div>
      <h3>{title}</h3>
      <p className="small muted">{body}</p>
    </div>
  )
}
