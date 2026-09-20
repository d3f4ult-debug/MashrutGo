import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Last line of defence around the routed portals.
 *
 * The staff portals are code-split, so a chunk can fail to load long after the first paint: an old
 * tab open across a deploy, a dropped connection mid-navigation. Without a boundary React unmounts
 * the whole tree and the driver is left on a blank screen with no way back.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sahifani ochib bo‘lmadi', error, info.componentStack)
  }

  private readonly reload = () => {
    // A stale chunk reference only clears with a real reload
    window.location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    const isChunkError = /chunk|dynamically imported module|Failed to fetch/i.test(error.message)
    return (
      <div className="loading-screen" role="alert">
        <i className="ri-error-warning-line" style={{ fontSize: '2rem', color: 'var(--danger)' }} />
        <h2 style={{ margin: '0.75rem 0 0.25rem' }}>Sahifani ochib bo‘lmadi</h2>
        <p style={{ maxWidth: '28rem', textAlign: 'center' }}>
          {isChunkError
            ? 'Ilova yangilangan yoki aloqa uzilgan. Sahifani qayta yuklang.'
            : 'Kutilmagan xatolik yuz berdi. Sahifani qayta yuklang yoki bosh sahifaga qayting.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn-primary-action" onClick={this.reload}>
            <i className="ri-refresh-line" /> Qayta yuklash
          </button>
          <a className="btn-secondary-action" href="/">
            <i className="ri-home-4-line" /> Bosh sahifa
          </a>
        </div>
      </div>
    )
  }
}
