import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { clientApi } from '@/services/api/clientApi'
import { errorMessage } from '@/services/api/client'
import type { RouteListItem } from '@/types/client'

/** Legacy `/overview/:number` links: resolve the route number to its id and redirect. */
export default function RouteOverview() {
  const { number = '' } = useParams()
  const [matches, setMatches] = useState<RouteListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    clientApi
      .listRoutes(number)
      .then((list) => setMatches(list.filter((r) => r.routeNumber.toLowerCase() === number.toLowerCase())))
      .catch((err) => setError(errorMessage(err)))
  }, [number])

  if (error) return <div className="p-4 text-sm text-red-600">{error}</div>
  if (matches === null) return <div className="p-4 text-sm text-neutral-500">Yuklanmoqda…</div>
  if (matches.length === 1) return <Navigate to={`/route/${matches[0].id}`} replace />

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-bold">{number}-raqamli marshrut</h2>
      {matches.length === 0 ? (
        <p className="text-sm text-neutral-600">Bunday raqamli chop etilgan marshrut topilmadi.</p>
      ) : (
        matches.map((r) => (
          <Link key={r.id} to={`/route/${r.id}`} className="block p-3 rounded-xl border border-neutral-200 hover:border-blue-300">
            <div className="font-semibold text-sm">{r.name}</div>
            <div className="text-xs text-neutral-500">
              {r.originName} → {r.destinationName}
            </div>
          </Link>
        ))
      )}
    </div>
  )
}
