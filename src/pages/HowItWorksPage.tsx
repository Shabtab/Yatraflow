// ============ How it works page ============
// Static, crawler-readable copy: six steps from a rough budget to a settled
// trip, what the product does not do, and the closing calls to action. It reads
// no store data, so it renders for signed-out visitors.
import { PageHeader } from '../components/page/PageHeader'
import { appLink } from '../lib/appLink'
import { isNative } from '../lib/native'
import {
  BRAND_LINE_MAIN, BRAND_LINE_SUPPORT,
  HOW_IT_WORKS_CTAS, HOW_IT_WORKS_INTRO, HOW_IT_WORKS_LIMITS, HOW_IT_WORKS_STEPS,
} from '../lib/howItWorksContent'

export function HowItWorksPage() {
  // The web's calculator is the Plan Bench on the landing page. The installed
  // app has no calculator surface, so those two actions stay off native.
  const showCalculator = !isNative
  return (
    <div className="container page-enter yf-page hiw-page">
      <PageHeader
        headline={{ lead: 'How YatraFlow', accent: 'works' }}
        lede={HOW_IT_WORKS_INTRO}
      />
      <ol className="hiw-steps">
        {HOW_IT_WORKS_STEPS.map((step, index) => (
          <li key={step.title} className="hiw-step">
            <span className="hiw-step-number" aria-hidden="true">{index + 1}</span>
            <h2 className="hiw-step-title">{step.title}</h2>
            <p className="hiw-step-body">{step.body}</p>
            {step.link && (!step.link.webCalculator || showCalculator) ? (
              <a className="hiw-step-link text-link" {...appLink(step.link.href)}>{step.link.label} →</a>
            ) : null}
          </li>
        ))}
      </ol>
      <section className="hiw-limits" aria-labelledby="hiw-limits-heading">
        <h2 id="hiw-limits-heading" className="hiw-limits-title">What it doesn’t do</h2>
        {HOW_IT_WORKS_LIMITS.map(paragraph => (
          <p key={paragraph} className="hiw-limits-body">{paragraph}</p>
        ))}
      </section>
      <section className="hiw-close" aria-labelledby="hiw-close-heading">
        <h2 id="hiw-close-heading" className="hiw-close-line">{BRAND_LINE_MAIN}</h2>
        <p className="hiw-close-support">{BRAND_LINE_SUPPORT}</p>
        <div className="hiw-close-actions">
          {HOW_IT_WORKS_CTAS.filter(cta => !cta.webCalculator || showCalculator).map((cta, index) => (
            <a
              key={cta.label}
              className={index === 0 ? 'btn btn-primary' : 'btn btn-outline'}
              {...appLink(cta.href)}
            >
              {cta.label}
            </a>
          ))}
        </div>
      </section>
    </div>
  )
}
