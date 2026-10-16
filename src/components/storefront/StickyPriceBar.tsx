// P7 storefront: the fixed price bar. Hidden means aria-hidden and no tab stop.
export function StickyPriceBar(p: {
  visible: boolean
  priceLabel: string
  ctaLabel: string
  mode: 'unlock' | 'fork'
  onCta: () => void
}): JSX.Element {
  return (
    <div className={'sf-sticky' + (p.visible ? ' is-visible' : '')} aria-hidden={!p.visible}>
      <span className="sf-sticky-price">{p.priceLabel}</span>
      <button
        className={'sf-sticky-cta' + (p.mode === 'fork' ? ' sf-sticky-cta--fork' : '')}
        type="button"
        tabIndex={p.visible ? 0 : -1}
        onClick={p.onCta}
      >
        {p.ctaLabel}
      </button>
    </div>
  )
}
