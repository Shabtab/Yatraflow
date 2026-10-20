// ============ APK update notice ============
// One nonmodal, dismissible notice. It never blocks: no focus trap, no
// `aria-modal`, no backdrop, and it takes no focus on appearance. It offers
// Update, which opens the checked download page in the system browser, and
// Later, which holds that version back for a day.
//
// The URL it opens was checked by the decision core first: HTTPS, on an
// approved host, and for this package and channel. Nothing here installs
// anything — the user completes that in their own browser.

import { Download, RefreshCw } from 'lucide-react'
import { openExternal } from '../lib/native'
import { apkUpdateLater } from '../lib/apkUpdateRuntime'
import { useApkUpdateStatus, useUpdateNotice } from '../lib/useApkUpdate'

export function UpdateNotice() {
  const offer = useUpdateNotice()
  const { unavailable } = useApkUpdateStatus()

  if (!offer || unavailable !== null) return null

  return (
    <div className="update-notice" role="status" aria-live="polite" aria-atomic="false">
      <span className="update-notice-icon" aria-hidden="true">
        <Download size={18} />
      </span>
      <div className="update-notice-text">
        <p className="update-notice-title">
          Version {offer.versionName} is available
        </p>
        {offer.notes && <p className="update-notice-notes">{offer.notes}</p>}
      </div>
      <div className="update-notice-actions">
        <a
          className="btn btn-primary btn-sm update-notice-update"
          href={offer.downloadUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            // Inside the Android shell `target="_blank"` goes nowhere; the
            // repo helper routes it through the WebView client to the system
            // browser instead.
            event.preventDefault()
            openExternal(offer.downloadUrl)
          }}
        >
          <RefreshCw size={14} aria-hidden="true" /> Update
        </a>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => apkUpdateLater()}>
          Later
        </button>
      </div>
    </div>
  )
}
