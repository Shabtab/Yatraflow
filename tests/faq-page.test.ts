// ============ FAQ page and its schema ============
// The page and the FAQPage schema must never disagree: one crawler reading a
// question the reader cannot see is a broken promise in the search result. Both
// read lib/faqContent, and this file proves it from the rendered markup.
import { readFileSync } from 'node:fs'
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

const schema = faqJsonLd() as unknown as { '@type': string; mainEntity: SchemaQuestion[] }
const pageSource = readFileSync(new URL('../src/pages/FaqPage.tsx', import.meta.url), 'utf8')

describe('FAQ schema matches the visible list', () => {
  it('is a FAQPage with one question per visible entry', () => {
    expect(schema['@type']).toBe('FAQPage')
    expect(schema.mainEntity).toHaveLength(faqEntries().length)
    expect(schema.mainEntity.map(question => question.name)).toEqual(faqEntries().map(entry => entry.question))
  })

  it('carries a question and answer a reader can see on the page', () => {
    for (const question of schema.mainEntity) {
      expect(question['@type']).toBe('Question')
      expect(question.acceptedAnswer['@type']).toBe('Answer')
      expect(visible).toContain(question.name)
      expect(visible).toContain(question.acceptedAnswer.text)
    }
  })

  it('renders every question and answer exactly once on screen', () => {
    for (const entry of faqEntries()) {
      expect(markup.split(entry.question).length - 1).toBe(1)
      expect(markup.split(entry.answer).length - 1).toBe(1)
    }
  })

  it('mounts the schema from that same list, as text the browser cannot read as markup', () => {
    expect(pageSource).toContain('<FaqSchema />')
    expect(pageSource).toContain('JSON.stringify(faqJsonLd())')
    expect(pageSource).toContain("script.textContent =")
    expect(pageSource).not.toContain('dangerouslySetInnerHTML')
  })

  it('groups the answers under their headings', () => {
    for (const section of FAQ_SECTIONS) {
      expect(markup).toContain(`id="${section.id}"`)
      expect(visible).toContain(section.heading)
    }
  })

  it('answers the invite screen: the codes section is reachable and scrollable', () => {
    expect(markup).toContain('id="codes"')
    // A button, never href="#codes": the native shell routes on the hash.
    expect(markup).toContain('type="button"')
    expect(markup).not.toContain('href="#codes"')
    expect(pageSource).toContain("currentQuery().get('section')")
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
