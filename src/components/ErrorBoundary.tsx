// ============ Error boundary ============
// Catches render-time crashes and shows a recovery UI instead of a blank page.
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('YatraFlow crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="container empty-state" style={{ paddingTop: 80 }}>
          <div className="big">⚠️</div>
          <h2>Something went wrong</h2>
          <p className="muted small" style={{ maxWidth: 480, margin: '8px auto' }}>
            {this.state.error.message}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
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
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
