import React, { useEffect, useState } from 'react'
import { watchStateService } from '@/services/watch/watchStateService'
import { ClientWatchSession } from '@/types/client'
import { uz } from '@/locales/uz'

interface Props {
  routeNumber?: string
  targetStopId?: string
  className?: string
}

export default function WatchActionBar({ routeNumber = '15', targetStopId, className = '' }: Props) {
  const [session, setSession] = useState<ClientWatchSession>(watchStateService.getSession())
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    const unsub = watchStateService.subscribe((s) => {
      setSession(s)
    })
    return unsub
  }, [])

  const handleStartWatch = () => {
    setErrorMsg(null)
    const res = watchStateService.startWatching(routeNumber, targetStopId)
    if (!res.success) {
      setErrorMsg(res.error || 'Xatolik yuz berdi')
    }
  }

  const handleBoardVehicle = () => {
    watchStateService.boardVehicle()
  }

  const handleAlightVehicle = () => {
    watchStateService.alightVehicle()
  }

  const handleStopWatch = () => {
    watchStateService.stopWatching()
  }

  return (
    <div className={`p-4 bg-white rounded-xl border border-neutral-200 shadow-sm ${className}`}>
      {errorMsg && (
        <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-2">
          <i className="ri-error-warning-fill text-sm"></i>
          <span>{errorMsg}</span>
        </div>
      )}

      {session.status === 'IDLE' && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-sm text-neutral-600 flex items-center gap-2">
            <i className="ri-map-pin-user-line text-blue-600 text-lg"></i>
            <span>
              Bekatdasizmi? Haydovchilar sizni ko‘rishi uchun kutish rejimini yoqing.
            </span>
          </div>
          <button
            onClick={handleStartWatch}
            className="w-full sm:w-auto px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
          >
            <i className="ri-radar-line text-base"></i>
            <span>{uz.watch.actionWatch}</span>
          </button>
        </div>
      )}

      {session.status === 'WATCHING' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <div>
                <div className="text-sm font-bold text-neutral-900">
                  {session.routeNumber}-marshrutni kutmoqdasiz
                </div>
                <div className="text-xs text-emerald-700">
                  {uz.watch.watchingNotice}
                </div>
              </div>
            </div>
            <button
              onClick={handleStopWatch}
              className="text-xs text-neutral-500 hover:text-neutral-700 p-1 rounded"
              title={uz.watch.stopWatching}
            >
              {uz.watch.stopWatching}
            </button>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleBoardVehicle}
              className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
            >
              <i className="ri-car-fill text-base"></i>
              <span>{uz.watch.actionOnBoard}</span>
            </button>
          </div>
        </div>
      )}

      {session.status === 'ON_VEHICLE' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center">
                <i className="ri-riding-line text-base"></i>
              </div>
              <div>
                <div className="text-sm font-bold text-neutral-900">
                  {session.routeNumber}-marshrutdasiz (Safardasiz)
                </div>
                <div className="text-xs text-neutral-500">
                  {uz.watch.onBoardNotice}
                </div>
              </div>
            </div>
          </div>

          <div className="pt-1">
            <button
              onClick={handleAlightVehicle}
              className="w-full px-4 py-2.5 bg-neutral-800 hover:bg-neutral-900 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-2 shadow-sm min-h-[44px]"
            >
              <i className="ri-walk-line text-base"></i>
              <span>{uz.watch.actionAlighted}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
