import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUyushmaScope } from '../../contexts/UyushmaScopeContext'
import { usePortalBase } from '../../hooks/usePortalBase'
import { errorMessage } from '../../services/api/client'
import { uyushmaApi } from '../../services/api/uyushmaApi'
import { routeEditorApi } from '../../services/api/routeEditorApi'
import type { RouteDirectionConfig, UyushmaRoute } from '../../types/uyushma'
import './UyushmaOperations.css'

const DIRECTION_TITLES: Record<RouteDirectionConfig['direction'], string> = {
  outbound: 'Borish (A → B)',
  inbound: 'Qaytish (B → A)',
}

function directionState(r: UyushmaRoute): { drawn: number; label: string } {
  const drawn = r.directions.filter((d) => d.is_active).length
  if (drawn === 2) return { drawn, label: 'A ⇄ B chizilgan' }
  if (r.directions.length === 0) return { drawn, label: 'Chizilmagan' }
  return { drawn, label: `${drawn}/2 chizilgan` }
}

export function UyushmaRoutes() {
  const navigate = useNavigate()
  const base = usePortalBase()
  const { uyushmaId, canSwitch, loading: scopeLoading } = useUyushmaScope()

  const [routes, setRoutes] = useState<UyushmaRoute[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<UyushmaRoute | null>(null)

  const editorPath = (routeId?: string) => (routeId ? `${base}/routes/editor/${routeId}` : `${base}/routes/editor`)

  const loadRoutes = useCallback(async () => {
    if (!uyushmaId) {
      setRoutes([])
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    setLoadError(null)
    try {
      setRoutes(await uyushmaApi.getRoutes(uyushmaId))
    } catch (err) {
      setLoadError(errorMessage(err, "Yo'nalishlar yuklanmadi"))
    } finally {
      setIsLoading(false)
    }
  }, [uyushmaId])

  useEffect(() => {
    loadRoutes()
  }, [loadRoutes])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const handleTogglePublish = async (r: UyushmaRoute) => {
    const next = !r.is_active
    if (!next && !window.confirm(`№ ${r.route_number} yo'lovchilardan yashiriladi (qoralamaga o'tadi). Davom etasizmi?`)) return
    setBusyId(r.id)
    setActionError(null)
    try {
      const res = await routeEditorApi.setPublished(Number(r.id), next)
      setRoutes((prev) => prev.map((x) => (x.id === r.id ? { ...x, is_active: res.is_published } : x)))
      setNotice(res.is_published ? `№ ${r.route_number} chop etildi` : `№ ${r.route_number} yashirildi`)
    } catch (err) {
      setActionError(`№ ${r.route_number} ${next ? 'chop etilmadi' : 'yashirilmadi'}: ${errorMessage(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  const handleArchiveRoute = async (r: UyushmaRoute) => {
    if (
      !window.confirm(
        `№ ${r.route_number} arxivlansinmi? Yo'nalish yo'lovchilardan yashiriladi va transportlar undan ajratiladi (tarix saqlanadi).`,
      )
    ) {
      return
    }
    setBusyId(r.id)
    setActionError(null)
    try {
      await uyushmaApi.deleteRoute(uyushmaId ?? '', r.id)
      setRoutes((prev) => prev.filter((x) => x.id !== r.id))
      setNotice(`№ ${r.route_number} arxivlandi`)
    } catch (err) {
      setActionError(`№ ${r.route_number} arxivlanmadi: ${errorMessage(err)}`)
    } finally {
      setBusyId(null)
    }
  }

  const q = searchQuery.trim().toLowerCase()
  const filteredRoutes = routes.filter(
    (r) =>
      !q ||
      r.route_number.toLowerCase().includes(q) ||
      r.route_name.toLowerCase().includes(q) ||
      (r.description ?? '').toLowerCase().includes(q),
  )

  const scopeMissing = canSwitch && !uyushmaId

  return (
    <div className="uyushma-page-container">
      <div className="uyushma-page-header">
        <div className="uyushma-page-header__left">
          <h1>
            <i className="ri-route-line" style={{ color: 'var(--accent-primary)' }} />
            Yo'nalishlar boshqaruvi
          </h1>
          <p>Yo'nalishlar, ularning Borish (A → B) va Qaytish (B → A) yo'llari hamda chop etish holati</p>
        </div>

        <div className="uyushma-page-header__actions">
          <button className="btn-secondary-action" onClick={loadRoutes} disabled={isLoading || !uyushmaId}>
            <i className="ri-refresh-line" />
            Yangilash
          </button>
          <button className="btn-primary-action" onClick={() => navigate(editorPath())} disabled={scopeMissing}>
            <i className="ri-add-line" />
            Yangi yo'nalish
          </button>
        </div>
      </div>

      {scopeMissing && (
        <div className="rule-guard-banner" style={{ marginBottom: '1rem' }}>
          <i className="ri-building-2-line" />
          <div>{scopeLoading ? 'Uyushmalar yuklanmoqda…' : "Uyushma tanlang: yo'nalishlar tanlangan uyushma bo'yicha ko'rsatiladi."}</div>
        </div>
      )}

      {actionError && (
        <div className="rule-conflict-alert" style={{ marginBottom: '1rem' }} role="alert">
          <i className="ri-error-warning-fill" />
          <div style={{ flex: 1 }}>{actionError}</div>
          <button className="btn-table-action" onClick={() => setActionError(null)} title="Yopish">
            <i className="ri-close-line" />
          </button>
        </div>
      )}

      {notice && (
        <div className="rule-guard-banner" style={{ marginBottom: '1rem' }} role="status">
          <i className="ri-checkbox-circle-line" />
          <div>{notice}</div>
        </div>
      )}

      <div className="uyushma-toolbar">
        <div className="uyushma-search-input">
          <i className="ri-search-line" />
          <input
            type="text"
            placeholder="Yo'nalish raqami yoki nomi bo'yicha qidirish..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Jami yo'nalishlar: <strong>{routes.length} ta</strong>
        </div>
      </div>

      <div className="uyushma-table-wrapper">
        <table className="uyushma-table">
          <thead>
            <tr>
              <th>Raqam</th>
              <th>Yo'nalish nomi</th>
              <th>Yo'nalish qismlari</th>
              <th>Transportlar</th>
              <th>Haydovchilar</th>
              <th>Holat</th>
              <th style={{ textAlign: 'right' }}>Amallar</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                  <i className="ri-loader-4-line" style={{ fontSize: '1.5rem', color: 'var(--accent-primary)' }} />
                  <div style={{ marginTop: '0.5rem' }}>Yuklanmoqda...</div>
                </td>
              </tr>
            ) : loadError ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                  <div style={{ color: 'var(--danger)', marginBottom: '0.75rem' }}>
                    <i className="ri-error-warning-line" /> {loadError}
                  </div>
                  <button className="btn-secondary-action" onClick={loadRoutes}>
                    <i className="ri-refresh-line" /> Qayta urinish
                  </button>
                </td>
              </tr>
            ) : filteredRoutes.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-tertiary)' }}>
                  {routes.length === 0 && !scopeMissing
                    ? "Hali yo'nalish yo'q — «Yangi yo'nalish» tugmasi orqali yarating."
                    : "Yo'nalishlar topilmadi."}
                </td>
              </tr>
            ) : (
              filteredRoutes.map((r) => {
                const dirState = directionState(r)
                const busy = busyId === r.id
                return (
                  <tr key={r.id}>
                    <td>
                      <span className="route-number-badge">№ {r.route_number}</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{r.route_name}</div>
                      {r.description && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{r.description}</div>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn-secondary-action"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={() => setSelectedRoute(r)}
                        title="Yo'nalish qismlari tafsilotlari"
                      >
                        <i
                          className={dirState.drawn === 2 ? 'ri-guide-line' : 'ri-error-warning-line'}
                          style={{ color: dirState.drawn === 2 ? undefined : 'var(--warning)' }}
                        />
                        {dirState.label}
                      </button>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{r.assigned_vehicles_count}</span> ta
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{r.assigned_drivers_count}</span> ta
                    </td>
                    <td>
                      <span className={`status-pill ${r.is_active ? 'active' : 'inactive'}`}>
                        <i className="ri-circle-fill" style={{ fontSize: '0.5rem' }} />
                        {r.is_active ? 'Chop etilgan' : 'Qoralama'}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          className="btn-table-action"
                          onClick={() => navigate(editorPath(r.id))}
                          title="Xaritada tahrirlash (Visual Route Editor)"
                        >
                          <i className="ri-map-pin-line" style={{ color: 'var(--accent-primary)' }} />
                        </button>
                        <button
                          className="btn-table-action"
                          onClick={() => handleTogglePublish(r)}
                          disabled={busy}
                          title={r.is_active ? "Yo'lovchilardan yashirish" : 'Chop etish (ikkala yo‘nalish chizilgan bo‘lishi kerak)'}
                        >
                          <i
                            className={busy ? 'ri-loader-4-line' : r.is_active ? 'ri-eye-off-line' : 'ri-check-double-line'}
                            style={{ color: r.is_active ? 'var(--warning)' : 'var(--success)' }}
                          />
                        </button>
                        <button
                          className="btn-table-action danger"
                          onClick={() => handleArchiveRoute(r)}
                          disabled={busy}
                          title="Arxivlash"
                        >
                          <i className="ri-archive-line" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {selectedRoute && (
        <div className="uyushma-modal-overlay" onClick={() => setSelectedRoute(null)}>
          <div className="uyushma-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="uyushma-modal-header">
              <h3>
                <span className="route-number-badge" style={{ marginRight: '0.5rem' }}>
                  № {selectedRoute.route_number}
                </span>
                Yo'nalish qismlari
              </h3>
              <button className="btn-modal-close" onClick={() => setSelectedRoute(null)}>
                <i className="ri-close-line" />
              </button>
            </div>

            <div className="uyushma-modal-body">
              <div className="directions-list">
                {(['outbound', 'inbound'] as const).map((type) => {
                  const dir = selectedRoute.directions.find((d) => d.direction === type)
                  return (
                    <div key={type} className="direction-card">
                      <div>
                        <div className="direction-card__name">
                          <i className={type === 'outbound' ? 'ri-arrow-right-line' : 'ri-arrow-left-line'} />{' '}
                          {DIRECTION_TITLES[type]}
                        </div>
                        {dir ? (
                          <>
                            <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                              {dir.start_name} ➔ {dir.end_name}
                            </div>
                            <div className="direction-card__stats">
                              {dir.distance_km} km • {dir.stops_count} ta nuqta • ~{dir.estimated_duration_min} daqiqa
                            </div>
                          </>
                        ) : (
                          <div className="direction-card__stats">Hali chizilmagan</div>
                        )}
                      </div>
                      <span className={`status-pill ${dir?.is_active ? 'active' : 'inactive'}`}>
                        {dir?.is_active ? 'Geometriya bor' : 'Geometriya yo‘q'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="uyushma-modal-footer">
              <button type="button" className="btn-secondary-action" onClick={() => setSelectedRoute(null)}>
                Yopish
              </button>
              <button type="button" className="btn-primary-action" onClick={() => navigate(editorPath(selectedRoute.id))}>
                <i className="ri-map-2-line" />
                Xaritada tahrirlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
