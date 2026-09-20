import { useEffect, useState } from 'react'
import { watchStateService } from '@/services/watch/watchStateService'
import type { ClientWatchSession } from '@/types/client'
import { uz } from '@/locales/uz'

interface Props {
  routeId: number
  routeNumber: string
  direction: 'outbound' | 'inbound'
  className?: string
}

export default function WatchActionBar({ routeId, routeNumber, direction, className = '' }: Props) {
  const [session, setSession] = useState<ClientWatchSession>(watchStateService.getSession())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(
    () =>
      watchStateService.subscribe((s) => {
        setSession(s)
        const notice = watchStateService.takeNotice()
        if (notice) setError(notice)
      }),
    [],
  )

  const run = async (action: () => Promise<{ success: boolean; error?: string } | void>) => {
    setError(null)
    setBusy(true)
    try {
      const res = await action()
      if (res && !res.success) setError(res.error || 'Xatolik yuz berdi')
    } finally {
      setBusy(false)
    }
  }

  const watchingOther = session.status !== 'IDLE' && session.routeId !== routeId

  return (
    <div className={`p-4 bg-white rounded-xl border border-neutral-200 shadow-sm ${className}`}>
      {error && (
        <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <i className="ri-error-warning-fill text-sm"></i>
          <span>{error}</span>
        </div>
      )}

      {(session.status === 'IDLE' || watchingOther) && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-sm text-neutral-600 flex items-center gap-2">
            <i className="ri-map-pin-user-line text-blue-600 text-lg"></i>
            <span>
              {watchingOther
                ? `Siz ${session.routeNumber}-marshrutni kutmoqdasiz. Bu marshrutga o‘tish uchun kutish rejimini qayta yoqing.`
                : 'Bekatdasizmi? Haydovchilar sizni ko‘rishi uchun kutish rejimini yoqing.'}
            </span>
          </div>
          <button
            disabled={busy}
            onClick={() => run(() => watchStateService.startWatching(routeId, routeNumber, direction))}
            className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium rounded-lg text-sm flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
          >
            <i className="ri-radar-line text-base"></i>
            <span>{busy ? 'Joylashuv aniqlanmoqda…' : uz.watch.actionWatch}</span>
          </button>
        </div>
      )}

      {session.status === 'WATCHING' && !watchingOther && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div>
                <div className="text-sm font-bold text-neutral-900">{session.routeNumber}-marshrutni kutmoqdasiz</div>
                <div className="text-xs text-emerald-700">{uz.watch.watchingNotice}</div>
              </div>
            </div>
            <button disabled={busy} onClick={() => run(() => watchStateService.stopWatching())} className="text-xs text-neutral-500 hover:text-neutral-700 p-1 rounded">
              {uz.watch.stopWatching}
            </button>
          </div>
          <button
            disabled={busy}
            onClick={() => run(() => watchStateService.boardVehicle())}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
          >
            <i className="ri-car-fill text-base"></i>
            <span>{uz.watch.actionOnBoard}</span>
          </button>
        </div>
      )}

      {session.status === 'ON_VEHICLE' && !watchingOther && (
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
              <i className="ri-riding-line text-base"></i>
            </div>
            <div>
              <div className="text-sm font-bold text-neutral-900">{session.routeNumber}-marshrutdasiz (safardasiz)</div>
              <div className="text-xs text-neutral-500">{uz.watch.onBoardNotice}</div>
            </div>
          </div>
          <button
            disabled={busy}
            onClick={() => run(() => watchStateService.alightVehicle())}
            className="w-full px-4 py-2.5 bg-neutral-800 hover:bg-neutral-900 disabled:opacity-60 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
          >
            <i className="ri-walk-line text-base"></i>
            <span>{uz.watch.actionAlighted}</span>
          </button>
        </div>
      )}
    </div>
  )
}
