import { useEffect, useRef, useState } from 'react'
import { clientApi } from '@/services/api/clientApi'
import { errorMessage } from '@/services/api/client'
import type { Coordinates, Place } from '@/types/client'

interface Props {
  label: string
  icon: string
  iconClass: string
  placeholder: string
  value: string
  onTextChange: (text: string) => void
  onSelect: (place: Place) => void
  near?: Coordinates | null
  trailing?: React.ReactNode
  extraSuggestions?: Place[]
}

const KIND_ICON: Record<string, string> = {
  stop: 'ri-bus-2-line',
  terminal: 'ri-flag-2-line',
  parking: 'ri-parking-box-line',
}

/** Place autocomplete backed by /geo/search (real stops from the DB + MapTiler geocoding). */
export default function PlaceSearchInput({
  label,
  icon,
  iconClass,
  placeholder,
  value,
  onTextChange,
  onSelect,
  near,
  trailing,
  extraSuggestions = [],
}: Props) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const typedRef = useRef(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!typedRef.current) return
    const q = value.trim()
    if (q.length < 2) {
      setResults([])
      setError(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      clientApi
        .searchPlaces(q, near ?? undefined, controller.signal)
        .then((places) => {
          setResults(places)
          setError(null)
        })
        .catch((err) => {
          if ((err as Error).name !== 'AbortError') setError(errorMessage(err, 'Qidiruvda xatolik'))
        })
        .finally(() => setLoading(false))
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, near])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const suggestions = value.trim().length >= 2 ? results : extraSuggestions

  return (
    <div className="relative" ref={boxRef}>
      <label className="block text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-1">{label}</label>
      <div className="relative flex items-center">
        <span className={`absolute left-3 text-base ${iconClass}`}>
          <i className={icon}></i>
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => {
            typedRef.current = true
            onTextChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label={label}
          className="w-full pl-9 pr-10 py-2.5 bg-neutral-50 hover:bg-neutral-100/70 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
        />
        {trailing}
      </div>

      {open && (loading || error || suggestions.length > 0 || value.trim().length >= 2) && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg z-30 overflow-hidden divide-y divide-neutral-100 max-h-64 overflow-y-auto">
          {loading && <div className="px-3 py-2.5 text-xs text-neutral-500">Qidirilmoqda…</div>}
          {error && <div className="px-3 py-2.5 text-xs text-red-600">{error}</div>}
          {!loading && !error && value.trim().length >= 2 && suggestions.length === 0 && (
            <div className="px-3 py-2.5 text-xs text-neutral-500">Hech narsa topilmadi. Xaritadan tanlang yoki boshqa nom yozing.</div>
          )}
          {suggestions.map((place) => (
            <button
              type="button"
              key={place.id}
              className="w-full text-left px-3 py-2.5 hover:bg-neutral-50 flex items-center gap-2.5"
              onClick={() => {
                typedRef.current = false
                onSelect(place)
                setOpen(false)
              }}
            >
              <i className={`${KIND_ICON[place.kind] ?? 'ri-map-pin-line'} text-neutral-400`}></i>
              <span className="min-w-0">
                <span className="block font-semibold text-neutral-800 text-xs truncate">{place.name}</span>
                {place.address && <span className="block text-neutral-400 text-[10px] truncate">{place.address}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
