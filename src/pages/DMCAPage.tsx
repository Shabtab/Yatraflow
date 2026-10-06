// ============ Copyright and DMCA ============
// A static policy page. It carries the report address, what a valid report
// includes, and the repeat-report rule. It reads no store data, so it renders
// for signed-out visitors too.

export function DMCAPage() {
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <h1 className="auth-title">Copyright and DMCA</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          YatraFlow users publish trip plans on this site. A rights holder can
          report content that infringes their copyright.
        </p>
        <p className="small muted">
          Email your report to <a className="text-link" href="mailto:support@yatraflow.app">support@yatraflow.app</a>. A report needs:
        </p>
        <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 1.9, margin: '8px 0' }}>
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
        <p className="small muted" style={{ margin: 0 }}>Our DMCA agent is YatraFlow Support, support@yatraflow.app.</p>
      </div>
    </div>
  )
}
