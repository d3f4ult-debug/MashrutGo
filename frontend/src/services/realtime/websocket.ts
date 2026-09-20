/**
 * Realtime channels over the backend WebSocket contract (docs/contracts/REALTIME_EVENTS.md).
 *
 * Envelope from the server: { event, data, timestamp (ISO), version }.
 * - `publicChannel`  -> /ws/realtime  (vehicle.location.updated, route.vehicle.status, parking.count.updated)
 * - `driverChannel`  -> /ws/driver?token=…  (client.nearby.*, payment.*, cashout.*, parking.status)
 *
 * Features: ref-counted connections shared by many hooks, exponential backoff reconnect,
 * keep-alive ping, connection state listeners, clean unsubscribe.
 */
import { getToken, wsUrl } from '../api/client'
import type { WsEvent, WsEventType } from '../../types/map'

type EventHandler = (event: WsEvent) => void

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

const PING_INTERVAL_MS = 25_000

export class RealtimeChannel {
  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<EventHandler>>()
  private wildcardListeners = new Set<EventHandler>()
  private stateListeners = new Set<(state: ConnectionState) => void>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private reconnectAttempt = 0
  private refCount = 0
  private _state: ConnectionState = 'disconnected'
  private query: Record<string, string | undefined> = {}

  constructor(
    private readonly path: string,
    private readonly authenticated: boolean,
    private readonly maxReconnectDelay = 30_000,
  ) {}

  get state(): ConnectionState {
    return this._state
  }

  private setState(state: ConnectionState) {
    this._state = state
    this.stateListeners.forEach((fn) => fn(state))
  }

  onStateChange(fn: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(fn)
    return () => {
      this.stateListeners.delete(fn)
    }
  }

  /** Acquire the shared connection. Returns a release function. */
  acquire(query: Record<string, string | undefined> = {}): () => void {
    this.refCount += 1
    const changed = JSON.stringify(query) !== JSON.stringify(this.query)
    this.query = query
    if (!this.ws || changed) this.open()
    let released = false
    return () => {
      if (released) return
      released = true
      this.refCount = Math.max(0, this.refCount - 1)
      if (this.refCount === 0) this.close()
    }
  }

  private open() {
    this.teardownSocket()
    if (typeof WebSocket === 'undefined') return
    const token = this.authenticated ? getToken() : null
    if (this.authenticated && !token) {
      this.setState('disconnected')
      return
    }
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting')
    let socket: WebSocket
    try {
      socket = new WebSocket(wsUrl(this.path, { ...this.query, token: token ?? undefined }))
    } catch {
      this.scheduleReconnect()
      return
    }
    this.ws = socket

    socket.onopen = () => {
      this.reconnectAttempt = 0
      this.setState('connected')
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('ping')
      }, PING_INTERVAL_MS)
    }
    socket.onmessage = (evt) => {
      if (evt.data === 'pong') return
      try {
        const raw = JSON.parse(evt.data as string) as { event?: string; data?: unknown; timestamp?: string }
        if (!raw.event) return
        const parsed = Date.parse(raw.timestamp ?? '')
        this.dispatch({
          type: raw.event as WsEventType,
          payload: raw.data,
          timestamp: Number.isNaN(parsed) ? Date.now() : parsed,
        })
      } catch {
        // ignore malformed frames
      }
    }
    socket.onclose = (evt) => {
      if (this.ws !== socket) return
      this.clearPing()
      this.ws = null
      // 1008 = policy violation (bad/expired token): do not hammer the server
      if (this.refCount > 0 && evt.code !== 1008) this.scheduleReconnect()
      else this.setState('disconnected')
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.refCount === 0) return
    this.setState('reconnecting')
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, this.maxReconnectDelay)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.refCount > 0) this.open()
    }, delay)
  }

  private clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  private teardownSocket() {
    this.clearPing()
    if (this.ws) {
      const socket = this.ws
      this.ws = null
      socket.onclose = null
      socket.onmessage = null
      try {
        socket.close()
      } catch {
        // already closed
      }
    }
  }

  /** Force a fresh connection (e.g. after the driver starts a shift so the server re-reads the route). */
  reconnect() {
    if (this.refCount > 0) {
      this.reconnectAttempt = 0
      this.open()
    }
  }

  private close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.teardownSocket()
    this.reconnectAttempt = 0
    this.setState('disconnected')
  }

  on(type: WsEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(handler)
    return () => {
      this.listeners.get(type)?.delete(handler)
    }
  }

  onAny(handler: EventHandler): () => void {
    this.wildcardListeners.add(handler)
    return () => {
      this.wildcardListeners.delete(handler)
    }
  }

  send(event: string, data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, data }))
    }
  }

  dispatch(event: WsEvent) {
    this.listeners.get(event.type)?.forEach((fn) => fn(event))
    this.wildcardListeners.forEach((fn) => fn(event))
  }
}

export const publicChannel = new RealtimeChannel('/realtime', false)
export const driverChannel = new RealtimeChannel('/driver', true)
