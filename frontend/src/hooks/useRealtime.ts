/**
 * React bindings for the shared realtime channels (services/realtime/websocket.ts).
 * Channels are ref-counted: any number of components may use the same connection.
 */
import { useEffect, useRef, useState } from 'react'
import type { ConnectionState, RealtimeChannel } from '../services/realtime/websocket'
import type { WsEvent, WsEventType } from '../types/map'

/** Keeps `channel` connected while mounted (and `enabled`); returns the live connection state. */
export function useChannel(channel: RealtimeChannel, enabled = true): ConnectionState {
  const [state, setState] = useState<ConnectionState>(channel.state)

  useEffect(() => {
    if (!enabled) return
    const off = channel.onStateChange(setState)
    const release = channel.acquire()
    setState(channel.state)
    return () => {
      off()
      release()
    }
  }, [channel, enabled])

  return enabled ? state : 'disconnected'
}

/** Subscribes to one event type; the latest `handler` is always used (no resubscribe per render). */
export function useChannelEvent<T = unknown>(
  channel: RealtimeChannel,
  type: WsEventType,
  handler: (evt: WsEvent<T>) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    return channel.on(type, (evt) => handlerRef.current(evt as WsEvent<T>))
  }, [channel, type, enabled])
}
