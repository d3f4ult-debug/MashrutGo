import { useState, type FormEvent } from 'react'
import { useDriverSession } from '../../contexts/DriverSessionContext'
import { driverApi } from '../../services/api/driverApi'
import { errorMessage } from '../../services/api/client'
import { formatSom } from '../../utils/format'
import './DriverDashboard.css'

export function DriverProfile() {
  const { me, loading, error, reload } = useDriverSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [saving, setSaving] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwDone, setPwDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPwError(null)
    setPwDone(false)
    if (next.length < 8) return setPwError('Yangi parol kamida 8 ta belgidan iborat bo‘lishi kerak')
    if (next !== repeat) return setPwError('Yangi parollar mos kelmadi')
    setSaving(true)
    try {
      await driverApi.changePassword(current, next)
      setPwDone(true)
      setCurrent('')
      setNext('')
      setRepeat('')
    } catch (err) {
      setPwError(errorMessage(err, 'Parolni o‘zgartirib bo‘lmadi'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="driver-dashboard">
        <div className="dd-card dd-center">
          <div className="dd-spinner" />
        </div>
      </div>
    )
  }

  if (error || !me) {
    return (
      <div className="driver-dashboard">
        <div className="dd-card dd-center">
          <p>{error ?? 'Ma’lumot topilmadi'}</p>
          <button className="dd-btn dd-btn--secondary" onClick={() => void reload()}>
            Qayta urinish
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="driver-dashboard">
      <section className="dd-card dd-center" style={{ padding: '1.25rem 1rem' }}>
        <div className="dd-route-badge" style={{ borderRadius: '50%', width: '4rem', height: '4rem' }}>
          <i className="ri-user-3-fill" />
        </div>
        <h1 style={{ margin: 0, fontSize: '1.125rem', color: 'var(--text-primary)' }}>{me.fullName}</h1>
        <p className="dd-muted">{me.phone} · Haydovchi</p>
      </section>

      <section className="dd-card">
        <div className="dd-card__head">
          <h2>
            <i className="ri-id-card-line" /> Ma’lumotlar
          </h2>
        </div>
        <div className="dd-kv-row">
          <span>Guvohnoma</span>
          <strong>{me.licenseNumber ?? '—'}</strong>
        </div>
        <div className="dd-kv-row">
          <span>Uyushma</span>
          <strong>{me.uyushma.name}</strong>
        </div>
        <div className="dd-kv-row">
          <span>Dispetcher</span>
          <strong>
            <a className="dd-link" href={`tel:${me.uyushma.phone}`}>
              {me.uyushma.phone}
            </a>
          </strong>
        </div>
      </section>

      <section className="dd-card">
        <div className="dd-card__head">
          <h2>
            <i className="ri-bus-2-line" /> Transport va yo‘nalish
          </h2>
        </div>
        {me.vehicle ? (
          <>
            <div className="dd-kv-row">
              <span>Ichki ID (QR)</span>
              <strong>{me.vehicle.internalId}</strong>
            </div>
            <div className="dd-kv-row">
              <span>Davlat raqami</span>
              <strong>{me.vehicle.plateNumber ?? '—'}</strong>
            </div>
            <div className="dd-kv-row">
              <span>Model / rang</span>
              <strong>{[me.vehicle.model, me.vehicle.color].filter(Boolean).join(' · ') || '—'}</strong>
            </div>
          </>
        ) : (
          <p className="dd-muted">Transport biriktirilmagan.</p>
        )}
        <div className="dd-kv-row">
          <span>Yo‘nalish</span>
          <strong>{me.route ? `${me.route.routeNumber} · ${me.route.name}` : 'Biriktirilmagan'}</strong>
        </div>
        <div className="dd-kv-row">
          <span>Tarif</span>
          <strong>{me.fareUzs !== null ? formatSom(me.fareUzs) : '—'}</strong>
        </div>
        <p className="dd-muted" style={{ fontSize: '0.72rem' }}>
          Transport yoki yo‘nalishni faqat Uyushma o‘zgartiradi (1 haydovchi = 1 transport = 1 yo‘nalish).
        </p>
      </section>

      <form className="dd-card" onSubmit={(e) => void submit(e)}>
        <div className="dd-card__head">
          <h2>
            <i className="ri-lock-password-line" /> Parolni o‘zgartirish
          </h2>
        </div>
        <label className="dd-label" htmlFor="pw-current">
          Joriy parol
        </label>
        <input id="pw-current" className="dd-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <label className="dd-label" htmlFor="pw-new">
          Yangi parol (kamida 8 belgi)
        </label>
        <input id="pw-new" className="dd-input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        <label className="dd-label" htmlFor="pw-repeat">
          Yangi parolni takrorlang
        </label>
        <input id="pw-repeat" className="dd-input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        {pwError && (
          <div className="dd-alert dd-alert--danger" role="alert">
            <i className="ri-error-warning-line" />
            <span>{pwError}</span>
          </div>
        )}
        {pwDone && (
          <div className="dd-alert dd-alert--warning" style={{ background: 'var(--success-subtle)', color: 'var(--success)' }} role="status">
            <i className="ri-check-line" />
            <span>Parol o‘zgartirildi</span>
          </div>
        )}
        <button className="dd-btn dd-btn--primary" type="submit" disabled={saving || !current}>
          {saving ? <span className="dd-spinner dd-spinner--sm" /> : <i className="ri-save-line" />} Saqlash
        </button>
      </form>
    </div>
  )
}
