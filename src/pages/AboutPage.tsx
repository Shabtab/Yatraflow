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
import { ArrowRight, Calculator, Compass } from 'lucide-react'
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'
import { InlineIcon } from '../components/icons'
import { appLink } from '../lib/appLink'
import { CREATE_PATH, signupThenCreatePath } from '../lib/routes'
import { HERO_HEADLINE, HERO_SUPPORT } from '../lib/positioning'
import { useDb, currentUser } from '../store/store'

export function AboutPage() {
  const me = currentUser(useDb())
  const startPath = me ? CREATE_PATH : signupThenCreatePath()
  return (
    <div className="container page-enter yf-page about-page">
      <PageHeader
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

      <Surface as="section" className="about-section" aria-labelledby="about-why">
        <h2 className="about-h2" id="about-why">Why we built YatraFlow</h2>
        <p>Seven of us tried to plan one beach trip from Kolkata to Mandarmani in a WhatsApp group.</p>
        <p>Months of messages went by.</p>
        <p>Everyone had a different idea about the hotel, the stops, and how many days to take.</p>
        <p>Nobody tracked drive times or per-person costs.</p>
        <p>
          A week before we left, a hotel was already booked.
          People were still dropping new hotel links in the chat.
          We drove straight there and missed half the stops on the way.
          Then we spent three days working out who paid for what.
        </p>
        <p>
          That trip showed us the gap nobody had solved for India.
          Ticket apps handle the booking. Navigation apps get you from A to B.
        </p>
        <p>
          Everything in between still dies in screenshots, spreadsheets and endless chat threads:
        </p>
        <ul className="about-list">
          <li>Deciding where to go as a group.</li>
          <li>Checking whether a day&rsquo;s drive is realistic.</li>
          <li>Agreeing on stops before the deadline.</li>
          <li>Settling every rupee after the trip.</li>
        </ul>
        <p>
          So in late August 2026, two of us from that trip started building YatraFlow.
          We are Hasnain and Shabtab, and we built it to fix our own problem properly.
        </p>
      </Surface>

      <Surface as="section" className="about-section" aria-labelledby="about-today">
        <h2 className="about-h2" id="about-today">What YatraFlow is today</h2>
        <p>
          At its core, YatraFlow is a serious, collaborative group trip planner built for Indian travel.
          Generic AI itineraries guess drive times.
          They send you to places that do not fit in a single day.
          Chat apps scatter decisions across hundreds of unread messages.
          Expense apps live in a separate silo from your itinerary.
        </p>
        <p>
          YatraFlow brings the whole trip into one shared workspace.
          It runs from the first rough estimate to the final settle-up, built around real Indian travel physics:
        </p>
        <ul className="about-list about-list-features">
          <li>
            <b>One shared plan for road, train, flight and bus trips.</b>
            Build day-by-day timelines with real stop order, measured road legs and honest drive-hour pacing.
            Night-halt towns, weather forecasts and elevation awareness are part of the plan, not fantasy schedules.
          </li>
          <li>
            <b>See the impact before you change the plan.</b>
            Every edit previews the delta in road hours, kilometres, rupees and schedule warnings.
            Your group sees the cost before it commits.
          </li>
          <li>
            <b>Map views built for actual planning decisions.</b>
            Switch between four operational lenses, each one a planning question:
            <ul className="about-sublist">
              <li><b>Drive</b>: fatigue and corridor pacing.</li>
              <li><b>Stay</b>: distance from your base.</li>
              <li><b>Gap</b>: open slots in your day.</li>
              <li><b>Fix</b>: spot and repair an overloaded leg.</li>
            </ul>
          </li>
          <li>
            <b>Group decisions that actually end.</b>
            Run a crew preference quiz and let everyone propose stops.
            Vote on the options and set a closing deadline on each decision.
            Nobody reopens the hotel debate the night before departure.
          </li>
          <li>
            <b>Transparent rupee budgets and effortless settle-up.</b>
            Model Indian fuel economy, rentals, stays, meals and regional cost benchmarks upfront.
            Track real expenses on the road, then settle who owes whom in the fewest payments.
          </li>
          <li>
            <b>Built for Indian mobile networks and real-world sharing.</b>
            A fast web app and Android app, with offline support and zero-signup cost calculators.
            One-link join codes and forkable public routes recalculate for another group&rsquo;s dates and headcount.
          </li>
        </ul>
        <p className="about-callout">
          YatraFlow is a planning workspace, not a booking agency.
          We do not push hidden commissions or fake quotes.
          Every number is a transparent, editable estimate, so your group can defend its plan before spending a rupee.
        </p>
      </Surface>

      <Surface as="section" className="about-section" aria-labelledby="about-creators">
        <h2 className="about-h2" id="about-creators">Where we&rsquo;re headed: the travel creator hub</h2>
        <p>
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

        <h3 className="about-h3">What is live for creators today</h3>
        <ul className="about-list">
          <li>
            <b>Public creator storefronts and route libraries.</b>
            Turn the trips you post into clean, interactive, forkable plans.
            Your followers open and adapt them for their own group in one link.
          </li>
          <li>
            <b>Track record and India state coverage.</b>
            Show your published routes, states covered, total planned kilometres and real route engagement.
            Views and forks sit on one public profile.
          </li>
          <li>
            <b>Post-to-plan links.</b>
            Connect your Instagram, YouTube and Threads posts to the exact structured itinerary behind them.
          </li>
          <li>
            <b>Evidence-based Creator Rankings.</b>
            A transparent India leaderboard ranked by how many travellers fork and use a creator&rsquo;s routes.
            No paid boosts and no follower counts decide it.
          </li>
        </ul>

        <h3 className="about-h3">What we are building next</h3>
        <p>
          As YatraFlow grows, the Creator Hub becomes a proof-backed portfolio and discovery platform.
        </p>
        <ul className="about-list">
          <li>
            <b>Creators show real travelling credentials.</b>
            Richer travelling stats, state-by-state route footprints, verified trip portfolios and audience usage data.
            These prove genuine domain expertise, whether you have 2,000 followers or 200,000.
          </li>
          <li>
            <b>Travellers find creators by proven routes.</b>
            Find the person who knows Spiti in winter, Meghalaya on a budget, or Goa with six friends.
            Then copy their timed plan into your own group workspace.
          </li>
          <li>
            <b>Brands notice creators on real data, not guesswork.</b>
            Tourism boards, gear makers, stay networks and travel brands get a transparent window into who plans real trips.
            Route coverage, forks and structured portfolios back it, not surface impressions.
          </li>
          <li>
            <b>Direct creator tools come only after the payout infrastructure is final.</b>
            Compliance and payouts are not ready, so nothing here promises income today.
            Once they are ready, a creator's YatraFlow storefront can carry paid plans.
          </li>
        </ul>
      </Surface>

      <Surface as="section" className="about-section" aria-labelledby="about-beliefs">
        <h2 className="about-h2" id="about-beliefs">What we believe</h2>
        <ol className="about-beliefs">
          <li>
            <b>Real logistics beat pretty guesses.</b>
            A good itinerary respects highway fatigue, monsoon roads, check-in buffers and honest per-person budgets.
          </li>
          <li>
            <b>Planning is a group sport.</b>
            One friend must not do two weeks as an unpaid travel agent in a noisy chat.
            Everyone else chimes in at the last minute.
          </li>
          <li>
            <b>Proof beats follower count.</b>
            A traveller picking a route and a brand picking a creator both care about real routes and real usage.
          </li>
          <li>
            <b>Honesty in every number.</b>
            Every estimate shows its assumptions and stays editable.
            What is live is clearly live.
            What is still being built never passes as shipped.
          </li>
        </ol>
      </Surface>

      <Surface as="section" className="about-section about-built" aria-labelledby="about-built">
        <h2 className="about-h2" id="about-built">Built in India, in the open</h2>
        <p>
          YatraFlow is built by two founders in India: <b>Hasnain Ali</b> (@gilgMesh98) and <b>Shabtab Quaiser</b> (@shabtabquaiser).
          We have shipped steadily since late August 2026.
        </p>
        <p>
          You may be organizing a three-day weekend escape with six friends.
          Or you may be building a body of Indian travel routes your audience relies on.
          YatraFlow is built for both.
        </p>
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
      </Surface>
    </div>
  )
}
