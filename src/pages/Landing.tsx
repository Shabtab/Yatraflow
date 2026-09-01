// ============ Landing page ============
import { BrandMark, RouteSquiggle } from '../components/ui'

export function LandingPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  return (
    <div>
      {/* ---------- Hero (split layout, per CTI homepage mockup) ---------- */}
      <section className="hero">
        <div className="container hero-split">
          <div className="hero-copy">
            <span className="chip chip-saffron">🇮🇳 Built for Indian travellers</span>
            <h1 style={{ fontSize: 'clamp(2.4rem, 5vw, 3.7rem)', margin: '18px 0 14px', lineHeight: 1.12 }}>
              Plan trips that actually <span style={{ color: 'var(--yf-teal-600)' }}>flow together</span>
            </h1>
            <p className="hero-sub">
              Build the route, see every time and cost impact,
              and keep your whole crew on the same page.
            </p>
            <div className="hero-ctas">
              <a className="btn btn-primary btn-lg" href="#/auth?mode=signup">Start planning free →</a>
              <a className="btn btn-outline btn-lg" style={{ background: 'var(--card)' }} href="#/explore">Explore trips</a>
            </div>
            <p className="small muted" style={{ marginTop: 16 }}>No card needed · Free forever · Your planning data is yours</p>
          </div>

          {/* Adventure preview card (dark navy, route illustration, mockup) */}
          <div className="hero-adventure" aria-hidden="true">
            <div className="ha-kicker">Your next adventure</div>
            <div className="ha-name">🏔️ Leh–Ladakh road escape</div>
            <div className="ha-meta">12–21 Sep · 10 days · 4 travellers · Motorcycle</div>
            <div className="ha-stats">
              <div><b>₹5,408</b><span>est. per person</span></div>
              <div><b>60h 15m</b><span>driving time</span></div>
              <div><b style={{ color: '#F3AA3D' }}>53</b><span>trip health</span></div>
            </div>
            <RouteSquiggle />
            <div className="ha-row">
              <div className="ha-warn">⚠️ Day 3 is overloaded<span>add a rest halt to protect your arrival time.</span></div>
              <div className="ha-sync">3 friends synced<span>live collaboration on</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- What changes for you ---------- */}
      <section className="container" style={{ paddingBottom: 8 }}>
        <p className="small" style={{ textAlign: 'center', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--yf-teal-600)', marginBottom: 8 }}>One place for the reality of a trip</p>
        <h2 className="section-title" style={{ maxWidth: 640, margin: '0 auto 26px' }}>From “let’s go” to a plan everyone can actually follow.</h2>
        <div className="feature-strip">
          <FeatureCard icon="⚡" title="See the impact before you change" body="Every move shows time, distance and budget consequences — no surprises later." />
          <FeatureCard icon="🛣️" title="Plan around real road time" body="Route days, break suggestions and arrival times designed for how journeys really work." />
          <FeatureCard icon="👥" title="Keep the whole group aligned" body="Share the itinerary, decide together, and know what still needs an answer." />
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

      <footer className="container small muted" style={{ textAlign: 'center', padding: '26px 20px 34px', borderTop: '1px solid var(--line)' }}>
        YatraFlow · Plan real trips, together.
      </footer>
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
