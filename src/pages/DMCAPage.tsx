// ============ Copyright and DMCA ============
// A static policy page. It carries the report address, what a valid report
// includes, and the repeat-report rule. It reads no store data, so it renders
// for signed-out visitors too.
import { PageHeader } from '../components/page/PageHeader'
import { Surface } from '../components/page/Surface'

export function DMCAPage() {
  return (
    <div className="container page-enter yf-page dmca-page">
      <PageHeader
        headline={{ lead: 'Copyright and DMCA' }}
        lede="A rights holder can report content that infringes their copyright."
      />
      <Surface className="dmca-body">
        <p className="small muted dmca-introduction">
          YatraFlow users publish trip plans on this site.
        </p>
        <p className="small muted">
          Email your report to <a className="text-link" href="mailto:support@yatraflow.app">support@yatraflow.app</a>. A report needs:
        </p>
        <ul className="small muted dmca-report-requirements">
          <li>The name of the work you own</li>
          <li>The address of the content on this site</li>
          <li>Your contact details</li>
          <li>A statement of your good-faith belief</li>
          <li>Your signature</li>
        </ul>
        <p className="small muted">
          We remove content named in a valid report. We send the report to the
          account that posted the content. That account can send a counter notice.
          Accounts that get repeat valid reports lose access.
        </p>
        <hr className="divider" />
        {/* Update this line with the registered agent's name and address after
            US Copyright Office registration. */}
        <p className="small muted dmca-agent-contact">Our DMCA agent is YatraFlow Support, support@yatraflow.app.</p>
      </Surface>
    </div>
  )
}
