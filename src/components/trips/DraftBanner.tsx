// ============ My trips — draft banner ============
// The unfinished trip from the create form, as one dashed row: an icon tile,
// the name, a segmented bar from the create readiness, Continue, and a dismiss.
// The dismiss removes the draft. The page owns that action and its undo toast.
import { PencilLine, X } from 'lucide-react'
import type { Readiness } from '../../lib/createReadiness'

export function DraftBanner({ name, meta, readiness, onContinue, onDismiss }: {
  name: string
  /** The line under the name: stops and when it was saved. */
  meta: string
  /** The readiness the create form already computes. Null draws no bar. */
  readiness: Readiness | null
  onContinue: () => void
  onDismiss: () => void
}) {
  const required = readiness ? readiness.items.filter(item => !item.optional) : []
  return (
    <section className="mt-draft" role="status" aria-label="Draft to finish">
      <span className="mt-draft-tile" aria-hidden="true"><PencilLine size={22} /></span>
      <div className="mt-draft-copy">
        <b className="mt-draft-name">{name}</b>
        <span className="mt-draft-meta">{meta}</span>
      </div>
      {readiness && required.length > 0 && (
        <div
          className="mt-prog mt-draft-bar"
          role="meter"
          aria-label="Draft readiness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={readiness.pct}
          aria-valuetext={`${readiness.pct}% ready`}
        >
          {required.map(item => <i key={item.key} className={item.done ? 'is-full' : undefined} />)}
        </div>
      )}
      <button type="button" className="btn btn-primary btn-sm" onClick={onContinue}>Continue</button>
      <button type="button" className="icon-btn mt-draft-dismiss" aria-label="Dismiss draft" onClick={onDismiss}>
        <X size={16} aria-hidden />
      </button>
    </section>
  )
}
