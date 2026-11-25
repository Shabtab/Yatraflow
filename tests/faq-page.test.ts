// ============ FAQ page and its schema ============
// The page and the FAQPage schema must never disagree: one crawler reading a
// question the reader cannot see is a broken promise in the search result. Both
// read lib/faqContent, and this file proves it from the rendered markup.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FaqPage } from '../src/pages/FaqPage'
import {
  FAQ_DESCRIPTION, FAQ_SECTIONS, FAQ_TITLE, faqEntries, faqJsonLd,
} from '../src/lib/faqContent'
import { pageMeta } from '../src/lib/pageTitle'

const markup = renderToStaticMarkup(createElement(FaqPage))

/** React escapes text nodes, so compare against unescaped text. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, '\u2019')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
}

const visible = plainText(markup)

interface SchemaQuestion {
  '@type': string
  name: string
  acceptedAnswer: { '@type': string; text: string }
}

function schema(): { '@type': string; mainEntity: SchemaQuestion[] } {
  const match = markup.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  expect(match).not.toBeNull()
  return JSON.parse(match![1].replace(/\\u003c/g, '<')) as { '@type': string; mainEntity: SchemaQuestion[] }
}

describe('FAQ schema matches the visible list', () => {
  it('renders one FAQPage block', () => {
    expect(markup.match(/application\/ld\+json/g)).toHaveLength(1)
    expect(schema()['@type']).toBe('FAQPage')
  })

  it('carries a question for every entry a reader can see', () => {
    const questions = schema().mainEntity
    expect(questions).toHaveLength(faqEntries().length)
    for (const question of questions) {
      expect(question['@type']).toBe('Question')
      expect(visible).toContain(question.name)
      expect(visible).toContain(question.acceptedAnswer.text)
    }
  })

  it('renders every question and answer exactly once on screen', () => {
    // The schema repeats each question by design, so this counts the visible
    // half only.
    const body = markup.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '')
    for (const entry of faqEntries()) {
      expect(body.split(entry.question).length - 1).toBe(1)
      expect(body.split(entry.answer).length - 1).toBe(1)
    }
    expect(schema().mainEntity.map(question => question.name)).toEqual(faqEntries().map(entry => entry.question))
  })

  it('groups the answers under their headings', () => {
    for (const section of FAQ_SECTIONS) {
      expect(markup).toContain(`id="${section.id}"`)
      expect(visible).toContain(section.heading)
    }
  })

  it('answers the invite screen anchor: #codes exists', () => {
    expect(markup).toContain('id="codes"')
    expect(markup).toContain('href="#codes"')
  })

  it('never ships a tuple of questions the page would have to duplicate', () => {
    const built = faqJsonLd() as unknown as { mainEntity: Array<{ name: string }> }
    expect(built.mainEntity.map(question => question.name)).toEqual(faqEntries().map(entry => entry.question))
  })
})

describe('FAQ page metadata', () => {
  it('carries the approved title and description', () => {
    expect(FAQ_TITLE).toBe('YatraFlow FAQ · Is it free, who can join, offline use and your data')
    expect(FAQ_DESCRIPTION).toContain('how creator guides are priced')
  })

  it('is the title and description the router applies to /faq', () => {
    expect(pageMeta(['faq'])).toEqual({ title: FAQ_TITLE, description: FAQ_DESCRIPTION })
  })

  it('renders for a signed-out reader: no store or session is read', () => {
    expect(visible).toContain('Frequently asked questions')
    expect(visible).toContain('The questions people ask before they invite their friends.')
  })
})
