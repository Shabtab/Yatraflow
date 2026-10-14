// ============ Error boundary ============
// Catches render-time crashes and shows a recovery UI instead of a blank page.
// One class of crash is NOT a bug: a deploy replaces the hashed lazy chunks
// while an already-open tab still runs the old shell, so its next lazy import
// (BoardView, the map, any page chunk) 404s with "Failed to fetch dynamically
// imported module". The browser's module map caches the failed fetch, so
// "Try again" can never recover — the only cure is one full reload, which the
// boundary now performs automatically (once, guarded against reload loops).
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { clearLocalAppData, LOCAL_DATA_NOTE } from '../lib/localData'
import { StateBlock } from './page/StateBlock'

const RELOAD_FLAG = 'yf-chunk-reload'

/** True when the error is a stale-deploy lazy-chunk load failure (message
 *  wording differs per browser engine). */
function isStaleChunkError(error: Error | null): boolean {
  if (!error) return false
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|dynamically imported module/i
    .test(error.message)
}

/** The stale-chunk reload decision as a pure function of the session flag.
 *  The loop guarantee must be testable in a node env (AGENTS §1: no DOM).
 *  One-shot per TAB SESSION: the first stale-chunk crash in a tab reloads,
 *  and any later one lands on the fallback below, whose "Reload the app"
 *  button clears the flag so a deliberate reload re-arms. (An earlier version
 *  cleared the flag on mount instead. React runs componentDidMount before the
 *  componentDidCatch callback in the same commit — every page life disarmed
 *  the guard before reading it.) */
export function chunkReloadAction(reloadFlagPresent: boolean): 'reload' | 'fallback' {
  return reloadFlagPresent ? 'fallback' : 'reload'
}

interface Props { children: ReactNode }
interface State {
  error: Error | null
  /** The clear-saved-data step. It used to be a single click on the PRIMARY
   *  button, and it removed a key nothing writes, so the app's most destructive
   *  control was both unguarded and inert. */
  confirming: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, confirming: false }

  static getDerivedStateFromError(error: Error): State {
    return { error, confirming: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('YatraFlow crashed:', error, info.componentStack)
    // A deploy shipped while this tab was open: its old shell now imports
    // chunk hashes that no longer exist. Reload once into the fresh deploy —
    // any further occurrence in this tab session lands on the fallback
    // instead of a second automatic reload, so a recurring failure (offline,
    // or a poisoned cache entry) can never loop.
    if (isStaleChunkError(error)) {
      let flagPresent = false
      try { flagPresent = sessionStorage.getItem(RELOAD_FLAG) === '1' } catch { /* private mode */ }
      if (chunkReloadAction(flagPresent) === 'reload') {
        try { sessionStorage.setItem(RELOAD_FLAG, '1') } catch { /* ignore */ }
        location.reload()
      }
    }
  }

  render() {
    if (this.state.error) {
      const staleChunk = isStaleChunkError(this.state.error)
      const { confirming } = this.state
      // A render error stays a failed state with its recovery actions. It never renders as empty (rule R23).
      const body = confirming
        ? <>{this.state.error.message}<br /><br />{LOCAL_DATA_NOTE}</>
        : staleChunk ? 'A new version shipped while this page was open — one reload picks it up.' : this.state.error.message
      let actions: ReactNode
      if (confirming) {
        actions = (
          <>
            <button
              className="btn btn-danger"
              onClick={async () => {
                await clearLocalAppData()
                location.reload()
              }}
            >
              Clear and reload
            </button>
            <button className="btn btn-outline" onClick={() => this.setState({ confirming: false })}>Cancel</button>
          </>
        )
      } else if (staleChunk) {
        actions = (
          <button
            className="btn btn-primary"
            onClick={() => {
              try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* ignore */ }
              location.reload()
            }}
          >
            Reload the app
          </button>
        )
      } else {
        actions = (
          <>
            <button className="btn btn-outline" onClick={() => this.setState({ error: null, confirming: false })}>Try again</button>
            <button className="btn btn-outline" onClick={() => this.setState({ confirming: true })}>Clear saved data…</button>
          </>
        )
      }
      return (
        <div className="container" style={{ paddingTop: 80 }}>
          <StateBlock
            kind="failed"
            titleLevel="h2"
            icon={<TriangleAlert size={38} aria-hidden />}
            title={staleChunk ? 'YatraFlow was just updated' : 'Something went wrong'}
            body={body}
            actions={actions}
          />
        </div>
      )
    }
    return this.props.children
  }
}

