import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TripKitHero } from '../src/components/storefront/TripKitHero'

const props = {
  onCover: () => {},
  photo: createElement('img', { src: '/public-cover.jpg', alt: '' }),
  back: 'Explore', kicker: 'Road itinerary', title: 'A real published plan',
  route: 'Jaipur to Jodhpur', facts: ['3 days'], byline: 'Planned by the creator',
  asideLabel: 'Buy this plan', aside: 'Purchase card', tabs: 'Plan views',
} satisfies Parameters<typeof TripKitHero>[0]

describe('published itinerary hero views', () => {
  it('keeps the public cover and purchase card in Look inside', () => {
    const html = renderToStaticMarkup(createElement(TripKitHero, props))
    expect(html).toContain('/public-cover.jpg')
    expect(html).toContain('Purchase card')
    expect(html).not.toContain('pi-ride-mosaic')
  })

  it('keeps the failed-read notice visible when Ride along replaces the purchase cover', () => {
    const html = renderToStaticMarkup(createElement(TripKitHero, {
      ...props,
      ride: {
        photos: [{ index: 0, src: '/readable-day.jpg', title: 'The open day' }],
        notice: createElement('p', { role: 'alert' }, 'Access could not be checked. Retry.'),
      },
    }))
    expect(html).toContain('/readable-day.jpg')
    expect(html).toContain('The open day')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Access could not be checked. Retry.')
    expect(html).not.toContain('/public-cover.jpg')
    expect(html).not.toContain('Purchase card')
  })

  it('keeps an introduction without photos usable without a substitute image', () => {
    const html = renderToStaticMarkup(createElement(TripKitHero, { ...props, ride: { photos: [] } }))
    expect(html).toContain('A real published plan')
    expect(html).toContain('Plan views')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<figure')
    expect(html).not.toContain('pi-ride-mosaic')
  })
})
