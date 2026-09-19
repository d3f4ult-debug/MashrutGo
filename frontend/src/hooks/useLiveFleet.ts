import { useState, useEffect, useRef } from 'react';
import { realtimeService, type ConnectionState } from '../services/realtime/websocket';
import { useAuth } from '../contexts/AuthContext';
import type { LiveVehicleTelemetry, LiveParkingZone } from '../types/realtimeFleet';
import type { WsEvent } from '../types/map';

const STALE_THRESHOLD_MS = 30_000;   // 30 seconds -> Stale
const OFFLINE_THRESHOLD_MS = 120_000; // 2 minutes -> Offline

// Default mock fleet for development simulation
function getInitialMockFleet(): LiveVehicleTelemetry[] {
  const now = Date.now();
  return [
    {
      vehicle_id: 'veh-101',
      plate_number: '60 A 777 AA',
      model: 'Isuzu SAZ NP37',
      color: 'Oq',
      driver_id: 'usr-driver-1',
      driver_name: 'Anvar Qodirov',
      driver_phone: '+998 90 123 45 67',
      uyushma_id: 'uyushma-01',
      uyushma_name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      route_id: 'rt-101',
      route_number: '12',
      direction: 'outbound',
      lat: 40.7850,
      lng: 72.3480,
      heading: 85,
      speed_kmh: 38,
      shift_status: 'on_route',
      last_seen: now - 3000,
      is_stale: false,
      is_offline: false,
    },
    {
      vehicle_id: 'veh-102',
      plate_number: '60 B 123 BB',
      model: 'Isuzu HC40',
      color: 'Oq',
      driver_id: 'usr-driver-2',
      driver_name: 'Jasur Saidov',
      driver_phone: '+998 91 234 56 78',
      uyushma_id: 'uyushma-01',
      uyushma_name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      route_id: 'rt-101',
      route_number: '12',
      direction: 'inbound',
      lat: 40.7725,
      lng: 72.3550,
      heading: 260,
      speed_kmh: 42,
      shift_status: 'on_route',
      last_seen: now - 8000,
      is_stale: false,
      is_offline: false,
    },
    {
      vehicle_id: 'veh-103',
      plate_number: '60 C 555 CC',
      model: 'Isuzu SAZ NP37',
      color: 'Moviy',
      driver_id: 'usr-driver-3',
      driver_name: 'Otabek Mirzayev',
      driver_phone: '+998 93 345 67 89',
      uyushma_id: 'uyushma-01',
      uyushma_name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      route_id: 'rt-102',
      route_number: '1',
      direction: 'outbound',
      lat: 40.7930,
      lng: 72.3620,
      heading: 140,
      speed_kmh: 0,
      shift_status: 'in_parking',
      last_seen: now - 45000, // Stale (>30s)
      is_stale: true,
      is_offline: false,
      assigned_parking_id: 'prk-1',
    },
    {
      vehicle_id: 'veh-104',
      plate_number: '60 D 999 DD',
      model: 'Yutong ZK6890HG',
      color: 'Yashil',
      driver_id: 'usr-driver-4',
      driver_name: 'Bobur Xolmatov',
      driver_phone: '+998 94 456 78 90',
      uyushma_id: 'uyushma-01',
      uyushma_name: 'Andijon Shahar Yo\'lovchi Tashish DUK',
      route_id: 'rt-103',
      route_number: '24',
      direction: 'outbound',
      lat: 40.7915,
      lng: 72.3390,
      heading: 180,
      speed_kmh: 32,
      shift_status: 'on_route',
      last_seen: now - 2000,
      is_stale: false,
      is_offline: false,
    },
    {
      vehicle_id: 'veh-105',
      plate_number: '60 E 001 EE',
      model: 'Isuzu SAZ NP37',
      color: 'Oq',
      driver_id: 'usr-driver-5',
      driver_name: 'Rustam Karimov',
      driver_phone: '+998 97 567 89 01',
      uyushma_id: 'uyushma-02',
      uyushma_name: 'Asaka Trans Servis MCHJ',
      route_id: 'rt-201',
      route_number: '5A',
      direction: 'outbound',
      lat: 40.7600,
      lng: 72.3300,
      heading: 0,
      speed_kmh: 0,
      shift_status: 'offline',
      last_seen: now - 240000, // Offline (>120s)
      is_stale: true,
      is_offline: true,
    },
  ];
}

function getInitialMockParkings(): LiveParkingZone[] {
  return [
    {
      id: 'prk-1',
      name: 'Eski Shahar Markaziy Stoyanka',
      uyushma_id: 'uyushma-01',
      lat: 40.7935,
      lng: 72.3615,
      radius_m: 120,
      current_vehicles_count: 3,
      capacity: 15,
    },
    {
      id: 'prk-2',
      name: 'Yangi Bozor Avtoshohqat' ,
      uyushma_id: 'uyushma-01',
      lat: 40.7680,
      lng: 72.3520,
      radius_m: 150,
      current_vehicles_count: 5,
      capacity: 20,
    },
    {
      id: 'prk-3',
      name: 'Temir Yo\'l Vokzali Stoyankasi',
      uyushma_id: 'uyushma-01',
      lat: 40.7760,
      lng: 72.3780,
      radius_m: 100,
      current_vehicles_count: 2,
      capacity: 10,
    },
  ];
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
