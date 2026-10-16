// P7 storefront: a kind chip. Icon plus words, never colour alone.
import type { StorefrontKind } from '../../lib/publicStorefront'
import { KIND_LABEL } from '../../lib/publicStorefront'
import { CatIcon } from '../icons'

// CatIcon speaks the app category names; the storefront kind is their display
// form. '' falls back to the camera glyph, which is the sight shape anyway.
export const KIND_CATEGORY: Record<StorefrontKind, string> = {
  sight: '',
  nature: 'nature',
  food: 'food',
  temple: 'temple',
  museum: 'museum',
  beach: 'beach',
  market: 'shopping',
  outdoors: 'adventure',
  evening: 'event',
  stay: 'hotel',
  travel: 'travel',
}

export function KindChip(p: { kind: StorefrontKind; count: number }): JSX.Element {
  const label = KIND_LABEL[p.kind]
  const text = `${p.count} ${p.count === 1 ? label.one : label.many}`
  return (
    <span className={'sf-chip sf-kind--' + p.kind}>
      <span className="sf-chip-icon" aria-hidden="true">
        <CatIcon category={KIND_CATEGORY[p.kind]} />
      </span>
      <span className="sf-chip-text">{text}</span>
    </span>
  )
}
