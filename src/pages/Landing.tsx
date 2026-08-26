// ============ Landing page ============
import { loginDemo } from '../store/store'
import { BrandMark } from '../components/ui'

export function LandingPage({ onNavigate }: { onNavigate: (r: string) => void }) {
  return (
    <div>
      <section className="hero">
        <div className="container" style={{ textAlign: 'center' }}>
          <span className="chip chip-saffron">🇮🇳 Made for Indian travellers</span>
          <h1 style={{ fontSize: 'clamp(2.2rem, 5.5vw, 3.6rem)', margin: '18px auto 14px', maxWidth: 780 }}>
            Plan group trips that actually <span style={{ color: 'var(--teal)' }}>add up</span>
          </h1>
          <p style={{ fontSize: 18, maxWidth: 640, margin: '0 auto', opacity: .85 }}>
            YatraFlow shows the time, distance and cost impact of every stop — the moment you add,
            move or remove it. Plan together, vote on ideas, and keep the whole crew honest.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 26, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-lg" onClick={() => onNavigate('/auth?mode=signup')}>Start planning free</button>
            <button className="btn btn-saffron btn-lg" onClick={() => onNavigate('/explore')}>Explore itineraries</button>
          </div>
        </div>
      </section>

      <section className="container feature-strip">
        <FeatureCard icon="⚡" title="Impact before you commit"
          body="Add or reorder a stop and instantly see travel time, distance, cost deltas, arrival shifts and schedule conflicts — before anything is saved." />
        <FeatureCard icon="🏥" title="Trip Health Score"
          body="A 0–100 score flags over-packed days, thin buffers before trains, backtracking routes and opening-hours misses — each with a recommended fix." />
        <FeatureCard icon="👥" title="Plan as a crew"
          body="Invite friends by link, propose stops, upvote ideas, comment, and settle debates in a Decisions area instead of a chaotic group chat." />
        <FeatureCard icon="💰" title="Honest INR budgets"
          body="Category-wise cost estimates with essential vs optional splits, per-person totals and budget-usage tracking. Estimates only — no fake precision." />
      </section>

      <section className="container" style={{ paddingBottom: 60 }}>
        <div className="card" style={{ textAlign: 'center', padding: '38px 24px' }}>
          <h2>Try the full product in demo mode</h2>
          <p className="muted" style={{ maxWidth: 520, margin: '10px auto 20px' }}>
            A 4-day Kerala road trip (Kochi → Munnar → Thekkady → Alleppey) with real stops, timings,
            votes, decisions and budgets already loaded. No signup needed.
          </p>
          <DemoButtons onNavigate={onNavigate} />
        </div>
      </section>

      <section className="container" style={{ paddingBottom: 70 }}>
        <div className="two-col">
          <div className="card">
            <h3>How it works</h3>
            <hr className="divider" />
            <ol style={{ lineHeight: 2, paddingLeft: 20, margin: 0 }}>
              <li><b>Create a trip</b> — dates, travellers, transport mode, budget and fixed commitments.</li>
              <li><b>Build the timeline</b> — add stops; see impact previews for every change.</li>
              <li><b>Collaborate</b> — share an invite link, collect suggestions and votes.</li>
              <li><b>Publish</b> — creators can list polished itineraries on Explore.</li>
            </ol>
          </div>
          <div className="card">
            <h3>What we deliberately don't do</h3>
            <hr className="divider" />
            <ul style={{ lineHeight: 2, paddingLeft: 20, margin: 0 }}>
              <li>No hotel or flight bookings</li>
              <li>No payments</li>
              <li>No fake live traffic data</li>
              <li>Just transparent planning maths you can audit</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  )
}

function DemoButtons({ onNavigate }: { onNavigate: (r: string) => void }) {
  function go() {
    loginDemo()
    onNavigate('/trips')
  }
  return (
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
      <button className="btn btn-navy" onClick={go}>🚀 Enter demo mode</button>
      <BrandHint />
    </div>
  )
}

function BrandHint() {
  return <span className="small muted" style={{ alignSelf: 'center' }}>or log in at <code>demo@yatraflow.in / demo1234</code></span>
}

function FeatureCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="card feature-card">
      <div style={{ fontSize: 30 }}>{icon}</div>
      <h3 style={{ marginTop: 8 }}>{title}</h3>
      <p className="small muted" style={{ marginTop: 6 }}>{body}</p>
    </div>
  )
}
