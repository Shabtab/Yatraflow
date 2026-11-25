// ============ For Indian travel creators ============
// The destination for a creator's "what is YatraFlow?" reply. The page is
// deliberately static: it reads no store data and renders for signed-out
// visitors, so the link works in a DM, a comment reply or a bio.
//
// The h1 is the locked C17 creator line, word for word. The page never states
// a payout, an amount or a date. What is live today and what is building next
// sit in separate sections, and each one names only shipped behaviour.
import {
  ArrowRight, Link2, MessageCircle, Route, Store, Trophy,
  type LucideIcon,
} from 'lucide-react'
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

const LIVE: { title: string; body: string; icon: LucideIcon }[] = [
  {
    title: 'Your public creator storefront',
    body: 'One clean hub holds every route you publish, your bio, your Instagram and YouTube links, your India states-covered grid, and a quick-glance record of your live routes, views, forks and total kilometres planned.',
    icon: Store,
  },
  {
    title: 'Post-to-plan linking',
    body: 'Attach your Instagram Reels, YouTube videos and Threads posts to the exact structured itinerary behind them. A follower who watched a 30-second video lands on the usable plan.',
    icon: Link2,
  },
  {
    title: 'Real trip logistics, not a text wall',
    body: 'Every itinerary you publish shows structured days, stop order, drive times, the budget breakdown in rupees, travel tips and warnings. When a follower forks your route for five friends next weekend, YatraFlow recalculates the schedule and the per-person split.',
    icon: Route,
  },
  {
    title: 'Evidence-based creator rankings',
    body: 'Most creator lists reward whoever has the loudest follower count. The India leaderboard here ranks creators by how many travellers fork and use their routes. A small creator who knows Spiti or Meghalaya can outrank a large account that posts transition Reels.',
    icon: Trophy,
  },
]

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
]

/** The three starting routes, each shown on the region art it belongs to. */
const START_STEPS = [
  {
    art: '/art/himalaya-1.webp',
    lead: 'Pick one India trip you already posted.',
    rest: 'A route where people keep asking for the stops, the budget or the plan works best.',
  },
  {
    art: '/art/meghalaya-1.webp',
    lead: 'Build it, or let the founders draft it privately from your public post.',
    rest: 'Nothing goes live without your sign-off on every stop, number and credit line.',
  },
  {
    art: '/art/dest-leh-v2.webp',
    lead: 'Drop the link in your next “itinerary please” reply or your bio.',
    rest: 'Your followers turn the Reel into an actual trip with their group.',
  },
] as const

const THREAD = [
  { who: '@traveller_1', text: 'Itinerary please' },
  { who: '@traveller_2', text: 'Plan please' },
  { who: '@traveller_3', text: 'Route and budget please' },
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
      <div className="fcr-hero">
        <div className="fcr-hero__copy">
          <PageHeader
            className="fcr-head"
            kicker="For Indian travel creators"
            headline={{ lead: 'Turn the trips you post into plans your followers can actually follow.' }}
            lede={'Your best Reels take days on the road to shoot, and then they vanish down an algorithm feed while people keep commenting \u201citinerary please\u201d.'}
          />
          <div className="fcr-hero__actions">
            <a className="btn btn-primary btn-lg btn-trail" {...appLink(storefrontPath)}>
              Start your free storefront
              <span className="btn-trail-icon" aria-hidden="true"><InlineIcon icon={ArrowRight} size={15} gap={0} /></span>
            </a>
            <a className="btn btn-outline btn-lg" {...appLink(RANKINGS)}>See creator rankings</a>
          </div>
          <div className="fcr-hero-note">
            <p className="fcr-hero-fact">
              <b>One clean, forkable route page.</b> YatraFlow turns every India trip you have done into
              a page you can drop into comment replies, DMs or your bio. In the same place it builds a
              portfolio of your routes, states covered and real trip usage, which followers and brands
              can see.
            </p>
            <p className="fcr-reassure">Free to publish · Zero posting obligation · You keep full credit and control.</p>
          </div>
        </div>

        {/* A picture of the reply the creator sends, built from the page's own
            words. Decorative: the meaning is in the hero copy beside it. */}
        <div className="fcr-hero__visual">
          <figure className="fcr-phone" aria-hidden="true">
            <div className="fcr-phone__screen">
              <span className="fcr-phone__bar" />
              <p className="fcr-phone__title">Reel comments</p>
              <ul className="fcr-thread">
                {THREAD.map(comment => (
                  <li className="fcr-comment" key={comment.who}>
                    <span className="fcr-comment__avatar">{comment.who.slice(-1)}</span>
                    <span className="fcr-comment__body">
                      <span className="fcr-comment__who">{comment.who}</span>
                      <span className="fcr-comment__text">{comment.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="fcr-reply">
                <span className="fcr-reply__label">Your reply</span>
                <div className="fcr-linkcard">
                  <img className="fcr-linkcard__art" src="/art/dest-leh-v2.webp" alt="" width={640} height={400} loading="lazy" />
                  <span className="fcr-linkcard__copy">
                    <span className="fcr-linkcard__title">The Ladakh route</span>
                    <span className="fcr-linkcard__meta">Day-by-day plan</span>
                    <span className="fcr-linkcard__domain">yatraflow.in</span>
                  </span>
                </div>
              </div>
            </div>
          </figure>
          <p className="fcr-illustration-note">Illustration</p>
        </div>
      </div>

      <section className="fcr-section" aria-labelledby="fcr-built">
        <div className="fcr-section-head">
          <h2 id="fcr-built" className="fcr-section-title">Built with your engagement, not against it</h2>
          <p className="fcr-section-lede">
            We know how Instagram works. A “comment ITINERARY” line drives your Reel reach. You should not
            have to kill your comments to save yourself from retyping the same twelve-line reply.
          </p>
        </div>
        <ol className="fcr-flow">
          {STEPS.map((step, index) => (
            <li key={step} className="fcr-flow__step">
              <span className="fcr-flow__num" aria-hidden="true">{index + 1}</span>
              <p className="fcr-flow__body">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="fcr-section" aria-labelledby="fcr-live">
        <div className="fcr-section-head">
          <h2 id="fcr-live" className="fcr-section-title">What is live for creators today</h2>
          <p className="fcr-section-lede">No waiting list. These four surfaces already work on YatraFlow.</p>
        </div>
        <div className="fcr-card-grid">
          {LIVE.map(item => (
            <article key={item.title} className="cr-card fcr-card">
              <div className="fcr-card__top">
                <span className="fcr-card__icon" aria-hidden="true">
                  <InlineIcon icon={item.icon} size={19} gap={0} />
                </span>
                <span className="fcr-chip fcr-chip--live">Live</span>
              </div>
              <h3 className="fcr-card__title">{item.title}</h3>
              <p className="fcr-card__body">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fcr-section" aria-labelledby="fcr-next">
        <div className="fcr-section-head">
          <h2 id="fcr-next" className="fcr-section-title">Where we are taking the creator hub next</h2>
          <p className="fcr-section-lede">
            This will not be another link-in-bio page. The goal is a proof-backed credential layer for
            Indian travel creators.
          </p>
        </div>
        <div className="fcr-next-grid">
          {NEXT.map((item, index) => (
            <article key={item.title} className="cr-card fcr-card fcr-card--next">
              <span className="fcr-card__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className="fcr-chip fcr-chip--next">Building next</span>
              <h3 className="fcr-card__title">{item.title}</h3>
              <p className="fcr-card__body">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fcr-section fcr-section--start" aria-labelledby="fcr-start">
        <div className="fcr-section-head">
          <h2 id="fcr-start" className="fcr-section-title">How founding creators start today</h2>
          <p className="fcr-section-lede">It takes about ten minutes.</p>
        </div>
        <ol className="fcr-start-grid">
          {START_STEPS.map((step, index) => (
            <li key={step.lead} className="fcr-start">
              <span className="fcr-start__frame">
                <img className="fcr-start__art" src={step.art} alt="" width={640} height={400} loading="lazy" />
              </span>
              <span className="fcr-start__num" aria-hidden="true">{index + 1}</span>
              <p className="fcr-start__body">
                <b>{step.lead}</b> {step.rest}
              </p>
            </li>
          ))}
        </ol>
        <div className="fcr-cta">
          <a className="btn btn-primary btn-lg btn-trail" {...appLink(storefrontPath)}>
            Start your free storefront
            <span className="btn-trail-icon" aria-hidden="true"><InlineIcon icon={ArrowRight} size={15} gap={0} /></span>
          </a>
          <p className="fcr-cta__note">
            Questions? <a className="fcr-link" href={INSTAGRAM} target="_blank" rel="noopener noreferrer">
              <InlineIcon icon={MessageCircle} size={14} gap={5} />DM @yatraflow.in on Instagram
            </a>
          </p>
        </div>
      </section>
    </div>
  )
}
