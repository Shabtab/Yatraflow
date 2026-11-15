import { useMemo, useState } from 'react'
import { usePublished, useUsers, useSessionUserId, useDb, rereadPublicSlices } from '../store/store'
import { rowsView, sliceState } from '../lib/readState'
import { rankCreators, rankOf } from '../lib/creatorRank'
import { appLink } from '../lib/appLink'
import { TRAVEL_STYLES, type PublishedItinerary, type TravelStyle } from '../data/types'
import { cap } from '../lib/labels'
import { PageHeader } from '../components/page/PageHeader'
import { StateBlock } from '../components/page/StateBlock'
import { FilterChip } from '../components/filters/FilterChip'
import { RankPodium } from '../components/creator/RankPodium'
import { RankTable } from '../components/creator/RankTable'

const TABLE_PAGE_SIZE = 25

/** The styles actually represented by live routes. Chips only ever name
 *  something the filter can find. */
function stylesInLiveRoutes(pubs: PublishedItinerary[]): TravelStyle[] {
  return TRAVEL_STYLES.filter(style => pubs.some(pub => pub.travelStyle === style))
}

export function CreatorRankingsPage() {
  const published = usePublished()
  const users = useUsers()
  const me = useSessionUserId()
  const { sliceReads } = useDb()
  const [style, setStyle] = useState<TravelStyle | undefined>(undefined)
  const [visibleCount, setVisibleCount] = useState(TABLE_PAGE_SIZE)

  const read = sliceState(sliceReads, 'suggested itineraries')
  const retryRead = () => { void rereadPublicSlices() }
  const liveStyles = useMemo(() => stylesInLiveRoutes(published), [published])
  const ranked = useMemo(() => rankCreators(published, users, { style }), [published, users, style])
  const view = rowsView(read, ranked.length)
  const myRank = me ? rankOf(ranked, me) : undefined
  const leadRouteFor = (id: string) => {
    const leadRouteId = ranked.find(row => row.id === id)?.leadRouteId
    return published.find(pub => pub.id === leadRouteId)
  }

  return (
    <div className="container yf-page page-enter cr-rk-page">
      <PageHeader
        kicker="Creator rankings"
        headline={{ lead: 'Most forked', accent: 'creators' }}
        lede="Ranked by forks of live public routes. Ties go to more live routes, then name."
      />

      <div className="cr-card cr-rk-filter" role="group" aria-label="Ranking filters">
        <span className="cr-rk-filter__scope">India · {ranked.length}</span>
        <span className="cr-rk-filter__divider" aria-hidden="true" />
        <div className="cr-rk-filter__chips">
          {liveStyles.map(candidate => (
            <FilterChip
              key={candidate}
              pressed={style === candidate}
              count={rankCreators(published, users, { style: candidate }).length}
              onClick={() => {
                const next = style === candidate ? undefined : candidate
                setStyle(next)
                setVisibleCount(TABLE_PAGE_SIZE)
              }}
            >
              {cap(candidate)}
            </FilterChip>
          ))}
        </div>
      </div>

      {view === 'reading' && (
        <StateBlock kind="loading" titleLevel="h2" title="Loading creator rankings…" body="One moment." />
      )}
      {view === 'failed' && (
        <StateBlock
          kind="failed"
          titleLevel="h2"
          title="Could not load creator rankings."
          body="The request failed, which is not the same as there being no ranked creators. Try again."
          actions={<button type="button" className="btn btn-primary" onClick={retryRead}>Try again</button>}
        />
      )}
      {view === 'empty' && <StateBlock kind="empty" titleLevel="h2" title="No ranked creators yet" />}
      {view === 'kept' && (
        <StateBlock
          kind="kept"
          size="compact"
          title="The latest ranking read failed. Showing the ranking already on screen."
        />
      )}

      {view === 'rows' || view === 'kept' ? (
        <div className="cr-rk-main">
          <div className="cr-rk-podium">
            {ranked.length > 3 && (
              <div className="cr-head">
                <div>
                  <h2 className="cr-head__title">Top three</h2>
                </div>
              </div>
            )}
            <RankPodium rows={ranked.slice(0, 3)} users={users} leadRouteFor={leadRouteFor} />
          </div>
          {myRank && (
            <aside className="cr-card cr-rk-you" aria-labelledby="cr-rk-you-title">
              <h2 id="cr-rk-you-title" className="cr-card__title">Your rank</h2>
              <div className="cr-rk-you__rank">#{myRank.rank} in India</div>
              {myRank.rank !== 1 && (
                <div className="cr-rk-you__gap">
                  {myRank.forksToNext} {myRank.forksToNext === 1 ? 'fork' : 'forks'} to #{myRank.rank - 1}
                </div>
              )}
              <a className="btn btn-primary" {...appLink('/creator-hub')}>Open your creator hub</a>
            </aside>
          )}
        </div>
      ) : null}

      {view === 'rows' || view === 'kept' ? (
        <RankTable
          rows={ranked.slice(3)}
          me={me}
          users={users}
          visibleCount={visibleCount}
          total={ranked.length - 3}
          onShowMore={() => setVisibleCount(count => count + TABLE_PAGE_SIZE)}
        />
      ) : null}

      <section className="cr-card cr-rk-how" aria-labelledby="cr-rk-how-title">
        <h2 id="cr-rk-how-title" className="cr-card__title">How ranking works</h2>
        <ul className="cr-rk-how__list">
          <li>Ranked by forks of live public routes. Ties go to more live routes, then name.</li>
          <li>Only live public routes count.</li>
          <li>Followers on other apps never count.</li>
          <li>No one can pay for a place.</li>
        </ul>
      </section>
    </div>
  )
}
