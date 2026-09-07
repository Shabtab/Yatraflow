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

const RELOAD_FLAG = 'yf-chunk-reload'

/** True when the error is a stale-deploy lazy-chunk load failure (message
 *  wording differs per browser engine). */
function isStaleChunkError(error: Error | null): boolean {
  if (!error) return false
  return /failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module|dynamically imported module/i
    .test(error.message)
}

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('YatraFlow crashed:', error, info.componentStack)
    // A deploy shipped while this tab was open: its old shell now imports
    // chunk hashes that no longer exist. Reload once into the fresh deploy —
    // a session flag prevents a reload loop if the reload itself fails.
    if (isStaleChunkError(error)) {
      let alreadyReloaded = false
      try { alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1' } catch { /* private mode */ }
      if (!alreadyReloaded) {
        try { sessionStorage.setItem(RELOAD_FLAG, '1') } catch { /* ignore */ }
        location.reload()
      }
    }
  }

  componentDidMount() {
    // A clean mount (full page load) re-arms the one-shot reload guard.
    try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* ignore */ }
  }

  render() {
    if (this.state.error) {
      const staleChunk = isStaleChunkError(this.state.error)
      return (
        <div className="container empty-state" style={{ paddingTop: 80 }}>
          <div className="big">⚠️</div>
          <h2>{staleChunk ? 'YatraFlow was just updated' : 'Something went wrong'}</h2>
          <p className="muted small" style={{ maxWidth: 480, margin: '8px auto' }}>
            {staleChunk
              ? 'A new version shipped while this page was open — one reload picks it up.'
              : this.state.error.message}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            {staleChunk
              ? (
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
              : (
                  <>
                    <button className="btn btn-outline" onClick={() => this.setState({ error: null })}>Try again</button>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        localStorage.removeItem('yatraflow_db_v1')
                        location.reload()
                      }}
                    >
                      Reset app data & reload
                    </button>
                  </>
                )}
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

