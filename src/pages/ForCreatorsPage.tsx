// ============ For Indian travel creators ============
// The destination for a creator's "what is YatraFlow?" reply. The page is
// deliberately static: it reads no store data and renders for signed-out
// visitors, so the link works in a DM, a comment reply or a bio.
//
// The h1 is the locked C17 creator line, word for word. The page never states
// a payout, an amount or a date. What is live today and what is building next
// sit in separate sections, and each one names only shipped behaviour.
import { ArrowRight, MessageCircle } from 'lucide-react'
import { InlineIcon } from '../components/icons'
import { PageHeader } from '../components/page/PageHeader'
import { appLink } from '../lib/appLink'
import { useSessionUserId } from '../store/store'

/** The three live surfaces the page links to. */
const CREATOR_HUB = '/creator-hub'
const RANKINGS = '/creators'
const INSTAGRAM = 'https://www.instagram.com/yatraflow.in/'

const STEPS = [
  'Your audience keeps commenting on your Reel.',
  'Instead of a notes screenshot or a PDF that breaks on a phone, you send one live YatraFlow link.',
  'Your follower opens your timed day-by-day plan. They see the stops, realistic drive hours, stay tips and the rupee budget. Then they fork it into a group workspace to plan with friends.',
  'Your name, profile and original post stay attached to the route everywhere it is shared.',
] as const

const LIVE = [
  {
    title: 'Your public creator storefront',
    body: 'One clean hub holds every route you publish, your bio, your Instagram and YouTube links, your India states-covered grid, and a quick-glance record of your live routes, views, forks and total kilometres planned.',
  },
  {
    title: 'Post-to-plan linking',
    body: 'Attach your Instagram Reels, YouTube videos and Threads posts to the exact structured itinerary behind them. A follower who watched a 30-second video lands on the usable plan.',
  },
  {
    title: 'Real trip logistics, not a text wall',
    body: 'Every itinerary you publish shows structured days, stop order, drive times, the budget breakdown in rupees, travel tips and warnings. When a follower forks your route for five friends next weekend, YatraFlow recalculates the schedule and the per-person split.',
  },
  {
    title: 'Evidence-based creator rankings',
    body: 'Most creator lists reward whoever has the loudest follower count. The India leaderboard here ranks creators by how many travellers fork and use their routes. A small creator who knows Spiti or Meghalaya can outrank a large account that posts transition Reels.',
  },
] as const

const NEXT = [
  {
    title: 'Richer travelling stats and verified portfolios',
    body: 'Your published India trips become a structured record of regions, terrain types, trip styles and audience planning depth. Your profile then shows real ground knowledge at a glance.',
  },
  {
    title: 'Discovery for travel brands on real data',
    body: 'Stay networks, tourism boards, bike and gear brands, and travel partners get a transparent way to find creators by the routes and Indian states that drive trip planning, not by view counts alone.',
  },
  {
    title: 'Direct creator monetization',
    body: 'This is not live yet. The itinerary unlock flow already exists in the product. We are finalizing compliant Indian payout infrastructure, and we will not promise an amount or a date before it ships.',
  },
] as const

export function ForCreatorsPage() {
  const sessionUserId = useSessionUserId()
  // A signed-in creator lands on the hub. A signed-out visitor signs up first
  // and returns to the same place, so the main action works in both states.
  const storefrontPath: `/${string}` = sessionUserId
    ? CREATOR_HUB
    : `/auth?mode=signup&next=${encodeURIComponent(CREATOR_HUB)}`
  return (
    <div className="container yf-page page-enter fcr-page">
      <PageHeader
        className="fcr-head"
        kicker="For Indian travel creators"
        headline={{ lead: 'Turn the trips you post into plans your followers can actually follow.' }}
        lede={'Your best Reels take days on the road to shoot, and then they vanish down an algorithm feed while people keep commenting \u201citinerary please\u201d.'}
        actions={
          <>
            <a className="btn btn-primary btn-lg btn-trail" {...appLink(storefrontPath)}>
              Start your free storefront
              <span className="btn-trail-icon" aria-hidden="true"><InlineIcon icon={ArrowRight} size={15} gap={0} /></span>
            </a>
            <a className="btn btn-outline btn-lg" {...appLink(RANKINGS)}>See creator rankings</a>
          </>
        }
        meta={
          <div className="fcr-hero-note">
            <p className="fcr-hero-fact">
              <b>One clean, forkable route page.</b> YatraFlow turns every India trip you have done into
              a page you can drop into comment replies, DMs or your bio. In the same place it builds a
              portfolio of your routes, states covered and real trip usage, which followers and brands
              can see.
            </p>
            <p className="fcr-reassure">Free to publish · Zero posting obligation · You keep full credit and control.</p>
          </div>
        }
      />

      <section className="fcr-section" aria-labelledby="fcr-built">
        <h2 id="fcr-built" className="fcr-section-title">Built with your engagement, not against it</h2>
        <p className="fcr-section-lede">
          We know how Instagram works. A “comment ITINERARY” line drives your Reel reach. You should not
          have to kill your comments to save yourself from retyping the same twelve-line reply.
        </p>
        <ol className="fcr-steps">
          {STEPS.map((step, index) => (
            <li key={step} className="fcr-step">
              <span className="fcr-step-number" aria-hidden="true">{index + 1}</span>
              <p className="fcr-step-body">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="fcr-section" aria-labelledby="fcr-live">
        <h2 id="fcr-live" className="fcr-section-title">What is live for creators today</h2>
        <p className="fcr-section-lede">No waiting list. These four surfaces already work on YatraFlow.</p>
        <div className="fcr-grid">
          {LIVE.map((item, index) => (
            <article key={item.title} className="cr-card fcr-card">
              <span className="fcr-card-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="fcr-card-title">{item.title}</h3>
              <p className="fcr-card-body">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fcr-section" aria-labelledby="fcr-next">
        <h2 id="fcr-next" className="fcr-section-title">Where we are taking the creator hub next</h2>
        <p className="fcr-section-lede">
          This will not be another link-in-bio page. The goal is a proof-backed credential layer for
          Indian travel creators.
        </p>
        <div className="fcr-grid fcr-grid--three">
          {NEXT.map(item => (
            <article key={item.title} className="cr-card fcr-card">
              <h3 className="fcr-card-title">{item.title}</h3>
              <p className="fcr-card-body">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fcr-section fcr-final" aria-labelledby="fcr-start">
        <h2 id="fcr-start" className="fcr-section-title">How founding creators start today</h2>
        <p className="fcr-section-lede">It takes about ten minutes.</p>
        <ol className="fcr-steps fcr-steps--tight">
          <li className="fcr-step">
            <span className="fcr-step-number" aria-hidden="true">1</span>
            <p className="fcr-step-body">
              <b>Pick one India trip you already posted.</b> A route where people keep asking for the
              stops, the budget or the plan works best.
            </p>
          </li>
          <li className="fcr-step">
            <span className="fcr-step-number" aria-hidden="true">2</span>
            <p className="fcr-step-body">
              <b>Build it, or let the founders draft it privately from your public post.</b> Nothing goes
              live without your sign-off on every stop, number and credit line.
            </p>
          </li>
          <li className="fcr-step">
            <span className="fcr-step-number" aria-hidden="true">3</span>
            <p className="fcr-step-body">
              <b>Drop the link in your next “itinerary please” reply or your bio.</b> Your followers turn
              the Reel into an actual trip with their group.
            </p>
          </li>
        </ol>
        <div className="fcr-close">
          <a className="btn btn-primary btn-lg btn-trail" {...appLink(storefrontPath)}>
            Start your free storefront
            <span className="btn-trail-icon" aria-hidden="true"><InlineIcon icon={ArrowRight} size={15} gap={0} /></span>
          </a>
          <p className="fcr-close-note">
            Questions? <a className="fcr-link" href={INSTAGRAM} target="_blank" rel="noopener noreferrer">
              <InlineIcon icon={MessageCircle} size={14} gap={5} />DM @yatraflow.in on Instagram
            </a>
          </p>
        </div>
      </section>
    </div>
  )
}
