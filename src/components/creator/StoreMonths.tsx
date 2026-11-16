import { bestMonthIndexes, ROUTE_MONTHS, routeMonthName } from '../../lib/creatorFacts'

export function StoreMonths({ mask, month }: { mask: number | undefined; month: number }) {
  const best = bestMonthIndexes(mask)
  if (!best.length) return null
  return <div className="cr-store-months" role="img" aria-label={`Best months: ${best.map(index => routeMonthName(index)).join(', ')}`}>
    {ROUTE_MONTHS.map((label, index) => <span key={label} aria-hidden="true"
      data-best={best.includes(index)} data-current={index === month} title={label}>{label[0]}</span>)}
  </div>
}
