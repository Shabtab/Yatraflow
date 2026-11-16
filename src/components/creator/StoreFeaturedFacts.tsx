import type { PublishedItinerary } from '../../data/types'
import { formatInr } from '../../lib/engine'
import { StoreMonths } from './StoreMonths'
import { StoreRouteStamp } from './StoreRouteStamp'
import { countNoun } from '../../lib/creatorCopy'

export function StoreFeaturedFacts({ pub, month, showMonths }: { pub: PublishedItinerary; month: number; showMonths: boolean }) {
  return <>
    <p className="cr-store-feature-summary">{countNoun(pub.durationDays, 'day')} · {countNoun(pub.copies, 'fork')}</p>
    <dl className="cr-store-prices">
      <div className={pub.premiumPriceInr ? 'cr-store-price cr-store-price--paid' : 'cr-store-price'}>
        <dt>Plan price</dt>
        <dd>{pub.premiumPriceInr ? formatInr(pub.premiumPriceInr) : 'Free'}</dd>
        <span>{pub.premiumPriceInr ? 'One payment' : 'Free to read'}</span>
      </div>
      <div className="cr-store-price">
        <dt>Estimated trip cost</dt>
        <dd>{formatInr(pub.estimatedBudgetPerPersonInr)}</dd>
        <span>Per person · Creator estimate</span>
      </div>
    </dl>
    <div className="cr-store-route-facts">
      {pub.bestSeason && <p className="cr-store-season">{pub.bestSeason}</p>}
      {showMonths && <StoreMonths mask={pub.bestMonths} month={month} />}
      <StoreRouteStamp pub={pub} />
    </div>
  </>
}
