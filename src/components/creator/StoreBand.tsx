// ============ Creator storefront — "become a creator" band ============
// Static marketing band from spec F-42. It shows to visitors only; the page
// hides it for the creator's own session. No data, no store, one link.
import { appLink } from '../../lib/appLink'

export function StoreBand() {
  return (
    <section className="container cr-store-band" aria-label="For creators">
      <div className="cr-band">
        <div>
          <p className="cr-store-band-kicker">For creators</p>
          <h2 className="cr-band__title">Plan trips like this?</h2>
          <p className="cr-store-band-body">Publish your routes. Keep them free, or set a price.</p>
        </div>
        <a className="btn btn-lg cr-store-band-btn" {...appLink('/creator-hub')}>Become a creator</a>
      </div>
    </section>
  )
}
