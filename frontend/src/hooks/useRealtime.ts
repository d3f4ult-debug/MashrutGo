/**
 * React hooks for the realtime WebSocket service.
 */

import { useState, useEffect, useRef } from 'react';
import { realtimeService, type ConnectionState } from '../services/realtime/websocket';
import { useAuth } from '../contexts/AuthContext';
import type {
  WsEvent,
  WaitingClient,
  ParkingStatus,
  ClientWatchPayload,
  ClientWatchStoppedPayload,
  ParkingCountPayload,
} from '../types/map';

/**
 * Hook: connect to realtime WS on mount, disconnect on unmount.
 * Returns connection state.
 */
export function useRealtime(path: string): ConnectionState {
  const { token } = useAuth();
  const [state, setState] = useState<ConnectionState>(realtimeService.state);

  useEffect(() => {
    if (!token) return;

    const unsub = realtimeService.onStateChange(setState);
    realtimeService.connect(path, token);

    return () => {
      unsub();
      realtimeService.disconnect();
    };
  }, [path, token]);

  return state;
}

/**
 * Hook: maintain a live map of waiting clients from WS events.
 * Clients appear on `client.watch.started` / `.updated`,
 * disappear on `client.watch.stopped` ("Mashinadaman").
 */
export function useWaitingClients(): WaitingClient[] {
  const clientsRef = useRef(new Map<string, WaitingClient>());
  const [clients, setClients] = useState<WaitingClient[]>([]);

  useEffect(() => {
    const unsubStarted = realtimeService.on('client.watch.started', (evt: WsEvent) => {
      const p = evt.payload as ClientWatchPayload;
      clientsRef.current.set(p.session_id, {
        session_id: p.session_id,
        lat: p.lat,
        lng: p.lng,
        timestamp: evt.timestamp,
      });
      setClients(Array.from(clientsRef.current.values()));
    });

    const unsubUpdated = realtimeService.on('client.watch.updated', (evt: WsEvent) => {
      const p = evt.payload as ClientWatchPayload;
      clientsRef.current.set(p.session_id, {
        session_id: p.session_id,
        lat: p.lat,
        lng: p.lng,
        timestamp: evt.timestamp,
      });
      setClients(Array.from(clientsRef.current.values()));
    });

    const unsubStopped = realtimeService.on('client.watch.stopped', (evt: WsEvent) => {
      const p = evt.payload as ClientWatchStoppedPayload;
      clientsRef.current.delete(p.session_id);
      setClients(Array.from(clientsRef.current.values()));
    });

    return () => {
      unsubStarted();
      unsubUpdated();
      unsubStopped();
    };
  }, []);

  return clients;
}

/**
 * Hook: maintain live parking statuses from WS events.
 */
export function useParkingStatus(initialStatuses: ParkingStatus[] = []): ParkingStatus[] {
  const statusRef = useRef(new Map<string, ParkingStatus>());
  const [statuses, setStatuses] = useState<ParkingStatus[]>(initialStatuses);

  // Seed initial statuses
  useEffect(() => {
    initialStatuses.forEach(s => statusRef.current.set(s.parking_id, s));
    setStatuses(Array.from(statusRef.current.values()));
  }, [initialStatuses]);

  useEffect(() => {
    const unsub = realtimeService.on('parking.count.updated', (evt: WsEvent) => {
      const p = evt.payload as ParkingCountPayload;
      const existing = statusRef.current.get(p.parking_id);
      if (existing) {
        statusRef.current.set(p.parking_id, {
          ...existing,
          vehicle_count: p.vehicle_count,
          is_driver_inside: p.is_driver_inside,
        });
        setStatuses(Array.from(statusRef.current.values()));
      }
    });

    return unsub;
  }, []);

  return statuses;
}

/**
 * Hook: generic event listener for any WS event type.
 */
export function useRealtimeEvent(
  type: Parameters<typeof realtimeService.on>[0],
  handler: (evt: WsEvent) => void
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const unsub = realtimeService.on(type, (evt) => handlerRef.current(evt));
    return unsub;
  }, [type]);
}
