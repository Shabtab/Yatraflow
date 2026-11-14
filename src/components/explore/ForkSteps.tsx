// ============ Explore — how forking works ============
// "Fork" is the product's own word for copying a plan into your trips and the
// cards never explain it, so it is said once, here, in the side column. Three
// numbered steps and one note. Signed out, the Fork button goes to /auth, so
// the note says so before the click, not in a toast that the redirect swallows.
import { useId } from 'react'

export function ForkSteps({ signedIn }: { signedIn: boolean }) {
  const titleId = useId()
  return (
    <section className="ex-panel ex-forksteps" aria-labelledby={titleId}>
      <h2 className="ex-panel-title" id={titleId}>How forking works</h2>
      <ol className="ex-steps">
        <li><span><b>Pick</b> a plan you like</span></li>
        <li><span><b>Fork</b> it into your trips</span></li>
        <li><span><b>Change</b> days, stays and stops</span></li>
      </ol>
      <p className="ex-forksteps-note">
        The creator’s plan never changes. Paid plans open fully once you buy, then fork the same way.
        {!signedIn && <> You’ll need a free account to fork trips.</>}
      </p>
    </section>
  )
}
