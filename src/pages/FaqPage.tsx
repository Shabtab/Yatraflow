// ============ FAQ page ============
// Static, crawler-readable copy: the questions people ask before they invite
// their friends. It reads no store data, so it renders for signed-out visitors,
// and the FAQPage schema is built from the same list the page shows.
import { useEffect } from 'react'
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'
import { FAQ_INTRO_LEAD, FAQ_INTRO_TAIL, FAQ_SECTIONS, faqJsonLd } from '../lib/faqContent'
import { scrollBehavior } from '../lib/motion'

/** The schema block. `<` is escaped so no answer can close the script tag. */
function FaqSchema() {
  const json = JSON.stringify(faqJsonLd()).replace(/</g, '\\u003c')
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}

export function FaqPage() {
  // A link may arrive as /faq#codes from the invite screen's expired state.
  // The hash is not a route, so the browser cannot scroll to it before the
  // page renders; this scrolls once it has.
  useEffect(() => {
    const scrollToHash = () => {
      const raw = location.hash
      const id = raw.charAt(0) === '#' ? raw.slice(1) : raw
      if (!id) return
      document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
    }
    scrollToHash()
    window.addEventListener('hashchange', scrollToHash)
    return () => window.removeEventListener('hashchange', scrollToHash)
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
              <a key={section.id} className="faq-jump-link" href={`#${section.id}`}>{section.heading}</a>
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
