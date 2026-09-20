import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDriverSession } from '../../contexts/DriverSessionContext'
import { driverApi } from '../../services/api/driverApi'
import { errorMessage } from '../../services/api/client'
import { driverChannel } from '../../services/realtime/websocket'
import { useChannelEvent } from '../../hooks/useRealtime'
import { formatSom, formatTime, timeAgo } from '../../utils/format'
import type { DirectionType, DriverBalance } from '../../types/driver'
import './DriverDashboard.css'

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h ? `${h} soat ${m} daq` : `${m} daq`
}

export function DriverDashboard() {
  const { me, loading, error, shift, gps, waiting, parking, busy, reload, startShift, endShift, switchDirection, syncNow } =
    useDriverSession()
  const now = useNow(15_000)
  const [direction, setDirection] = useState<DirectionType>('outbound')
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [endNote, setEndNote] = useState('')
  const [balance, setBalance] = useState<DriverBalance | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)

  const loadBalance = useCallback(() => {
    driverApi
      .balance()
      .then((b) => {
        setBalance(b)
        setBalanceError(null)
      })
      .catch((err) => setBalanceError(errorMessage(err)))
  }, [])

  useEffect(() => {
    loadBalance()
  }, [loadBalance, shift?.id])
  useChannelEvent(driverChannel, 'payment.received', loadBalance)
  useChannelEvent(driverChannel, 'payment.refunded', loadBalance)

  const run = async (fn: () => Promise<void>) => {
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError(errorMessage(err, 'Amalni bajarib bo‘lmadi'))
    }
  }

  if (loading) {
    return (
      <div className="driver-dashboard">
        <div className="dd-card dd-center">
          <div className="dd-spinner" />
          <p>Ma’lumotlar yuklanmoqda…</p>
        </div>
      </div>
    )
  }

  if (error || !me) {
    return (
      <div className="driver-dashboard">
        <div className="dd-card dd-center">
          <i className="ri-error-warning-line dd-big-icon dd-danger" />
          <p>{error ?? 'Ma’lumot topilmadi'}</p>
          <button className="dd-btn dd-btn--secondary" onClick={() => void reload()}>
            <i className="ri-refresh-line" /> Qayta urinish
          </button>
        </div>
      </div>
    )
  }

  const route = me.route
  const outbound = route?.directions.find((d) => d.type === 'outbound')
  const inbound = route?.directions.find((d) => d.type === 'inbound')
  const directionLabel = (d: DirectionType) => {
    const dir = d === 'outbound' ? outbound : inbound
    return dir ? `${dir.originName} → ${dir.destinationName}` : d === 'outbound' ? 'Borish (A → B)' : 'Qaytish (B → A)'
  }
  const canStart = Boolean(me.vehicle && route)

  return (
    <div className="driver-dashboard">
      {/* ── Assignment ── */}
      <section className="dd-card">
        <div className="dd-assignment">
          <div className="dd-route-badge">{route?.routeNumber ?? '—'}</div>
          <div className="dd-assignment__text">
            <h1>{route ? route.name : 'Yo‘nalish biriktirilmagan'}</h1>
            <p>
              {me.vehicle
                ? [me.vehicle.plateNumber, me.vehicle.model, me.vehicle.internalId].filter(Boolean).join(' · ')
                : 'Transport biriktirilmagan'}
            </p>
          </div>
        </div>
        <div className="dd-kv-row">
          <span>Tarif</span>
          <strong>{me.fareUzs !== null ? formatSom(me.fareUzs) : 'Belgilanmagan'}</strong>
        </div>
        <div className="dd-kv-row">
          <span>Uyushma</span>
          <strong>
            {me.uyushma.name}{' '}
            <a href={`tel:${me.uyushma.phone}`} className="dd-link">
              <i className="ri-phone-line" />
            </a>
          </strong>
        </div>
        {!canStart && (
          <div className="dd-alert dd-alert--warning">
            <i className="ri-information-line" />
            <span>
              Sizga {me.vehicle ? 'yo‘nalish' : 'transport'} biriktirilmagan. Smenani boshlash uchun Uyushma dispetcheriga murojaat qiling:{' '}
              <a href={`tel:${me.uyushma.phone}`}>{me.uyushma.phone}</a>
            </span>
          </div>
        )}
      </section>

      {actionError && (
        <div className="dd-alert dd-alert--danger" role="alert">
          <i className="ri-error-warning-fill" />
          <span>{actionError}</span>
        </div>
      )}

      {/* ── Shift control ── */}
      <section className="dd-card">
        <div className="dd-card__head">
          <h2>
            <i className="ri-steering-2-line" /> Smena
          </h2>
          <span className={`dd-pill ${shift ? 'dd-pill--ok' : ''}`}>{shift ? 'Faol' : 'Faol emas'}</span>
        </div>

        {!shift ? (
          <>
            <p className="dd-muted">Yo‘nalishni tanlang. Smena boshlanganda GPS yuboriladi va transportingiz yo‘lovchilar xaritasida ko‘rinadi.</p>
            <div className="dd-direction-choice" role="radiogroup" aria-label="Yo‘nalish">
              {(['outbound', 'inbound'] as DirectionType[]).map((d) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={direction === d}
                  className={`dd-direction ${direction === d ? 'active' : ''}`}
                  onClick={() => setDirection(d)}
                  disabled={!canStart}
                >
                  <i className={d === 'outbound' ? 'ri-arrow-right-line' : 'ri-arrow-left-line'} />
                  <span>{directionLabel(d)}</span>
                </button>
              ))}
            </div>
            {gps.permission === 'denied' && (
              <div className="dd-alert dd-alert--danger">
                <i className="ri-map-pin-2-line" />
                <span>GPS ruxsati berilmagan. Brauzer yoki ilova sozlamalaridan joylashuvga ruxsat bering.</span>
              </div>
            )}
            <button className="dd-btn dd-btn--primary dd-btn--block" disabled={!canStart || busy} onClick={() => void run(() => startShift(direction))}>
              {busy ? <span className="dd-spinner dd-spinner--sm" /> : <i className="ri-play-circle-line" />}
              Smenani boshlash
            </button>
          </>
        ) : (
          <>
            <div className="dd-kv-row">
              <span>Boshlangan</span>
              <strong>
                {formatTime(shift.startedAtMs)} · {formatDuration(now - shift.startedAtMs)}
              </strong>
            </div>
            <div className="dd-kv-row">
              <span>Yo‘nalish</span>
              <strong>{directionLabel(shift.direction)}</strong>
            </div>
            <div className="dd-actions">
              <button
                className="dd-btn dd-btn--secondary"
                disabled={busy}
                onClick={() => {
                  const next: DirectionType = shift.direction === 'outbound' ? 'inbound' : 'outbound'
                  if (window.confirm(`Yo‘nalish almashtirilsinmi?\n${directionLabel(next)}`)) void run(() => switchDirection(next))
                }}
              >
                <i className="ri-arrow-left-right-line" /> Yo‘nalishni almashtirish
              </button>
              <button className="dd-btn dd-btn--danger" disabled={busy} onClick={() => setConfirmEnd(true)}>
                <i className="ri-stop-circle-line" /> Smenani yakunlash
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── GPS & connectivity ── */}
      {shift && (
        <section className="dd-card">
          <div className="dd-card__head">
            <h2>
              <i className="ri-gps-line" /> GPS
            </h2>
            <span className={`dd-pill ${gps.online ? 'dd-pill--ok' : 'dd-pill--warn'}`}>{gps.online ? 'Online' : 'Offline'}</span>
          </div>
          <div className="dd-kv-row">
            <span>Oxirgi joylashuv</span>
            <strong>
              {gps.lastFix ? `${timeAgo(gps.lastFix.capturedAtMs, now)} · ±${Math.round(gps.lastFix.accuracy)} m` : 'Kutilmoqda…'}
            </strong>
          </div>
          <div className="dd-kv-row">
            <span>Tezlik</span>
            <strong>{gps.lastFix ? `${Math.round(gps.lastFix.speedKmh)} km/soat` : '—'}</strong>
          </div>
          <div className="dd-kv-row">
            <span>Serverga yuborilgan</span>
            <strong>{gps.lastSentAtMs ? timeAgo(gps.lastSentAtMs, now) : 'Hali yo‘q'}</strong>
          </div>
          {gps.queued > 0 && (
            <div className="dd-alert dd-alert--warning">
              <i className="ri-wifi-off-line" />
              <span>
                {gps.queued} ta GPS nuqta qurilmada saqlangan. Internet qaytganda avtomatik yuboriladi.
              </span>
              <button className="dd-btn dd-btn--small" disabled={gps.syncing || !gps.online} onClick={() => void syncNow()}>
                {gps.syncing ? <span className="dd-spinner dd-spinner--sm" /> : <i className="ri-refresh-line" />} Yuborish
              </button>
            </div>
          )}
          {gps.lastError && (
            <div className="dd-alert dd-alert--danger">
              <i className="ri-error-warning-line" />
              <span>{gps.lastError}</span>
            </div>
          )}
        </section>
      )}

      {/* ── Live status tiles ── */}
      {shift && (
        <div className="dd-tiles">
          <Link to="/driver/map" className="dd-tile">
            <i className="ri-user-location-line dd-accent" />
            <strong>{waiting.length}</strong>
            <span>kutayotgan yo‘lovchi</span>
          </Link>
          <div className="dd-tile">
            <i className={`ri-parking-box-line ${parking?.isInside ? 'dd-success' : 'dd-muted-icon'}`} />
            <strong>{parking?.isInside ? 'Stoyankada' : 'Yo‘lda'}</strong>
            <span>{parking?.isInside ? parking.parkingName : 'avtomatik aniqlanadi'}</span>
          </div>
        </div>
      )}

      {/* ── Earnings ── */}
      <section className="dd-card">
        <div className="dd-card__head">
          <h2>
            <i className="ri-coins-line" /> Bugun
          </h2>
          <Link to="/driver/payments" className="dd-link">
            To‘lovlar <i className="ri-arrow-right-s-line" />
          </Link>
        </div>
        {balanceError ? (
          <p className="dd-muted">{balanceError}</p>
        ) : !balance ? (
          <p className="dd-muted">Yuklanmoqda…</p>
        ) : (
          <div className="dd-earnings">
            <div>
              <span>Sof tushum</span>
              <strong className="dd-success">{formatSom(balance.todayEarnings)}</strong>
            </div>
            <div>
              <span>Qatnovlar</span>
              <strong>{balance.ridesCountToday} ta</strong>
            </div>
            <div>
              <span>Shu smenada</span>
              <strong>{formatSom(balance.shiftEarnings)}</strong>
            </div>
            <div>
              <span>Yechish mumkin</span>
              <strong>{formatSom(balance.availableBalance)}</strong>
            </div>
          </div>
        )}
      </section>

      {/* ── End shift confirmation ── */}
      {confirmEnd && shift && (
        <div className="dd-modal-overlay" onClick={() => !busy && setConfirmEnd(false)}>
          <div className="dd-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>Smenani yakunlaysizmi?</h3>
            <p className="dd-muted">GPS yuborish to‘xtaydi va transportingiz yo‘lovchilar xaritasidan olib tashlanadi.</p>
            {gps.queued > 0 && (
              <div className="dd-alert dd-alert--warning">
                <i className="ri-wifi-off-line" />
                <span>{gps.queued} ta GPS nuqta avval serverga yuboriladi.</span>
              </div>
            )}
            <label className="dd-label" htmlFor="end-note">
              Izoh (ixtiyoriy)
            </label>
            <input
              id="end-note"
              className="dd-input"
              value={endNote}
              maxLength={255}
              onChange={(e) => setEndNote(e.target.value)}
              placeholder="Masalan: texnik ko‘rik"
            />
            <div className="dd-actions">
              <button className="dd-btn dd-btn--secondary" disabled={busy} onClick={() => setConfirmEnd(false)}>
                Bekor qilish
              </button>
              <button
                className="dd-btn dd-btn--danger"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await endShift(endNote.trim() || undefined)
                    setConfirmEnd(false)
                    setEndNote('')
                  })
                }
              >
                {busy ? <span className="dd-spinner dd-spinner--sm" /> : <i className="ri-stop-circle-line" />} Yakunlash
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
