import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 'var(--space-4)' }}>
          <h1 className="headline-sm">Etwas ist schiefgelaufen.</h1>
          <p className="body-lg">{this.state.error.message}</p>
        </div>
      )
    }
    return this.props.children
  }
}
