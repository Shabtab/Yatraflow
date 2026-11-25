// ============ FAQ page ============
// Static, crawler-readable copy: the questions people ask before they invite
// their friends. It reads no store data, so it renders for signed-out visitors,
// and the FAQPage schema is built from the same list the page shows.
import { useEffect } from 'react'
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'
import { FAQ_INTRO_LEAD, FAQ_INTRO_TAIL, FAQ_SECTIONS, faqJsonLd } from '../lib/faqContent'
import { scrollBehavior } from '../lib/motion'
import { currentQuery } from '../lib/router'

/**
 * The FAQPage schema, built with the DOM API so no answer can ever be read as
 * markup: the JSON goes in as text, and leaving the page removes the block.
 */
function FaqSchema() {
  useEffect(() => {
    const script = document.createElement('script')
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(faqJsonLd())
    document.head.appendChild(script)
    return () => { script.remove() }
  }, [])
  return null
}

/** Scroll one section into view under the sticky nav. */
function jumpToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
}

export function FaqPage() {
  // A cross-page link arrives as /faq?section=codes (the invite screen's
  // expired state): a query, never a fragment, because the native shell routes
  // on the hash. The page renders after the address is read, so it scrolls
  // here rather than leaving the browser to guess.
  useEffect(() => {
    const section = currentQuery().get('section')
    if (section) jumpToSection(section)
  }, [])

  return (
    <div className="container page-enter yf-page faq-page">
      <FaqSchema />
      <PageHeader
        headline={{ lead: 'Frequently asked', accent: 'questions' }}
        lede={(
          <>
            {FAQ_INTRO_LEAD}
            <a className="text-link" href="mailto:support@yatraflow.app">mail us</a>
            {FAQ_INTRO_TAIL}
          </>
        )}
        meta={(
          <nav className="faq-jump" aria-label="FAQ sections">
            {FAQ_SECTIONS.map(section => (
              // A button, not an anchor: the router owns the hash, so href="#id"
              // would read as an unknown route in the native shell.
              <button
                key={section.id}
                type="button"
                className="faq-jump-link"
                onClick={() => jumpToSection(section.id)}
              >
                {section.heading}
              </button>
            ))}
          </nav>
        )}
      />
      {FAQ_SECTIONS.map(section => (
        <section key={section.id} id={section.id} className="faq-section" aria-labelledby={`${section.id}-heading`}>
          <h2 id={`${section.id}-heading`} className="faq-heading">{section.heading}</h2>
          <div className="faq-items">
            {section.entries.map(entry => (
              <Surface key={entry.question} as="article" className="faq-item">
                <h3 className="faq-question">{entry.question}</h3>
                <p className="faq-answer">{entry.answer}</p>
              </Surface>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
