import { Component } from 'react'

// A crash in one component used to leave an empty screen with nothing to go on.
// This shows what broke, where, and offers a reload. It is deliberately plain:
// it must not depend on anything that might be the thing that failed.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    // Keep it in the console too, in case someone is looking there.
    console.error('IDE crashed while rendering:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    const e = this.state.error
    return (
      <div className="p-6 space-y-3 overflow-auto h-full">
        <p className="text-sm font-semibold text-red-600">The screen stopped rendering</p>
        <p className="text-xs text-muted-foreground">
          Something in the page threw. The message and where it happened are below. Nothing was sent to a server by this.
        </p>
        <pre className="text-[11px] whitespace-pre-wrap rounded border border-border p-3 bg-muted/30">
          {String(e?.message ?? e)}
          {e?.stack ? `\n\n${e.stack}` : ''}
          {this.state.info?.componentStack ? `\n\nRendered at:${this.state.info.componentStack}` : ''}
        </pre>
        <div className="flex items-center gap-2">
          <button onClick={() => location.reload()} className="px-3 py-1.5 text-xs rounded bg-emerald-700 text-white hover:bg-emerald-600">
            Reload
          </button>
          <button onClick={() => this.setState({ error: null, info: null })} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">
            Try again
          </button>
        </div>
      </div>
    )
  }
}
