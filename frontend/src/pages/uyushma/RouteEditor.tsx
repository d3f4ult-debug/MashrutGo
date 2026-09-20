import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useUyushmaScope } from '../../contexts/UyushmaScopeContext'
import { usePortalBase } from '../../hooks/usePortalBase'
import { ApiError, errorMessage } from '../../services/api/client'
import { clientApi } from '../../services/api/clientApi'
import { ANDIJON_CENTER, attachStyleFallback, getMapStyle } from '../../services/map/maptiler'
import {
  DIRECTION_LABEL,
  EDITOR_LIMITS,
  buildCreateRequest,
  buildMetaUpdate,
  directionFingerprint,
  emptyDirection,
  formatDistance,
  formatDuration,
  hasFreshGeometry,
  insertionIndex,
  newWaypointKey,
  pointsKey,
  reverseInto,
  routeEditorApi,
  toLngLat,
  validateDirectionForSave,
  validateMeta,
} from '../../services/api/routeEditorApi'
import type { Place } from '../../types/client'
import type {
  DirectionEditorState,
  DirectionPair,
  DirectionType,
  EditorWaypoint,
  LineStringGeometry,
  LngLat,
  RouteMetaState,
} from '../../types/routeEditor'
import './RouteEditor.css'

// ---------------------------------------------------------------- constants

const DIRECTIONS: DirectionType[] = ['outbound', 'inbound']
const OTHER: Record<DirectionType, DirectionType> = { outbound: 'inbound', inbound: 'outbound' }
const ROUTE_DEBOUNCE_MS = 450
const MAX_HISTORY = 50
const ORIGIN_KEY = 'A'
const DEST_KEY = 'B'
const EMPTY_META: RouteMetaState = { routeNumber: '', name: '', description: '' }
const LEAVE_MESSAGE = "Saqlanmagan o'zgarishlar bor. Sahifadan chiqsangiz, ular yo'qoladi. Davom etasizmi?"

type ClickMode = 'origin' | 'destination' | 'stop' | 'shape' | 'view'

const MODES: { id: ClickMode; label: string; icon: string; hint: string }[] = [
  { id: 'origin', label: 'A tanlash', icon: 'ri-map-pin-2-line', hint: 'A tanlash: xaritada bosh bekat (A) joyini bosing' },
  { id: 'destination', label: 'B tanlash', icon: 'ri-flag-2-line', hint: 'B tanlash: xaritada oxirgi bekat (B) joyini bosing' },
  { id: 'stop', label: 'Bekat', icon: 'ri-bus-2-line', hint: "Bekat qo'shish: xaritada yoki yo'l ustida bosing — yo'l avtomatik qayta chiziladi" },
  { id: 'shape', label: 'Oraliq nuqta', icon: 'ri-git-commit-line', hint: "Oraliq nuqta: yo'lni kerakli ko'chadan o'tkazish uchun bosing (bekat emas)" },
  { id: 'view', label: "Ko'rish", icon: 'ri-drag-move-2-line', hint: "Ko'rish rejimi: bosish hech narsa qo'shmaydi. Nuqtalarni surish (drag) mumkin" },
]

const SRC_ACTIVE = 'route-editor-active'
const SRC_OTHER = 'route-editor-other'
const LAYER_OTHER = 'route-editor-other-line'
const LAYER_GLOW = 'route-editor-active-glow'
const LAYER_LINE = 'route-editor-active-line'

interface RoutingStatus {
  loading: boolean
  error: string | null
}
const IDLE: RoutingStatus = { loading: false, error: null }

interface Toast {
  kind: 'success' | 'error' | 'info'
  text: string
}

interface LineFeatureCollection {
  type: 'FeatureCollection'
  features: { type: 'Feature'; properties: { stale: boolean }; geometry: LineStringGeometry }[]
}

type GeoJsonData = Parameters<maplibregl.GeoJSONSource['setData']>[0]

interface MarkerSpec {
  key: string
  kind: 'origin' | 'destination' | 'stop' | 'shape'
  label: string
  title: string
  coordinates: LngLat
  selected: boolean
}

interface MarkerEntry {
  marker: maplibregl.Marker
  root: HTMLDivElement
  pin: HTMLDivElement
}

interface MapHandlers {
  onMapClick: (p: LngLat) => void
  onMarkerMoved: (key: string, p: LngLat) => void
  onMarkerClick: (key: string) => void
  onMarkerContext: (key: string) => void
}

// ---------------------------------------------------------------- small helpers

function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
}

function routingErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 502) return err.message || "Yo'l chizish xizmati javob bermadi"
    if (err.status === 422) return `Koordinatalar noto'g'ri: ${err.message}`
  }
  return errorMessage(err, "Yo'lni hisoblab bo'lmadi")
}

function metaErrorMessage(err: unknown, fallback: string): string {
  // 409 = duplicate route number; the backend message already explains it
  if (err instanceof ApiError && err.status === 409) return `${err.message} — boshqa raqam kiriting`
  return errorMessage(err, fallback)
}

function featureCollection(geometry: LineStringGeometry | null, stale: boolean): LineFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geometry ? [{ type: 'Feature', properties: { stale }, geometry }] : [],
  }
}

function coordText(c: LngLat): string {
  return `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`
}

function stopCount(s: DirectionEditorState): number {
  return (s.origin ? 1 : 0) + (s.destination ? 1 : 0) + s.waypoints.filter((w) => w.isStop).length
}

function modeAfterEndpoints(s: DirectionEditorState, current: ClickMode): ClickMode {
  if (!s.origin) return 'origin'
  if (!s.destination) return 'destination'
  return current === 'origin' || current === 'destination' ? 'view' : current
}

function buildMarkerSpecs(s: DirectionEditorState, selectedKey: string | null): MarkerSpec[] {
  const specs: MarkerSpec[] = []
  if (s.origin) {
    specs.push({
      key: ORIGIN_KEY,
      kind: 'origin',
      label: 'A',
      title: `A — ${s.origin.name || 'bosh bekat'} (surib ko'chiring)`,
      coordinates: s.origin.coordinates,
      selected: selectedKey === ORIGIN_KEY,
    })
  }
  s.waypoints.forEach((w, i) => {
    const fallback = w.isStop ? `Bekat #${i + 1}` : `Oraliq nuqta #${i + 1}`
    specs.push({
      key: w.key,
      kind: w.isStop ? 'stop' : 'shape',
      label: String(i + 1),
      title: `${w.name || fallback} — surib ko'chiring, o'ng tugma bilan o'chiring`,
      coordinates: w.coordinates,
      selected: selectedKey === w.key,
    })
  })
  if (s.destination) {
    specs.push({
      key: DEST_KEY,
      kind: 'destination',
      label: 'B',
      title: `B — ${s.destination.name || 'oxirgi bekat'} (surib ko'chiring)`,
      coordinates: s.destination.coordinates,
      selected: selectedKey === DEST_KEY,
    })
  }
  return specs
}

/** Browser-level warning (reload, tab close, external links). */
function useBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}

/**
 * BrowserRouter 6.12 has no useBlocker: intercept in-app link clicks (sidebar navigation etc.)
 * in the capture phase, before React Router's Link handler runs.
 */
function useInAppLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = e.target instanceof Element ? (e.target.closest('a[href]') as HTMLAnchorElement | null) : null
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [active])
}

// ---------------------------------------------------------------- entry

export function RouteEditor() {
  const { id } = useParams<{ id?: string }>()
  if (id === undefined) return <NewRouteForm />
  const routeId = Number(id)
  if (!Number.isInteger(routeId) || routeId <= 0) return <EditorNotice title="Yo'nalish topilmadi" text={`Noto'g'ri yo'nalish identifikatori: ${id}`} />
  return <RouteEditorWorkspace key={routeId} routeId={routeId} />
}

export default RouteEditor

function EditorNotice({ title, text }: { title: string; text: string }) {
  const base = usePortalBase()
  const navigate = useNavigate()
  return (
    <div className="route-editor-layout">
      <div className="editor-create-wrap">
        <div className="editor-create-card">
          <h2>
            <i className="ri-error-warning-line" /> {title}
          </h2>
          <p className="editor-create-card__text">{text}</p>
          <button className="btn-editor-action" onClick={() => navigate(`${base}/routes`)}>
            <i className="ri-arrow-left-line" /> Yo'nalishlar ro'yxati
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- new route (metadata → POST /routes)

function NewRouteForm() {
  const base = usePortalBase()
  const navigate = useNavigate()
  const { uyushmaId, canSwitch, options, loading: scopeLoading } = useUyushmaScope()
  const [meta, setMeta] = useState<RouteMetaState>(EMPTY_META)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const scopeMissing = canSwitch && !uyushmaId
  const scopeName = canSwitch ? options.find((o) => String(o.id) === uyushmaId)?.name ?? null : null
  const hasInput = Boolean(meta.routeNumber.trim() || meta.name.trim() || meta.description.trim())
  useBeforeUnload(hasInput && !busy)
  useInAppLeaveGuard(hasInput && !busy)

  const goBack = () => {
    if (hasInput && !window.confirm(LEAVE_MESSAGE)) return
    navigate(`${base}/routes`)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (scopeMissing) {
      setError('Uyushma tanlang (sahifa yuqorisidagi tanlagichdan)')
      return
    }
    const problems = validateMeta(meta)
    if (problems.length) {
      setError(problems.join('; '))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await routeEditorApi.createRoute(buildCreateRequest(meta, uyushmaId))
      navigate(`${base}/routes/editor/${created.id}`, { replace: true })
    } catch (err) {
      setError(metaErrorMessage(err, "Yo'nalish yaratilmadi"))
      setBusy(false)
    }
  }

  const field = (key: keyof RouteMetaState) => (e: { target: { value: string } }) =>
    setMeta((m) => ({ ...m, [key]: e.target.value }))

  return (
    <div className="route-editor-layout">
      <header className="editor-top-bar">
        <div className="editor-top-bar__left">
          <button className="btn-back-link" onClick={goBack} title="Yo'nalishlar ro'yxatiga qaytish">
            <i className="ri-arrow-left-line" />
          </button>
          <strong className="editor-top-bar__title">Yangi yo'nalish</strong>
        </div>
      </header>

      <div className="editor-create-wrap">
        <form className="editor-create-card" onSubmit={submit}>
          <h2>
            <i className="ri-route-line" /> Yangi yo'nalish yaratish
          </h2>
          <p className="editor-create-card__text">
            Avval raqam va nomni kiriting. Yo'nalish qoralama sifatida yaratiladi, so'ng xaritada Borish (A → B) va Qaytish
            (B → A) yo'llarini chizasiz.
          </p>

          {canSwitch && (
            <div className={`editor-banner ${scopeMissing ? 'error' : 'info'}`}>
              <i className="ri-building-2-line" />
              <div>
                {scopeLoading
                  ? 'Uyushmalar yuklanmoqda…'
                  : scopeMissing
                    ? 'Uyushma tanlang: yo‘nalish qaysi uyushmaga tegishli ekanini sahifa yuqorisidagi tanlagichdan belgilang.'
                    : `Uyushma: ${scopeName ?? uyushmaId}`}
              </div>
            </div>
          )}

          {error && (
            <div className="editor-banner error">
              <i className="ri-error-warning-fill" />
              <div>{error}</div>
            </div>
          )}

          <div className="editor-field-row">
            <label className="editor-field editor-field--narrow">
              <span>Raqam *</span>
              <input
                value={meta.routeNumber}
                onChange={field('routeNumber')}
                maxLength={EDITOR_LIMITS.routeNumberMax}
                placeholder="12"
                autoFocus
                required
              />
            </label>
            <label className="editor-field">
              <span>Yo'nalish nomi *</span>
              <input
                value={meta.name}
                onChange={field('name')}
                maxLength={EDITOR_LIMITS.routeNameMax}
                placeholder="Eski shahar — Yangi bozor"
                required
              />
            </label>
          </div>
          <label className="editor-field">
            <span>Tavsif (ixtiyoriy)</span>
            <textarea
              rows={3}
              value={meta.description}
              onChange={field('description')}
              maxLength={EDITOR_LIMITS.descriptionMax}
              placeholder="Asosiy ko'chalar, xizmat vaqti va boshqa izohlar"
            />
          </label>

          <div className="editor-create-card__actions">
            <button type="button" className="btn-editor-action" onClick={goBack} disabled={busy}>
              Bekor qilish
            </button>
            <button type="submit" className="btn-editor-action btn-publish" disabled={busy || scopeMissing}>
              {busy ? <i className="ri-loader-4-line re-spin" /> : <i className="ri-arrow-right-line" />}
              Yaratish va xaritada chizish
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- place search (GET /geo/search)

function PlaceSearchBox({
  getNear,
  canAddStop,
  disabled,
  onPick,
}: {
  getNear: () => LngLat | null
  canAddStop: boolean
  disabled: boolean
  onPick: (place: Place, target: 'origin' | 'destination' | 'stop') => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const getNearRef = useRef(getNear)
  getNearRef.current = getNear

  useEffect(() => {
    const term = query.trim()
    if (term.length < 2) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      clientApi
        .searchPlaces(term, getNearRef.current() ?? undefined, controller.signal)
        .then((list) => {
          setResults(list)
          setError(null)
        })
        .catch((err) => {
          if (!isAbortError(err)) setError(errorMessage(err, 'Qidiruvda xatolik'))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (place: Place, target: 'origin' | 'destination' | 'stop') => {
    onPick(place, target)
    setOpen(false)
    setQuery('')
  }

  const showList = open && query.trim().length >= 2

  return (
    <div className="place-search" ref={boxRef}>
      <div className="place-search__input">
        <i className={loading ? 'ri-loader-4-line re-spin' : 'ri-search-line'} />
        <input
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Joy yoki bekat qidirish (A, B yoki bekat uchun)"
        />
      </div>
      {showList && (
        <div className="place-search__results">
          {error && <div className="place-search__empty error">{error}</div>}
          {!error && !loading && results.length === 0 && <div className="place-search__empty">Hech narsa topilmadi</div>}
          {results.map((p) => (
            <div key={p.id} className="place-search__item">
              <div className="place-search__text">
                <span className="place-search__name">{p.name}</span>
                <span className="place-search__addr">{[p.address, p.kind].filter(Boolean).join(' • ')}</span>
              </div>
              <div className="place-search__actions">
                <button type="button" className="place-chip-btn start" onClick={() => pick(p, 'origin')} title="A nuqta qilish">
                  A
                </button>
                <button type="button" className="place-chip-btn end" onClick={() => pick(p, 'destination')} title="B nuqta qilish">
                  B
                </button>
                <button
                  type="button"
                  className="place-chip-btn stop"
                  onClick={() => pick(p, 'stop')}
                  disabled={!canAddStop}
                  title={canAddStop ? "Bekat sifatida qo'shish" : 'Avval A va B nuqtalarni tanlang'}
                >
                  <i className="ri-add-line" /> Bekat
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- workspace (existing route)

function RouteEditorWorkspace({ routeId }: { routeId: number }) {
  const base = usePortalBase()
  const navigate = useNavigate()

  // ── Route metadata
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [info, setInfo] = useState({ uyushmaName: '', isPublished: false, isArchived: false })
  const [meta, setMeta] = useState<RouteMetaState>(EMPTY_META)
  const [savedMeta, setSavedMeta] = useState<RouteMetaState>(EMPTY_META)

  // ── Directions. `dirsRef` is the synchronous source of truth for map handlers and async flows.
  const [dirs, setDirs] = useState<DirectionPair>(() => ({
    outbound: emptyDirection('outbound'),
    inbound: emptyDirection('inbound'),
  }))
  const dirsRef = useRef(dirs)
  const [baseline, setBaseline] = useState<Record<DirectionType, string>>(() => ({
    outbound: directionFingerprint(emptyDirection('outbound')),
    inbound: directionFingerprint(emptyDirection('inbound')),
  }))
  const historyRef = useRef<DirectionPair[]>([])
  const [historySize, setHistorySize] = useState(0)
  const lastCoalesceRef = useRef<string | null>(null)

  // ── UI
  const [active, setActive] = useState<DirectionType>('outbound')
  const [clickMode, setClickMode] = useState<ClickMode>('view')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [routing, setRouting] = useState<Record<DirectionType, RoutingStatus>>({ outbound: IDLE, inbound: IDLE })
  const [retryNonce, setRetryNonce] = useState<Record<DirectionType, number>>({ outbound: 0, inbound: 0 })
  const [saving, setSaving] = useState<null | 'all' | DirectionType>(null)
  const [publishing, setPublishing] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  // ── Map
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const markersRef = useRef(new Map<string, MarkerEntry>())
  const draggingKeyRef = useRef<string | null>(null)
  const lineDataRef = useRef<{ active: LineFeatureCollection; other: LineFeatureCollection }>({
    active: featureCollection(null, false),
    other: featureCollection(null, false),
  })
  const handlersRef = useRef<MapHandlers | null>(null)
  const didFitRef = useRef(false)

  const readOnly = info.isArchived
  const activeState = dirs[active]
  const otherState = dirs[OTHER[active]]

  const showToast = useCallback((kind: Toast['kind'], text: string) => setToast({ kind, text }), [])

  useEffect(() => {
    if (!toast || toast.kind === 'error') return
    const timer = window.setTimeout(() => setToast((t) => (t === toast ? null : t)), 4500)
    return () => window.clearTimeout(timer)
  }, [toast])

  // ── State plumbing
  const commitDirs = useCallback((next: DirectionPair) => {
    dirsRef.current = next
    setDirs(next)
  }, [])

  /** Undoable edit of one direction. Consecutive edits with the same `coalesceKey` (typing) share one undo step. */
  const editDirection = useCallback(
    (dir: DirectionType, updater: (s: DirectionEditorState) => DirectionEditorState, coalesceKey?: string) => {
      const current = dirsRef.current
      const updated = updater(current[dir])
      if (updated === current[dir]) return
      if (!coalesceKey || coalesceKey !== lastCoalesceRef.current) {
        historyRef.current = [...historyRef.current.slice(-(MAX_HISTORY - 1)), current]
        setHistorySize(historyRef.current.length)
      }
      lastCoalesceRef.current = coalesceKey ?? null
      commitDirs({ ...current, [dir]: updated })
    },
    [commitDirs],
  )

  const undo = useCallback(() => {
    const previous = historyRef.current[historyRef.current.length - 1]
    if (!previous) return
    historyRef.current = historyRef.current.slice(0, -1)
    setHistorySize(historyRef.current.length)
    lastCoalesceRef.current = null
    commitDirs(previous)
  }, [commitDirs])

  // ── Load GET /routes/{id}
  useEffect(() => {
    const controller = new AbortController()
    setLoadState('loading')
    setLoadError(null)
    routeEditorApi
      .loadRoute(routeId, controller.signal)
      .then((model) => {
        commitDirs(model.directions)
        historyRef.current = []
        setHistorySize(0)
        lastCoalesceRef.current = null
        setBaseline({
          outbound: directionFingerprint(model.directions.outbound),
          inbound: directionFingerprint(model.directions.inbound),
        })
        setMeta(model.meta)
        setSavedMeta(model.meta)
        setInfo({ uyushmaName: model.uyushmaName, isPublished: model.isPublished, isArchived: model.isArchived })
        setActive('outbound')
        setSelectedKey(null)
        setClickMode(model.isArchived ? 'view' : modeAfterEndpoints(model.directions.outbound, 'view'))
        didFitRef.current = false
        setLoadState('ready')
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setLoadError(
          err instanceof ApiError && err.status === 404 ? "Yo'nalish topilmadi yoki sizga ruxsat yo'q" : errorMessage(err, "Yo'nalish yuklanmadi"),
        )
        setLoadState('error')
      })
    return () => controller.abort()
  }, [routeId, reloadNonce, commitDirs])

  // ── Auto path: re-route A → waypoints → B after every change (debounced, stale requests aborted)
  const scheduleRouting = useCallback(
    (dir: DirectionType): (() => void) | undefined => {
      const state = dirsRef.current[dir]
      const key = pointsKey(state)
      if (!key || state.preview?.pointsKey === key) {
        setRouting((r) => (r[dir].loading || r[dir].error ? { ...r, [dir]: IDLE } : r))
        return undefined
      }
      const controller = new AbortController()
      setRouting((r) => ({ ...r, [dir]: { loading: true, error: null } }))
      const timer = window.setTimeout(() => {
        routeEditorApi
          .previewPath(dirsRef.current[dir], controller.signal)
          .then((preview) => {
            if (controller.signal.aborted) return
            const current = dirsRef.current
            if (pointsKey(current[dir]) !== preview.pointsKey) return
            commitDirs({ ...current, [dir]: { ...current[dir], preview } })
            setRouting((r) => ({ ...r, [dir]: IDLE }))
          })
          .catch((err) => {
            if (controller.signal.aborted || isAbortError(err)) return
            setRouting((r) => ({ ...r, [dir]: { loading: false, error: routingErrorMessage(err) } }))
          })
      }, ROUTE_DEBOUNCE_MS)
      return () => {
        window.clearTimeout(timer)
        controller.abort()
      }
    },
    [commitDirs],
  )

  const outboundKey = pointsKey(dirs.outbound)
  const inboundKey = pointsKey(dirs.inbound)
  const outboundPreviewKey = dirs.outbound.preview?.pointsKey ?? null
  const inboundPreviewKey = dirs.inbound.preview?.pointsKey ?? null
  useEffect(
    () => scheduleRouting('outbound'),
    [scheduleRouting, outboundKey, outboundPreviewKey, retryNonce.outbound],
  )
  useEffect(
    () => scheduleRouting('inbound'),
    [scheduleRouting, inboundKey, inboundPreviewKey, retryNonce.inbound],
  )

  // ── Dirty tracking against the last loaded/saved state
  const fingerprints = useMemo(
    () => ({ outbound: directionFingerprint(dirs.outbound), inbound: directionFingerprint(dirs.inbound) }),
    [dirs],
  )
  const dirDirty: Record<DirectionType, boolean> = {
    outbound: fingerprints.outbound !== baseline.outbound,
    inbound: fingerprints.inbound !== baseline.inbound,
  }
  const metaDirty = Object.keys(buildMetaUpdate(savedMeta, meta)).length > 0
  const isDirty = loadState === 'ready' && (metaDirty || dirDirty.outbound || dirDirty.inbound)
  useBeforeUnload(isDirty)
  useInAppLeaveGuard(isDirty)

  // ── Map lifecycle
  useEffect(() => {
    const container = mapContainer.current
    if (!container) return
    const map = new maplibregl.Map({
      container,
      style: getMapStyle('dark'),
      center: ANDIJON_CENTER,
      zoom: 12.5,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right')
    attachStyleFallback(map, 'dark')

    // Sources/layers vanish when attachStyleFallback swaps the style: re-add them idempotently.
    const ensureLayers = () => {
      try {
        if (!map.getSource(SRC_OTHER)) {
          map.addSource(SRC_OTHER, { type: 'geojson', data: lineDataRef.current.other as unknown as GeoJsonData })
        }
        if (!map.getSource(SRC_ACTIVE)) {
          map.addSource(SRC_ACTIVE, { type: 'geojson', data: lineDataRef.current.active as unknown as GeoJsonData })
        }
        if (!map.getLayer(LAYER_OTHER)) {
          map.addLayer({
            id: LAYER_OTHER,
            type: 'line',
            source: SRC_OTHER,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#a78bfa', 'line-width': 4, 'line-opacity': 0.45, 'line-dasharray': [1.5, 1.5] },
          })
        }
        if (!map.getLayer(LAYER_GLOW)) {
          map.addLayer({
            id: LAYER_GLOW,
            type: 'line',
            source: SRC_ACTIVE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': '#3b82f6',
              'line-width': 10,
              'line-blur': 3,
              'line-opacity': ['case', ['get', 'stale'], 0.1, 0.35],
            },
          })
        }
        if (!map.getLayer(LAYER_LINE)) {
          map.addLayer({
            id: LAYER_LINE,
            type: 'line',
            source: SRC_ACTIVE,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': ['case', ['get', 'stale'], '#94a3b8', '#60a5fa'],
              'line-width': 5,
              'line-opacity': ['case', ['get', 'stale'], 0.6, 1],
            },
          })
        }
        return true
      } catch {
        return false // style not ready yet; the next style event retries
      }
    }

    const onStyle = () => {
      if (ensureLayers()) setMapReady(true)
    }
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const target = e.originalEvent?.target
      if (target instanceof Element && target.closest('.map-marker-root')) return
      handlersRef.current?.onMapClick(toLngLat(e.lngLat.lat, e.lngLat.lng))
    }
    map.on('load', onStyle)
    map.on('style.load', onStyle)
    map.on('styledata', onStyle)
    map.on('click', onClick)
    mapRef.current = map

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.resize()) : null
    resizeObserver?.observe(container)

    const markers = markersRef.current
    return () => {
      resizeObserver?.disconnect()
      markers.forEach((m) => m.marker.remove())
      markers.clear()
      map.off('load', onStyle)
      map.off('style.load', onStyle)
      map.off('styledata', onStyle)
      map.off('click', onClick)
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // A double-click in an add/pick mode must not also zoom (each click already adds a point).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (clickMode === 'view' || readOnly) map.doubleClickZoom.enable()
    else map.doubleClickZoom.disable()
  }, [clickMode, readOnly, mapReady])

  // ── Geometry layers
  const activeFresh = hasFreshGeometry(activeState)
  useEffect(() => {
    lineDataRef.current = {
      active: featureCollection(activeState.preview?.geometry ?? null, !activeFresh),
      other: featureCollection(otherState.preview?.geometry ?? null, false),
    }
    const map = mapRef.current
    if (!map || !mapReady) return
    ;(map.getSource(SRC_ACTIVE) as maplibregl.GeoJSONSource | undefined)?.setData(lineDataRef.current.active as unknown as GeoJsonData)
    ;(map.getSource(SRC_OTHER) as maplibregl.GeoJSONSource | undefined)?.setData(lineDataRef.current.other as unknown as GeoJsonData)
  }, [mapReady, activeState.preview, otherState.preview, activeFresh])

  // ── Markers: reconciled by stable key so a drag in progress is never interrupted by re-renders
  const markerSpecs = useMemo(
    () => buildMarkerSpecs({ ...activeState, preview: null }, selectedKey),
    // Only points/selection matter: a new preview geometry must not touch markers (drag safety).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeState.origin, activeState.destination, activeState.waypoints, selectedKey],
  )
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const entries = markersRef.current
    const wanted = new Set(markerSpecs.map((s) => s.key))
    entries.forEach((entry, key) => {
      if (!wanted.has(key)) {
        entry.marker.remove()
        entries.delete(key)
      }
    })
    for (const spec of markerSpecs) {
      let entry = entries.get(spec.key)
      if (!entry) {
        const root = document.createElement('div')
        root.className = 'map-marker-root'
        const pin = document.createElement('div')
        root.appendChild(pin)
        const marker = new maplibregl.Marker({ element: root, draggable: !readOnly }).setLngLat(spec.coordinates).addTo(map)
        const key = spec.key
        marker.on('dragstart', () => {
          draggingKeyRef.current = key
        })
        marker.on('dragend', () => {
          draggingKeyRef.current = null
          const ll = marker.getLngLat()
          handlersRef.current?.onMarkerMoved(key, toLngLat(ll.lat, ll.lng))
        })
        root.addEventListener('click', (ev) => {
          ev.stopPropagation()
          handlersRef.current?.onMarkerClick(key)
        })
        root.addEventListener('contextmenu', (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          handlersRef.current?.onMarkerContext(key)
        })
        entry = { marker, root, pin }
        entries.set(key, entry)
      }
      const className = `map-marker-pin ${spec.kind}${spec.selected ? ' selected' : ''}`
      if (entry.pin.className !== className) entry.pin.className = className
      if (entry.pin.textContent !== spec.label) entry.pin.textContent = spec.label
      entry.root.title = spec.title
      entry.marker.setDraggable(!readOnly)
      if (draggingKeyRef.current !== spec.key) {
        const at = entry.marker.getLngLat()
        if (at.lng !== spec.coordinates[0] || at.lat !== spec.coordinates[1]) entry.marker.setLngLat(spec.coordinates)
      }
    }
  }, [mapReady, markerSpecs, readOnly])

  // ── Camera
  const fitToDirection = useCallback((dir: DirectionType, animate: boolean) => {
    const map = mapRef.current
    if (!map) return
    const s = dirsRef.current[dir]
    const coords: LngLat[] = [
      ...(s.preview?.geometry.coordinates ?? []),
      ...(s.origin ? [s.origin.coordinates] : []),
      ...s.waypoints.map((w) => w.coordinates),
      ...(s.destination ? [s.destination.coordinates] : []),
    ]
    if (coords.length === 0) return
    if (coords.length === 1) {
      map.easeTo({ center: coords[0], zoom: Math.max(map.getZoom(), 15), duration: animate ? 600 : 0 })
      return
    }
    const bounds = new maplibregl.LngLatBounds(coords[0], coords[0])
    coords.forEach((c) => bounds.extend(c))
    map.fitBounds(bounds, { padding: 70, maxZoom: 16, duration: animate ? 800 : 0 })
  }, [])

  const flyTo = useCallback((c: LngLat) => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 15), duration: 600 })
  }, [])

  useEffect(() => {
    if (!mapReady || loadState !== 'ready' || didFitRef.current) return
    didFitRef.current = true
    fitToDirection('outbound', false)
  }, [mapReady, loadState, fitToDirection])

  // ── Focus / scroll helpers
  useEffect(() => {
    if (!focusKey) return
    const el = document.getElementById(`wp-name-${focusKey}`) as HTMLInputElement | null
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
    setFocusKey(null)
  }, [focusKey])

  useEffect(() => {
    if (!selectedKey) return
    document.getElementById(`point-card-${selectedKey}`)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selectedKey])

  // ── Keyboard: Ctrl/Cmd+Z undo, Esc = view mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      if (typing) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      } else if (e.key === 'Escape') {
        setClickMode('view')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo])

  // ---------------------------------------------------------------- edit operations

  const setEndpoint = (dir: DirectionType, which: 'origin' | 'destination', coordinates: LngLat, name?: string) => {
    if (readOnly) return
    editDirection(dir, (s) => ({ ...s, [which]: { name: name ?? s[which]?.name ?? '', coordinates } }))
    const updated = dirsRef.current[dir]
    setClickMode((m) => modeAfterEndpoints(updated, m))
    setSelectedKey(which === 'origin' ? ORIGIN_KEY : DEST_KEY)
  }

  const addWaypoint = (dir: DirectionType, coordinates: LngLat, isStop: boolean, name = '') => {
    if (readOnly) return
    const state = dirsRef.current[dir]
    if (!state.origin || !state.destination) {
      showToast('info', "Avval A va B nuqtalarni tanlang, so'ng oraliq nuqtalar qo'shing")
      setClickMode(!state.origin ? 'origin' : 'destination')
      return
    }
    if (state.waypoints.length >= EDITOR_LIMITS.maxWaypoints) {
      showToast('error', `Bitta yo'nalishda ${EDITOR_LIMITS.maxWaypoints} tadan ortiq oraliq nuqta bo'lishi mumkin emas`)
      return
    }
    const index = insertionIndex(state, coordinates)
    const waypoint: EditorWaypoint = { key: newWaypointKey(), id: null, name, coordinates, isStop }
    editDirection(dir, (s) => {
      const list = [...s.waypoints]
      list.splice(index, 0, waypoint)
      return { ...s, waypoints: list }
    })
    setSelectedKey(waypoint.key)
    if (isStop && !name) setFocusKey(waypoint.key)
  }

  const updateWaypoint = (key: string, patch: Partial<EditorWaypoint>, coalesceKey?: string) => {
    editDirection(
      active,
      (s) => ({ ...s, waypoints: s.waypoints.map((w) => (w.key === key ? { ...w, ...patch } : w)) }),
      coalesceKey,
    )
  }

  const removeWaypoint = (key: string) => {
    editDirection(active, (s) => ({ ...s, waypoints: s.waypoints.filter((w) => w.key !== key) }))
    setSelectedKey((k) => (k === key ? null : k))
  }

  const moveWaypoint = (index: number, delta: -1 | 1) => {
    editDirection(active, (s) => {
      const target = index + delta
      if (target < 0 || target >= s.waypoints.length) return s
      const list = [...s.waypoints]
      ;[list[index], list[target]] = [list[target], list[index]]
      return { ...s, waypoints: list }
    })
  }

  const renameEndpoint = (which: 'origin' | 'destination', name: string) => {
    editDirection(active, (s) => (s[which] ? { ...s, [which]: { ...s[which]!, name } } : s), `${active}:${which}:name`)
  }

  const swapEndpoints = () => {
    const s = dirsRef.current[active]
    if (!s.origin && !s.destination) return
    editDirection(active, (cur) => reverseInto(cur, cur))
    showToast('info', "A va B almashtirildi, oraliq nuqtalar teskari tartibda. Yo'l qayta chizilmoqda")
  }

  const copyReversedOutbound = () => {
    const out = dirsRef.current.outbound
    if (!out.origin || !out.destination) {
      showToast('error', "Avval Borish yo'nalishida A va B nuqtalarni tanlang")
      return
    }
    const inbound = dirsRef.current.inbound
    const hasInbound = Boolean(inbound.origin || inbound.destination || inbound.waypoints.length)
    if (hasInbound && !window.confirm("Qaytish yo'nalishidagi joriy nuqtalar almashtiriladi. Davom etasizmi?")) return
    editDirection('inbound', (cur) => reverseInto(out, cur))
    setActive('inbound')
    setSelectedKey(null)
    setClickMode('view')
    showToast(
      'info',
      "Borish teskari tartibda Qaytishga nusxalandi. Yo'l backend orqali qayta chiziladi — bir tomonlama ko'chalarni tekshiring",
    )
  }

  const switchDirection = (dir: DirectionType) => {
    if (dir === active) return
    setActive(dir)
    setSelectedKey(null)
    const s = dirsRef.current[dir]
    setClickMode((m) => (readOnly ? 'view' : modeAfterEndpoints(s, m)))
  }

  const pickPlace = (place: Place, target: 'origin' | 'destination' | 'stop') => {
    const c = toLngLat(place.coordinates[1], place.coordinates[0])
    if (target === 'stop') addWaypoint(active, c, true, place.name.slice(0, EDITOR_LIMITS.waypointNameMax))
    else setEndpoint(active, target, c, place.name.slice(0, EDITOR_LIMITS.pointNameMax))
    flyTo(c)
  }

  // Map handlers read the latest render's closures (no stale state in MapLibre listeners).
  useLayoutEffect(() => {
    handlersRef.current = {
      onMapClick: (p) => {
        if (readOnly || loadState !== 'ready') return
        if (clickMode === 'origin') setEndpoint(active, 'origin', p)
        else if (clickMode === 'destination') setEndpoint(active, 'destination', p)
        else if (clickMode === 'stop') addWaypoint(active, p, true)
        else if (clickMode === 'shape') addWaypoint(active, p, false)
      },
      onMarkerMoved: (key, p) => {
        if (readOnly) return
        if (key === ORIGIN_KEY) editDirection(active, (s) => (s.origin ? { ...s, origin: { ...s.origin, coordinates: p } } : s))
        else if (key === DEST_KEY) {
          editDirection(active, (s) => (s.destination ? { ...s, destination: { ...s.destination, coordinates: p } } : s))
        } else {
          editDirection(active, (s) => ({
            ...s,
            waypoints: s.waypoints.map((w) => (w.key === key ? { ...w, coordinates: p } : w)),
          }))
        }
        setSelectedKey(key)
      },
      onMarkerClick: (key) => setSelectedKey(key),
      onMarkerContext: (key) => {
        if (readOnly || key === ORIGIN_KEY || key === DEST_KEY) return
        removeWaypoint(key)
      },
    }
  })

  // ---------------------------------------------------------------- persistence

  /** PUT /routes/{id}/directions/{dir}. Returns an error message or null. */
  const persistDirection = async (dir: DirectionType): Promise<string | null> => {
    const state = dirsRef.current[dir]
    const problems = validateDirectionForSave(state)
    if (problems.length) return `${DIRECTION_LABEL[dir]}: ${problems.join('; ')}`
    const sentFingerprint = directionFingerprint(state)
    try {
      const saved = await routeEditorApi.saveDirection(routeId, state)
      const current = dirsRef.current
      if (directionFingerprint(current[dir]) === sentFingerprint) {
        // The backend does not store the provider/warning of the geometry: keep what the preview said.
        const preview =
          saved.preview && current[dir].preview
            ? { ...saved.preview, provider: current[dir].preview!.provider, warning: current[dir].preview!.warning }
            : saved.preview
        const next = { ...saved, preview }
        commitDirs({ ...current, [dir]: next })
        setBaseline((b) => ({ ...b, [dir]: directionFingerprint(next) }))
        setSelectedKey(null)
      } else {
        // Edited while saving: what was sent is the new baseline, newer edits stay unsaved.
        commitDirs({ ...current, [dir]: { ...current[dir], saved: true } })
        setBaseline((b) => ({ ...b, [dir]: sentFingerprint }))
      }
      return null
    } catch (err) {
      return `${DIRECTION_LABEL[dir]} saqlanmadi: ${errorMessage(err)}`
    }
  }

  /** PUT /routes/{id} with only the changed metadata. */
  const persistMeta = async (): Promise<string | null> => {
    const problems = validateMeta(meta)
    if (problems.length) return problems.join('; ')
    const body = buildMetaUpdate(savedMeta, meta)
    if (!Object.keys(body).length) return null
    const sent = meta
    try {
      const r = await routeEditorApi.updateRoute(routeId, body)
      const next: RouteMetaState = { routeNumber: r.route_number, name: r.name, description: r.description ?? '' }
      setSavedMeta(next)
      setMeta((m) => (m === sent ? next : m))
      return null
    } catch (err) {
      return `Ma'lumotlar saqlanmadi: ${metaErrorMessage(err, 'xatolik')}`
    }
  }

  const saveAll = async () => {
    if (!isDirty || saving) return
    setSaving('all')
    const errors: string[] = []
    if (metaDirty) {
      const e = await persistMeta()
      if (e) errors.push(e)
    }
    for (const dir of DIRECTIONS) {
      if (!dirDirty[dir]) continue
      const e = await persistDirection(dir)
      if (e) errors.push(e)
    }
    setSaving(null)
    if (errors.length) showToast('error', errors.join('\n'))
    else showToast('success', info.isPublished ? "Saqlandi — o'zgarishlar yo'lovchilarga ko'rinadi" : "O'zgarishlar saqlandi")
  }

  const saveDirection = async (dir: DirectionType) => {
    if (saving) return
    setSaving(dir)
    const e = await persistDirection(dir)
    setSaving(null)
    if (e) showToast('error', e)
    else showToast('success', `${DIRECTION_LABEL[dir]} saqlandi`)
  }

  const togglePublish = async () => {
    if (readOnly || publishing) return
    const next = !info.isPublished
    if (next && isDirty) {
      showToast('error', "Avval o'zgarishlarni saqlang: chop etishda faqat saqlangan ma'lumotlar ishlatiladi")
      return
    }
    if (!next && !window.confirm("Yo'nalish yo'lovchilardan yashiriladi (qoralamaga o'tadi). Davom etasizmi?")) return
    setPublishing(true)
    try {
      const r = await routeEditorApi.setPublished(routeId, next)
      setInfo((i) => ({ ...i, isPublished: r.is_published }))
      showToast('success', r.is_published ? "Yo'nalish chop etildi — yo'lovchilarga ko'rinadi" : "Yo'nalish yashirildi (qoralama)")
    } catch (err) {
      showToast('error', `${next ? "Chop etib bo'lmadi" : "Yashirib bo'lmadi"}: ${errorMessage(err)}`)
    } finally {
      setPublishing(false)
    }
  }

  const goBack = () => {
    if (isDirty && !window.confirm(LEAVE_MESSAGE)) return
    navigate(`${base}/routes`)
  }

  // ---------------------------------------------------------------- derived view data

  const activeRouting = routing[active]
  const activeProblems = validateDirectionForSave(activeState)
  const activePreview = activeState.preview
  const canAddWaypoints = Boolean(activeState.origin && activeState.destination) && !readOnly
  const publishReady =
    DIRECTIONS.every((d) => dirs[d].saved && dirs[d].preview) && !isDirty
  const currentHint = MODES.find((m) => m.id === clickMode)?.hint ?? ''

  const tabStats = (d: DirectionType) => {
    const s = dirs[d]
    if (routing[d].loading) return 'hisoblanmoqda…'
    if (!s.origin || !s.destination) return 'chizilmagan'
    if (!s.preview) return routing[d].error ? 'xatolik' : 'geometriya yo‘q'
    const stats = `${formatDistance(s.preview.distanceMeters)} • ~${formatDuration(s.preview.durationSeconds)}`
    return hasFreshGeometry(s) ? stats : `${stats} (eskirgan)`
  }

  const sourceLabel = (() => {
    if (activeRouting.loading) return "Yo'l hisoblanmoqda…"
    if (!activePreview) return activeState.origin && activeState.destination ? 'Geometriya yo‘q' : 'A va B tanlang'
    if (!activeFresh) return 'Geometriya eskirgan (nuqtalar o‘zgargan)'
    if (activePreview.provider) return `Manba: ${activePreview.provider.toUpperCase()} (backend yo'l xizmati)`
    return 'Saqlangan geometriya'
  })()

  const renderEndpointCard = (which: 'origin' | 'destination') => {
    const point = activeState[which]
    const key = which === 'origin' ? ORIGIN_KEY : DEST_KEY
    const isOrigin = which === 'origin'
    return (
      <div
        id={`point-card-${key}`}
        className={`point-card ${selectedKey === key ? 'selected' : ''}`}
        onClick={() => setSelectedKey(key)}
      >
        <div className="point-card__left">
          <div className={`point-marker-dot ${isOrigin ? 'start' : 'end'}`}>{key}</div>
          <div className="point-card__body">
            <input
              type="text"
              className="point-card__name-input"
              value={point?.name ?? ''}
              disabled={!point || readOnly}
              maxLength={EDITOR_LIMITS.pointNameMax}
              onChange={(e) => renameEndpoint(which, e.target.value)}
              onBlur={() => {
                lastCoalesceRef.current = null
              }}
              placeholder={point ? (isOrigin ? 'Bosh bekat nomi (majburiy)' : 'Oxirgi bekat nomi (majburiy)') : isOrigin ? 'A nuqta tanlanmagan' : 'B nuqta tanlanmagan'}
            />
            <div className="point-card__coords">
              {point ? coordText(point.coordinates) : `Xaritada «${isOrigin ? 'A' : 'B'} tanlash» yoki qidiruvdan tanlang`}
            </div>
          </div>
        </div>
        <div className="point-card__actions">
          <button
            className={`btn-point-icon ${clickMode === which ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              setClickMode(which)
            }}
            disabled={readOnly}
            title={`${isOrigin ? 'A' : 'B'} ni xaritadan tanlash`}
          >
            <i className="ri-crosshair-2-line" />
          </button>
          {point && (
            <button
              className="btn-point-icon"
              onClick={(e) => {
                e.stopPropagation()
                flyTo(point.coordinates)
              }}
              title="Xaritada ko'rsatish"
            >
              <i className="ri-focus-3-line" />
            </button>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------- render

  return (
    <div className="route-editor-layout">
      <header className="editor-top-bar">
        <div className="editor-top-bar__left">
          <button className="btn-back-link" onClick={goBack} title="Yo'nalishlar ro'yxatiga qaytish">
            <i className="ri-arrow-left-line" />
          </button>

          <div className="editor-route-title-input">
            <input
              type="text"
              className="input-route-num"
              value={meta.routeNumber}
              onChange={(e) => setMeta((m) => ({ ...m, routeNumber: e.target.value }))}
              maxLength={EDITOR_LIMITS.routeNumberMax}
              disabled={readOnly || loadState !== 'ready'}
              placeholder="№"
              title="Yo'nalish raqami"
            />
            <input
              type="text"
              className="input-route-name"
              value={meta.name}
              onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))}
              maxLength={EDITOR_LIMITS.routeNameMax}
              disabled={readOnly || loadState !== 'ready'}
              placeholder="Yo'nalish nomi..."
              title="Yo'nalish nomi"
            />
          </div>

          {loadState === 'ready' && (
            <span className={`editor-status-pill ${info.isArchived ? 'archived' : info.isPublished ? 'published' : 'draft'}`}>
              {info.isArchived ? 'Arxivlangan' : info.isPublished ? 'Chop etilgan' : 'Qoralama'}
            </span>
          )}

          {isDirty && (
            <span className="unsaved-dot" title="Saqlanmagan o'zgarishlar bor">
              <i className="ri-record-circle-line" />
              <span className="btn-label">Saqlanmagan o'zgarishlar</span>
            </span>
          )}
        </div>

        <div className="editor-top-bar__actions">
          <button
            className="btn-editor-action"
            onClick={() => fitToDirection(active, true)}
            title="Marshrutni ekranga moslash (fit bounds)"
          >
            <i className="ri-focus-3-line" />
            <span className="btn-label">Moslash</span>
          </button>

          <button
            className="btn-editor-action"
            onClick={undo}
            disabled={historySize === 0 || readOnly}
            title="Oxirgi tahrirni bekor qilish (Ctrl+Z)"
          >
            <i className="ri-arrow-go-back-line" />
            <span className="btn-label">Bekor qilish</span>
          </button>

          <button
            className="btn-editor-action btn-save-draft"
            onClick={saveAll}
            disabled={!isDirty || saving !== null || readOnly}
            title="Ma'lumotlar va o'zgargan yo'nalishlarni saqlash"
          >
            <i className={saving === 'all' ? 'ri-loader-4-line re-spin' : 'ri-save-3-line'} />
            <span className="btn-label">Saqlash</span>
          </button>

          <button
            className={`btn-editor-action ${info.isPublished ? 'btn-unpublish' : 'btn-publish'}`}
            onClick={togglePublish}
            disabled={publishing || readOnly || loadState !== 'ready'}
            title={
              info.isPublished
                ? "Yo'lovchilardan yashirish (qoralamaga o'tkazish)"
                : publishReady
                  ? "Yo'lovchilarga ko'rsatish"
                  : "Chop etish uchun ikkala yo'nalish geometriyasi saqlangan bo'lishi kerak"
            }
          >
            <i
              className={
                publishing ? 'ri-loader-4-line re-spin' : info.isPublished ? 'ri-eye-off-line' : 'ri-check-double-line'
              }
            />
            {info.isPublished ? 'Yashirish' : 'Chop etish'}
          </button>
        </div>
      </header>

      <div className="editor-workspace">
        <aside className="editor-sidebar">
          <div className="direction-tabs-header">
            {DIRECTIONS.map((d) => (
              <button
                key={d}
                className={`direction-tab-btn ${active === d ? 'active' : ''}`}
                onClick={() => switchDirection(d)}
              >
                <span className="direction-tab-btn__title">
                  <i className={d === 'outbound' ? 'ri-arrow-right-line' : 'ri-arrow-left-line'} />
                  {DIRECTION_LABEL[d]}
                  {dirDirty[d] && <span className="tab-dirty-dot" title="Saqlanmagan o'zgarishlar" />}
                </span>
                <span className="direction-tab-btn__stats">{tabStats(d)}</span>
              </button>
            ))}
          </div>

          <div className="editor-sidebar__content">
            {readOnly && (
              <div className="editor-banner error">
                <i className="ri-archive-line" />
                <div>Yo'nalish arxivlangan — tahrirlash va chop etish mumkin emas.</div>
              </div>
            )}
            {!readOnly && info.isPublished && (
              <div className="editor-banner info">
                <i className="ri-broadcast-line" />
                <div>Yo'nalish chop etilgan: saqlangan o'zgarishlar yo'lovchilarga darhol ko'rinadi.</div>
              </div>
            )}
            {activePreview?.warning && activeFresh && (
              <div className="editor-banner warning">
                <i className="ri-alert-fill" />
                <div>
                  <strong>Taxminiy geometriya.</strong> {activePreview.warning}
                </div>
              </div>
            )}
            {activeRouting.error && (
              <div className="editor-banner error">
                <i className="ri-error-warning-fill" />
                <div>
                  <strong>Yo'l chizilmadi.</strong> {activeRouting.error}
                  {activePreview && ' Oxirgi to‘g‘ri geometriya xaritada kulrang ko‘rsatilgan.'}
                  <div>
                    <button
                      className="banner-action-btn"
                      onClick={() => setRetryNonce((n) => ({ ...n, [active]: n[active] + 1 }))}
                    >
                      <i className="ri-refresh-line" /> Qayta urinish
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className={`route-stats-strip ${activeFresh ? '' : 'stale'}`}>
              <div className="stat-box">
                <span className="val accent">{activePreview ? formatDistance(activePreview.distanceMeters) : '—'}</span>
                <span className="lbl">Masofa</span>
              </div>
              <div className="stat-box">
                <span className="val">{activePreview ? formatDuration(activePreview.durationSeconds) : '—'}</span>
                <span className="lbl">Vaqt</span>
              </div>
              <div className="stat-box">
                <span className="val">{stopCount(activeState)}</span>
                <span className="lbl">Bekatlar</span>
              </div>
            </div>
            <div className={`routing-status-line ${activeRouting.loading ? 'loading' : ''}`}>
              <i className={activeRouting.loading ? 'ri-loader-4-line re-spin' : 'ri-road-map-line'} />
              {sourceLabel}
            </div>

            <PlaceSearchBox
              getNear={() => {
                const c = mapRef.current?.getCenter()
                return c ? [c.lng, c.lat] : null
              }}
              canAddStop={canAddWaypoints}
              disabled={readOnly || loadState !== 'ready'}
              onPick={pickPlace}
            />

            <div className="points-sequence-container">
              {renderEndpointCard('origin')}

              {activeState.waypoints.map((w, idx) => (
                <div
                  key={w.key}
                  id={`point-card-${w.key}`}
                  className={`point-card ${w.isStop ? '' : 'shape'} ${selectedKey === w.key ? 'selected' : ''}`}
                  onClick={() => setSelectedKey(w.key)}
                >
                  <div className="point-card__left">
                    <div className={`point-marker-dot ${w.isStop ? 'waypoint' : 'shape'}`}>{idx + 1}</div>
                    <div className="point-card__body">
                      <input
                        id={`wp-name-${w.key}`}
                        type="text"
                        className="point-card__name-input"
                        value={w.name}
                        disabled={readOnly}
                        maxLength={EDITOR_LIMITS.waypointNameMax}
                        onChange={(e) => updateWaypoint(w.key, { name: e.target.value }, `${active}:${w.key}:name`)}
                        onBlur={() => {
                          lastCoalesceRef.current = null
                        }}
                        placeholder={w.isStop ? 'Bekat nomi (majburiy)' : 'Oraliq nuqta (nomi ixtiyoriy)'}
                      />
                      <div className="point-card__meta">
                        <label className="stop-toggle" title="Bekat: yo'lovchi chiqadi/tushadi. O'chirilsa — faqat yo'lni shakllantiruvchi nuqta">
                          <input
                            type="checkbox"
                            checked={w.isStop}
                            disabled={readOnly}
                            onChange={() => updateWaypoint(w.key, { isStop: !w.isStop })}
                          />
                          Bekat
                        </label>
                        <span className="point-card__coords">{coordText(w.coordinates)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="point-card__actions">
                    <button
                      className="btn-point-icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        flyTo(w.coordinates)
                      }}
                      title="Xaritada ko'rsatish"
                    >
                      <i className="ri-focus-3-line" />
                    </button>
                    <button
                      className="btn-point-icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveWaypoint(idx, -1)
                      }}
                      disabled={idx === 0 || readOnly}
                      title="Yuqoriga surish"
                    >
                      <i className="ri-arrow-up-s-line" />
                    </button>
                    <button
                      className="btn-point-icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        moveWaypoint(idx, 1)
                      }}
                      disabled={idx === activeState.waypoints.length - 1 || readOnly}
                      title="Pastga surish"
                    >
                      <i className="ri-arrow-down-s-line" />
                    </button>
                    <button
                      className="btn-point-icon delete"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeWaypoint(w.key)
                      }}
                      disabled={readOnly}
                      title="O'chirish"
                    >
                      <i className="ri-close-line" />
                    </button>
                  </div>
                </div>
              ))}

              <div className="add-point-row">
                <button
                  className={`btn-add-waypoint-strip ${clickMode === 'stop' ? 'active' : ''}`}
                  onClick={() => setClickMode('stop')}
                  disabled={!canAddWaypoints}
                  title={canAddWaypoints ? 'Xaritada bosib bekat qo‘shing' : 'Avval A va B nuqtalarni tanlang'}
                >
                  <i className="ri-add-circle-line" />
                  Bekat
                </button>
                <button
                  className={`btn-add-waypoint-strip shape ${clickMode === 'shape' ? 'active' : ''}`}
                  onClick={() => setClickMode('shape')}
                  disabled={!canAddWaypoints}
                  title={canAddWaypoints ? "Yo'lni kerakli ko'chadan o'tkazuvchi nuqta" : 'Avval A va B nuqtalarni tanlang'}
                >
                  <i className="ri-git-commit-line" />
                  Oraliq nuqta
                </button>
              </div>

              {renderEndpointCard('destination')}
            </div>

            <div className="direction-tools">
              <button
                className="btn-editor-action"
                onClick={swapEndpoints}
                disabled={readOnly || (!activeState.origin && !activeState.destination)}
                title="A va B ni almashtirish (oraliq nuqtalar teskari tartibda)"
              >
                <i className="ri-arrow-up-down-line" /> A ↔ B
              </button>
              {active === 'inbound' && (
                <button
                  className="btn-editor-action"
                  onClick={copyReversedOutbound}
                  disabled={readOnly || !dirs.outbound.origin || !dirs.outbound.destination}
                  title="Borish yo'nalishining nuqtalarini teskari tartibda Qaytishga nusxalash (yo'l qayta chiziladi)"
                >
                  <i className="ri-arrow-left-right-line" /> Borishni teskari qilib nusxalash
                </button>
              )}
            </div>

            <div className="direction-save-box">
              <button
                className="btn-editor-action btn-save-draft btn-direction-save"
                onClick={() => saveDirection(active)}
                disabled={readOnly || saving !== null || !dirDirty[active] || activeProblems.length > 0}
              >
                <i className={saving === active ? 'ri-loader-4-line re-spin' : 'ri-save-3-line'} />
                {DIRECTION_LABEL[active]} ni saqlash
              </button>
              {dirDirty[active] && activeProblems.length > 0 && (
                <ul className="validation-list">
                  {activeProblems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              {!dirDirty[active] && activeState.saved && <div className="direction-save-hint">Saqlangan holatda</div>}
              {!activeState.saved && !dirDirty[active] && (
                <div className="direction-save-hint">Bu yo'nalish hali chizilmagan</div>
              )}
            </div>

            <details className="editor-meta-details">
              <summary>
                <i className="ri-information-line" /> Yo'nalish ma'lumotlari
              </summary>
              <label className="editor-field">
                <span>Tavsif</span>
                <textarea
                  rows={3}
                  value={meta.description}
                  maxLength={EDITOR_LIMITS.descriptionMax}
                  disabled={readOnly || loadState !== 'ready'}
                  onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                  placeholder="Asosiy ko'chalar, xizmat vaqti va boshqa izohlar"
                />
              </label>
              {info.uyushmaName && <div className="direction-save-hint">Uyushma: {info.uyushmaName}</div>}
            </details>
          </div>
        </aside>

        <main className={`editor-map-canvas mode-${readOnly ? 'view' : clickMode}`}>
          <div className="map-overlay-stack">
            <div className="map-mode-toolbar" role="toolbar" aria-label="Xarita rejimi">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  className={`map-mode-btn ${m.id} ${clickMode === m.id ? 'active' : ''}`}
                  onClick={() => setClickMode(m.id)}
                  disabled={readOnly || ((m.id === 'stop' || m.id === 'shape') && !canAddWaypoints)}
                  title={m.hint}
                >
                  <i className={m.icon} />
                  {m.label}
                </button>
              ))}
            </div>
            {activeRouting.loading && (
              <div className="map-status-chip">
                <i className="ri-loader-4-line re-spin" /> Yo'l hisoblanmoqda…
              </div>
            )}
            {activeRouting.error && (
              <div className="map-status-chip error">
                <i className="ri-error-warning-line" /> Yo'l chizilmadi
                <button onClick={() => setRetryNonce((n) => ({ ...n, [active]: n[active] + 1 }))}>Qayta urinish</button>
              </div>
            )}
            {activePreview?.warning && activeFresh && (
              <div className="map-status-chip warning" title={activePreview.warning}>
                <i className="ri-alert-line" /> Taxminiy (to'g'ri chiziqli) geometriya — ko'chalar bo'yicha emas
              </div>
            )}
          </div>

          <div className="map-floating-instructions">
            <i className="ri-cursor-line" />
            <span>{readOnly ? "Arxivlangan yo'nalish — faqat ko'rish" : currentHint}</span>
          </div>

          <div ref={mapContainer} className="editor-map-container" />
        </main>

        {loadState !== 'ready' && (
          <div className="editor-overlay">
            {loadState === 'loading' ? (
              <div className="editor-overlay__card">
                <i className="ri-loader-4-line re-spin" />
                <span>Yo'nalish yuklanmoqda…</span>
              </div>
            ) : (
              <div className="editor-overlay__card error">
                <i className="ri-error-warning-line" />
                <span>{loadError}</span>
                <div className="editor-overlay__actions">
                  <button className="btn-editor-action" onClick={() => setReloadNonce((n) => n + 1)}>
                    <i className="ri-refresh-line" /> Qayta urinish
                  </button>
                  <button className="btn-editor-action" onClick={() => navigate(`${base}/routes`)}>
                    <i className="ri-arrow-left-line" /> Ro'yxatga qaytish
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {toast && (
        <div className={`editor-toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <i
            className={
              toast.kind === 'success' ? 'ri-checkbox-circle-fill' : toast.kind === 'error' ? 'ri-error-warning-fill' : 'ri-information-fill'
            }
          />
          <div className="editor-toast__text">
            {toast.text.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          <button className="editor-toast__close" onClick={() => setToast(null)} title="Yopish">
            <i className="ri-close-line" />
          </button>
        </div>
      )}
    </div>
  )
}
