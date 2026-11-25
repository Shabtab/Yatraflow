// ============ About YatraFlow ============
// The marketing site's story page: why the product exists, what it does today,
// and where the creator hub goes next. It reads no store data, so it renders
// for signed-out visitors too (App.tsx answers it before the signed-in switch,
// beside the DMCA page).
//
// Every "live today" claim below maps to shipped code. The roadmap half sits in
// its own section and says plainly that it is not built yet, and no line claims
// a payout, a sale or a user count (#233, #234). The copy follows the approved
// brief in the marketing plan, split into short sentences for the STE gate.
// The words are unchanged from the original page; the layout turns each block
// into a visual unit. Entrances come from the shared `page-enter` cascade.
import {
  ArrowRight, Calculator, CalendarClock, Car, Check,
  Compass, Gauge, IndianRupee, Layers, MapPin,
  MessageCircle, Route, Smartphone, Store, Users, Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'
import { InlineIcon } from '../components/icons'
import { appLink } from '../lib/appLink'
import { CREATE_PATH, signupThenCreatePath } from '../lib/routes'
import { HERO_HEADLINE, HERO_SUPPORT } from '../lib/positioning'
import { useDb, currentUser } from '../store/store'

/** One icon + title + body unit. The words come from the approved page copy. */
function AboutCard({ icon: Icon, title, children, className = '' }: {
  icon: LucideIcon; title: string; children?: ReactNode; className?: string
}) {
  return (
    <Surface as="article" className={`about-card ${className}`.trim()}>
      <span className="about-card-icon"><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
      <div className="about-card-body">
        <h4 className="about-card-title">{title}</h4>
        {children ? <p>{children}</p> : null}
      </div>
    </Surface>
  )
}

/** A status chip. `live` is teal; the next state is an amber outline. */
function StatusChip({ live, children }: { live: boolean; children: ReactNode }) {
  return (
    <span className={live ? 'about-status about-status-live' : 'about-status about-status-next'}>
      {live ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

export function AboutPage() {
  const me = currentUser(useDb())
  const startPath = me ? CREATE_PATH : signupThenCreatePath()
  return (
    <div className="container page-enter yf-page about-page">
      <PageHeader
        className="about-header"
        kicker="About YatraFlow"
        headline={{ lead: HERO_HEADLINE }}
        lede={HERO_SUPPORT}
        meta={(
          <p className="about-intro">
            YatraFlow is a collaborative group trip planner built for how India travels.
            It is also the foundation of the hub we are building for Indian travel creators.
            That hub turns real routes, travelling stats and on-ground experience into a living portfolio.
            Travellers and brands can trust that portfolio.
          </p>
        )}
      />

      <div className="about-hero-art" aria-hidden="true">
        <img className="about-hero-img" src="/art/goa-1.webp" alt="" />
        <div className="about-hero-ribbon">
          <span>Kolkata</span><span aria-hidden="true">→</span>
          <span>Kolaghat</span><span aria-hidden="true">→</span>
          <span>Mandarmani</span>
        </div>
      </div>

      <Surface as="section" className="about-section" aria-labelledby="about-why">
        <h2 className="about-h2" id="about-why">Why we built YatraFlow</h2>
        <p className="about-lead">
          Seven of us tried to plan one beach trip from Kolkata to Mandarmani in a WhatsApp group.
          Everyone had a different idea about the hotel, the stops, and how many days to take.
          Nobody tracked drive times or per-person costs.
        </p>
        <ol className="about-timeline">
          <li>
            <span className="about-step" aria-hidden="true">1</span>
            <p>Months of messages went by.</p>
          </li>
          <li>
            <span className="about-step" aria-hidden="true">2</span>
            <p>A week before we left, a hotel was already booked.</p>
          </li>
          <li>
            <span className="about-step" aria-hidden="true">3</span>
            <p>
              People were still dropping new hotel links in the chat.
              We drove straight there and missed half the stops on the way.
            </p>
          </li>
          <li>
            <span className="about-step" aria-hidden="true">4</span>
            <p>Then we spent three days working out who paid for what.</p>
          </li>
        </ol>
        <p className="about-gap">
          That trip showed us the gap nobody had solved for India.
          Ticket apps handle the booking. Navigation apps get you from A to B.
          Everything in between still dies in screenshots, spreadsheets and endless chat threads:
        </p>
        <div className="about-card-grid about-pain-grid">
          <AboutCard icon={MessageCircle} title="Deciding where to go as a group." />
          <AboutCard icon={Car} title="Checking whether a day’s drive is realistic." />
          <AboutCard icon={CalendarClock} title="Agreeing on stops before the deadline." />
          <AboutCard icon={Wallet} title="Settling every rupee after the trip." />
        </div>
        <p className="about-origin">
          So in late August 2026, two of us from that trip started building YatraFlow.
          We are Hasnain and Shabtab, and we built it to fix our own problem properly.
        </p>
      </Surface>

      <Surface as="section" className="about-section" aria-labelledby="about-today">
        <h2 className="about-h2" id="about-today">What YatraFlow is today</h2>
        <p className="about-lead">
          At its core, YatraFlow is a serious, collaborative group trip planner built for Indian travel.
          Generic AI itineraries guess drive times.
          They send you to places that do not fit in a single day.
          Chat apps scatter decisions across hundreds of unread messages.
          Expense apps live in a separate silo from your itinerary.
        </p>
        <p className="about-gap">
          YatraFlow brings the whole trip into one shared workspace.
          It runs from the first rough estimate to the final settle-up, built around real Indian travel physics:
        </p>
        <div className="about-card-grid about-feature-grid">
          <AboutCard icon={Route} title="One shared plan for road, train, flight and bus trips.">
            Build day-by-day timelines with real stop order, measured road legs and honest drive-hour pacing.
            Night-halt towns, weather forecasts and elevation awareness are part of the plan, not fantasy schedules.
          </AboutCard>
          <AboutCard icon={Gauge} title="See the impact before you change the plan.">
            Every edit previews the delta in road hours, kilometres, rupees and schedule warnings.
            Your group sees the cost before it commits.
          </AboutCard>
          <AboutCard icon={Layers} title="Map views built for actual planning decisions." className="about-card-lenses">
            Switch between four operational lenses, each one a planning question:
            <div className="about-lenses">
              <span className="about-lens"><b>Drive</b>: fatigue and corridor pacing.</span>
              <span className="about-lens"><b>Stay</b>: distance from your base.</span>
              <span className="about-lens"><b>Gap</b>: open slots in your day.</span>
              <span className="about-lens"><b>Fix</b>: spot and repair an overloaded leg.</span>
            </div>
          </AboutCard>
          <AboutCard icon={Users} title="Group decisions that actually end.">
            Run a crew preference quiz and let everyone propose stops.
            Vote on the options and set a closing deadline on each decision.
            Nobody reopens the hotel debate the night before departure.
          </AboutCard>
          <AboutCard icon={IndianRupee} title="Transparent rupee budgets and effortless settle-up.">
            Model Indian fuel economy, rentals, stays, meals and regional cost benchmarks upfront.
            Track real expenses on the road, then settle who owes whom in the fewest payments.
          </AboutCard>
          <AboutCard icon={Smartphone} title="Built for Indian mobile networks and real-world sharing.">
            A fast web app and Android app, with offline support and zero-signup cost calculators.
            One-link join codes and forkable public routes recalculate for another group&rsquo;s dates and headcount.
          </AboutCard>
        </div>
        <p className="about-callout">
          YatraFlow is a planning workspace, not a booking agency.
          We do not push hidden commissions or fake quotes.
          Every number is a transparent, editable estimate, so your group can defend its plan before spending a rupee.
        </p>
      </Surface>

      <Surface as="section" className="about-section" aria-labelledby="about-creators">
        <h2 className="about-h2" id="about-creators">Where we&rsquo;re headed: the travel creator hub</h2>
        <p className="about-lead">
          Great group trips do not start from a blank screen.
          They start from people who have driven the roads and stayed in the homestays.
          Those people know the dead zones and what works on the ground.
        </p>
        <p>
          Thousands of Indian travel creators do that fieldwork every week.
          Today their best work gets buried in a 30-second feed.
          It shrinks to endless itinerary requests, static PDFs and follower counts.
          That tells travellers and brands nothing about real route expertise.
        </p>
        <p>
          We are building YatraFlow to become the home and living travel portfolio for Indian travel creators.
        </p>

        <div className="about-columns">
          <div className="about-column">
            <div className="about-column-head">
              <h3 className="about-h3">What is live for creators today</h3>
              <StatusChip live>Live</StatusChip>
            </div>
            <div className="about-card-grid about-status-grid">
              <AboutCard icon={Store} title="Public creator storefronts and route libraries.">
                Turn the trips you post into clean, interactive, forkable plans.
                Your followers open and adapt them for their own group in one link.
              </AboutCard>
              <AboutCard icon={MapPin} title="Track record and India state coverage.">
                Show your published routes, states covered, total planned kilometres and real route engagement.
                Views and forks sit on one public profile.
              </AboutCard>
              <AboutCard icon={Route} title="Post-to-plan links.">
                Connect your Instagram, YouTube and Threads posts to the exact structured itinerary behind them.
              </AboutCard>
              <AboutCard icon={Layers} title="Evidence-based Creator Rankings.">
                A transparent India leaderboard ranked by how many travellers fork and use a creator&rsquo;s routes.
                No paid boosts and no follower counts decide it.
              </AboutCard>
            </div>
          </div>
          <div className="about-column">
            <div className="about-column-head">
              <h3 className="about-h3">What we are building next</h3>
              <StatusChip live={false}>Building next</StatusChip>
            </div>
            <p>
              As YatraFlow grows, the Creator Hub becomes a proof-backed portfolio and discovery platform.
            </p>
            <div className="about-card-grid about-status-grid">
              <AboutCard icon={MapPin} title="Creators show real travelling credentials.">
                Richer travelling stats, state-by-state route footprints, verified trip portfolios and audience usage data.
                These prove genuine domain expertise, whether you have 2,000 followers or 200,000.
              </AboutCard>
              <AboutCard icon={Compass} title="Travellers find creators by proven routes.">
                Find the person who knows Spiti in winter, Meghalaya on a budget, or Goa with six friends.
                Then copy their timed plan into your own group workspace.
              </AboutCard>
              <AboutCard icon={Users} title="Brands notice creators on real data, not guesswork.">
                Tourism boards, gear makers, stay networks and travel brands get a transparent window into who plans real trips.
                Route coverage, forks and structured portfolios back it, not surface impressions.
              </AboutCard>
              <AboutCard icon={Wallet} title="Direct creator tools come only after the payout infrastructure is final.">
                Compliance and payouts are not ready, so nothing here promises income today.
                Once they are ready, a creator's YatraFlow storefront can carry paid plans.
              </AboutCard>
            </div>
          </div>
        </div>
      </Surface>

      <Surface as="section" className="about-section" aria-labelledby="about-beliefs">
        <h2 className="about-h2" id="about-beliefs">What we believe</h2>
        <ol className="about-beliefs">
          <li>
            <span className="about-principle-no" aria-hidden="true">01</span>
            <div>
              <b>Real logistics beat pretty guesses.</b>
              <p>A good itinerary respects highway fatigue, monsoon roads, check-in buffers and honest per-person budgets.</p>
            </div>
          </li>
          <li>
            <span className="about-principle-no" aria-hidden="true">02</span>
            <div>
              <b>Planning is a group sport.</b>
              <p>One friend must not do two weeks as an unpaid travel agent in a noisy chat. Everyone else chimes in at the last minute.</p>
            </div>
          </li>
          <li>
            <span className="about-principle-no" aria-hidden="true">03</span>
            <div>
              <b>Proof beats follower count.</b>
              <p>A traveller picking a route and a brand picking a creator both care about real routes and real usage.</p>
            </div>
          </li>
          <li>
            <span className="about-principle-no" aria-hidden="true">04</span>
            <div>
              <b>Honesty in every number.</b>
              <p>Every estimate shows its assumptions and stays editable. What is live is clearly live. What is still being built never passes as shipped.</p>
            </div>
          </li>
        </ol>
      </Surface>

      <Surface as="section" className="about-section about-built" aria-labelledby="about-built">
        <h2 className="about-h2" id="about-built">Built in India, in the open</h2>
        <div className="about-founders">
          <div className="about-founder">
            <span className="about-avatar" aria-hidden="true">H</span>
            <div>
              <b>Hasnain Ali</b>
              <span className="about-handle">@gilgMesh98</span>
            </div>
          </div>
          <div className="about-founder">
            <span className="about-avatar about-avatar-alt" aria-hidden="true">S</span>
            <div>
              <b>Shabtab Quaiser</b>
              <span className="about-handle">@shabtabquaiser</span>
            </div>
          </div>
        </div>
        <p>
          YatraFlow is built by two founders in India: <b>Hasnain Ali</b> (@gilgMesh98) and <b>Shabtab Quaiser</b> (@shabtabquaiser).
          We have shipped steadily since late August 2026.
        </p>
        <p>
          You may be organizing a three-day weekend escape with six friends.
          Or you may be building a body of Indian travel routes your audience relies on.
          YatraFlow is built for both.
        </p>
        <div className="about-cta-band">
          <div className="about-ctas">
            <a className="btn btn-primary btn-lg btn-trail" {...appLink(startPath)}>
              Start planning a group trip
              <span className="btn-trail-icon" aria-hidden="true"><InlineIcon icon={ArrowRight} size={15} gap={0} /></span>
            </a>
            <a className="btn btn-outline btn-lg" href="/ladakh-trip-cost-calculator/">
              <InlineIcon icon={Calculator} size={15} gap={6} />Try our free trip cost calculators
            </a>
            <a className="btn btn-saffron btn-lg" {...appLink('/explore')}>
              <InlineIcon icon={Compass} size={15} gap={6} />Explore routes and creator storefronts
            </a>
          </div>
        </div>
      </Surface>
    </div>
  )
}
