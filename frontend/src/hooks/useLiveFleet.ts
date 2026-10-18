import { useState, useEffect, useRef } from 'react';
import { realtimeService, type ConnectionState } from '../services/realtime/websocket';
import { useAuth } from '../contexts/AuthContext';
import type { LiveVehicleTelemetry, LiveParkingZone } from '../types/realtimeFleet';
import type { WsEvent } from '../types/map';

const STALE_THRESHOLD_MS = 30_000;   // 30 seconds -> Stale
const OFFLINE_THRESHOLD_MS = 120_000; // 2 minutes -> Offline

// Mock fleet removed — real telemetry only
function getInitialMockFleet(): LiveVehicleTelemetry[] {
  return [];
}

function getInitialMockParkings(): LiveParkingZone[] {
  return [];
}

export function useLiveFleet() {
  const { token } = useAuth();
  const [vehicles, setVehicles] = useState<LiveVehicleTelemetry[]>(getInitialMockFleet);
  const [parkings, setParkings] = useState<LiveParkingZone[]>(getInitialMockParkings);
  const [connectionState, setConnectionState] = useState<ConnectionState>(realtimeService.state);

  const vehiclesRef = useRef<Map<string, LiveVehicleTelemetry>>(new Map());

  // Initialize reference map
  useEffect(() => {
    vehicles.forEach(v => vehiclesRef.current.set(v.vehicle_id, v));
  }, []);

  // ── WebSocket subscription and reconnect handling ──
  useEffect(() => {
    if (!token) return;

    const unsubState = realtimeService.onStateChange(setConnectionState);
    realtimeService.connect('/operations/live-telemetry', token);

    // Subscribe to live vehicle telemetry events
    const unsubLocation = realtimeService.on('vehicle.location.updated', (evt: WsEvent) => {
      const p = evt.payload as Partial<LiveVehicleTelemetry>;
      if (!p.vehicle_id) return;

      const existing = vehiclesRef.current.get(p.vehicle_id);
      if (existing) {
        const updated: LiveVehicleTelemetry = {
          ...existing,
          ...p,
          last_seen: Date.now(),
          is_stale: false,
          is_offline: false,
        };
        vehiclesRef.current.set(p.vehicle_id, updated);
        setVehicles(Array.from(vehiclesRef.current.values()));
      }
    });

    // Subscribe to parking count updates
    const unsubParking = realtimeService.on('parking.count.updated', (evt: WsEvent) => {
      const p = evt.payload as { parking_id: string; vehicle_count: number };
      if (!p.parking_id) return;
      setParkings(prev =>
        prev.map(pkg =>
          pkg.id === p.parking_id ? { ...pkg, current_vehicles_count: p.vehicle_count } : pkg
        )
      );
    });

    return () => {
      unsubState();
      unsubLocation();
      unsubParking();
      realtimeService.disconnect();
    };
  }, [token]);

  // ── Stale Marker & Offline Check Interval (Every 5 seconds) ──
  // Checks last_seen timestamp. Crucial rule: Never deletes offline vehicles!
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let hasChanges = false;

      vehiclesRef.current.forEach((veh, id) => {
        const diff = now - veh.last_seen;
        const shouldBeStale = diff > STALE_THRESHOLD_MS;
        const shouldBeOffline = diff > OFFLINE_THRESHOLD_MS || veh.shift_status === 'offline';

        if (veh.is_stale !== shouldBeStale || veh.is_offline !== shouldBeOffline) {
          vehiclesRef.current.set(id, {
            ...veh,
            is_stale: shouldBeStale,
            is_offline: shouldBeOffline,
          });
          hasChanges = true;
        }
      });

      if (hasChanges) {
        setVehicles(Array.from(vehiclesRef.current.values()));
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // ── Smooth Dev Simulation (Moving vehicles slightly along roads) ──
  useEffect(() => {
    const simInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;

      vehiclesRef.current.forEach((veh, id) => {
        // Only move active online vehicles on route
        if (veh.shift_status === 'on_route' && !veh.is_offline) {
          // Small delta step in direction of heading
          const rad = (veh.heading * Math.PI) / 180;
          const deltaLat = Math.cos(rad) * 0.00018;
          const deltaLng = Math.sin(rad) * 0.00022;

          let newLat = veh.lat + deltaLat;
          let newLng = veh.lng + deltaLng;
          let newHeading = veh.heading;

          // Boundary bounce or slight turn
          if (newLat > 40.81 || newLat < 40.75) newHeading = (newHeading + 180) % 360;
          if (newLng > 72.38 || newLng < 72.32) newHeading = (newHeading + 180) % 360;

          const updated: LiveVehicleTelemetry = {
            ...veh,
            lat: newLat,
            lng: newLng,
            heading: newHeading,
            speed_kmh: Math.round(30 + Math.random() * 15),
            last_seen: now,
            is_stale: false,
          };
          vehiclesRef.current.set(id, updated);
          changed = true;
        }
      });

      if (changed) {
        setVehicles(Array.from(vehiclesRef.current.values()));
      }
    }, 3000);

    return () => clearInterval(simInterval);
  }, []);

  return {
    vehicles,
    parkings,
    connectionState,
  };
}
