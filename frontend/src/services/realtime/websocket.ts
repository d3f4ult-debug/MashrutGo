/**
 * WebSocket realtime service — manages connection to Dev1 backend
 * for live client watch events, parking updates, etc.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Event listener pattern
 * - Connection state tracking
 * - Clean unsubscribe on disconnect
 */

import type { WsEvent, WsEventType } from '../../types/map';

const WS_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_BASE) || 'ws://localhost:8000/ws';

type EventHandler = (event: WsEvent) => void;

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

class RealtimeService {
  private ws: WebSocket | null = null;
  private listeners = new Map<WsEventType, Set<EventHandler>>();
  private wildcardListeners = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private maxReconnectDelay = 30_000;
  private baseDelay = 1_000;
  private _state: ConnectionState = 'disconnected';
  private stateListeners = new Set<(state: ConnectionState) => void>();
  private token: string | null = null;
  private path: string = '';

  get state(): ConnectionState {
    return this._state;
  }

  private setState(s: ConnectionState) {
    this._state = s;
    this.stateListeners.forEach(fn => fn(s));
  }

  onStateChange(fn: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /**
   * Connect to the WebSocket endpoint.
   * @param path Sub-path appended to WS_BASE (e.g. "/driver/events")
   * @param token JWT token for auth
   */
  connect(path: string, token: string) {
    this.token = token;
    this.path = path;
    this.reconnectAttempt = 0;
    this._connect();
  }

  private _connect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }

    this.setState('connecting');

    const url = `${WS_BASE}${this.path}?token=${encodeURIComponent(this.token || '')}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState('connected');
    };

    this.ws.onmessage = (evt) => {
      try {
        const event: WsEvent = JSON.parse(evt.data);
        this.dispatch(event);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.setState('reconnecting');
    const delay = Math.min(
      this.baseDelay * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelay
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setState('disconnected');
  }

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function.
   */
  on(type: WsEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => this.listeners.get(type)?.delete(handler);
  }

  /**
   * Subscribe to all events (wildcard).
   */
  onAny(handler: EventHandler): () => void {
    this.wildcardListeners.add(handler);
    return () => this.wildcardListeners.delete(handler);
  }

  /**
   * Send a message to the server.
   */
  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Dispatch an event to registered listeners (used internally and for local simulation).
   */
  dispatch(event: WsEvent) {
    // Specific listeners
    this.listeners.get(event.type)?.forEach(fn => fn(event));
    // Wildcard listeners
    this.wildcardListeners.forEach(fn => fn(event));
  }
}

/** Singleton instance — shared across the app */
export const realtimeService = new RealtimeService();
