import { useEffect, useRef, useState, useMemo } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from '../../contexts/AuthContext';
import { useLiveFleet } from '../../hooks/useLiveFleet';
import { VehicleDetailDrawer } from './VehicleDetailDrawer';
import type { LiveVehicleTelemetry } from '../../types/realtimeFleet';
import './OperationsLiveMap.css';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || 'get_your_key_at_maptiler';
const DEFAULT_CENTER: [number, number] = [72.355, 40.782]; // Andijon city center
const DEFAULT_ZOOM = 13;

export function OperationsLiveMap() {
  const { user } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  // Markers stored in refs for direct lifecycle management
  const vehicleMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const parkingMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // Realtime hook with WebSocket reconnect and stale detection
  const { vehicles, parkings, connectionState } = useLiveFleet();

  // Filters & selection state
  const [selectedRoute, setSelectedRoute] = useState<string>('all');
  const [selectedVehicle, setSelectedVehicle] = useState<LiveVehicleTelemetry | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Filter vehicles by role (Uyushma only sees its own; Admin sees all)
  const roleFilteredVehicles = useMemo(() => {
    if (user?.role === 'uyushma' && user.uyushma_id) {
      return vehicles.filter(v => v.uyushma_id === user.uyushma_id);
    }
    return vehicles;
  }, [vehicles, user]);

  // Route options with vehicle counts
  const routeOptions = useMemo(() => {
    const mapCounts = new Map<string, number>();
    roleFilteredVehicles.forEach(v => {
      mapCounts.set(v.route_number, (mapCounts.get(v.route_number) || 0) + 1);
    });
    return Array.from(mapCounts.entries()).map(([num, count]) => ({
      number: num,
      count,
    }));
  }, [roleFilteredVehicles]);

  // Vehicles filtered by selected route
  const displayedVehicles = useMemo(() => {
    if (selectedRoute === 'all') return roleFilteredVehicles;
    return roleFilteredVehicles.filter(v => v.route_number === selectedRoute);
  }, [roleFilteredVehicles, selectedRoute]);

  // ── Initialize MapLibre GL ──
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const styleUrl =
      MAPTILER_KEY && MAPTILER_KEY !== 'get_your_key_at_maptiler'
        ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`
        : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      attributionControl: false,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');

    m.on('load', () => {
      map.current = m;
      setMapReady(true);
    });

    return () => {
      // Clean up map markers and instance on unmount
      vehicleMarkersRef.current.forEach(marker => marker.remove());
      vehicleMarkersRef.current.clear();

      parkingMarkersRef.current.forEach(marker => marker.remove());
      parkingMarkersRef.current.clear();

      m.remove();
      map.current = null;
    };
  }, []);

  // ── Render / Update Vehicle Markers ──
  useEffect(() => {
    if (!map.current || !mapReady) return;

    const currentMarkerMap = vehicleMarkersRef.current;
    const activeIds = new Set<string>();

    displayedVehicles.forEach(vehicle => {
      activeIds.add(vehicle.vehicle_id);

      const existingMarker = currentMarkerMap.get(vehicle.vehicle_id);

      if (existingMarker) {
        // Smoothly update position
        existingMarker.setLngLat([vehicle.lng, vehicle.lat]);

        // Update DOM classes and rotation
        const el = existingMarker.getElement();
        el.className = `vehicle-marker-node ${vehicle.is_stale ? 'stale' : ''} ${vehicle.is_offline ? 'offline' : ''}`;

        const arrowEl = el.querySelector('.vehicle-marker-arrow') as HTMLElement;
        if (arrowEl) {
          arrowEl.style.transform = `rotate(${vehicle.heading}deg)`;
        }
      } else {
        // Create new HTML marker element
        const el = document.createElement('div');
        el.className = `vehicle-marker-node ${vehicle.is_stale ? 'stale' : ''} ${vehicle.is_offline ? 'offline' : ''}`;
        el.innerHTML = `
          <div class="vehicle-marker-bubble">
            <span class="vehicle-marker-badge">№ ${vehicle.route_number}</span>
            <span class="vehicle-marker-plate">${vehicle.plate_number}</span>
            <span class="vehicle-marker-arrow" style="transform: rotate(${vehicle.heading}deg)">
              <i class="ri-navigation-fill"></i>
            </span>
          </div>
        `;

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedVehicle(vehicle);
        });

        const newMarker = new maplibregl.Marker({ element: el })
          .setLngLat([vehicle.lng, vehicle.lat])
          .addTo(map.current!);

        currentMarkerMap.set(vehicle.vehicle_id, newMarker);
      }
    });

    // Remove markers of vehicles filtered out or destroyed
    currentMarkerMap.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove();
        currentMarkerMap.delete(id);
      }
    });
  }, [displayedVehicles, mapReady]);

  // ── Render / Update Parking Markers ──
  useEffect(() => {
    if (!map.current || !mapReady) return;

    const currentParkingMap = parkingMarkersRef.current;

    parkings.forEach(pkg => {
      let marker = currentParkingMap.get(pkg.id);
      if (marker) {
        const countEl = marker.getElement().querySelector('.parking-zone-counter');
        if (countEl) countEl.textContent = `${pkg.current_vehicles_count} ta`;
      } else {
        const el = document.createElement('div');
        el.className = 'parking-zone-badge';
        el.innerHTML = `
          <i class="ri-parking-box-fill"></i>
          <span>${pkg.name}</span>
          <span class="parking-zone-counter">${pkg.current_vehicles_count} ta</span>
        `;

        const newMarker = new maplibregl.Marker({ element: el })
          .setLngLat([pkg.lng, pkg.lat])
          .addTo(map.current!);

        currentParkingMap.set(pkg.id, newMarker);
      }
    });
  }, [parkings, mapReady]);

  // Center map on specific coordinates
  const handleCenterMap = (lat: number, lng: number) => {
    if (!map.current) return;
    map.current.flyTo({
      center: [lng, lat],
      zoom: 15.5,
      speed: 1.4,
      curve: 1.2,
    });
  };

  // Summary counts
  const onlineCount = roleFilteredVehicles.filter(v => v.shift_status === 'on_route' && !v.is_offline).length;
  const parkingCount = roleFilteredVehicles.filter(v => v.shift_status === 'in_parking').length;
  const offlineCount = roleFilteredVehicles.filter(v => v.is_offline || v.shift_status === 'offline').length;

  return (
    <div className="live-map-page">
      {/* Floating Top Control Bar */}
      <div className="live-map-topbar">
        {/* Route Filter Scroll */}
        <div className="live-map-glass-card">
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginRight: '0.2rem' }}>
            <i className="ri-filter-3-line" style={{ color: 'var(--admin-accent)' }} /> Marshrut:
          </span>

          <div className="route-chips-scroll">
            <button
              className={`route-chip ${selectedRoute === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedRoute('all')}
            >
              Hammasi
              <span className="route-chip__count">{roleFilteredVehicles.length}</span>
            </button>

            {routeOptions.map(rt => (
              <button
                key={rt.number}
                className={`route-chip ${selectedRoute === rt.number ? 'active' : ''}`}
                onClick={() => setSelectedRoute(rt.number)}
              >
                № {rt.number}
                <span className="route-chip__count">{rt.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Fleet KPI Summary & Connection Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div className="live-map-glass-card" style={{ display: 'none', gap: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#4ade80' }}>
              <i className="ri-broadcast-line" />
              <strong>{onlineCount}</strong> yo'nalishda
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#60a5fa' }}>
              <i className="ri-parking-box-line" />
              <strong>{parkingCount}</strong> stoyankada
            </div>
            {offlineCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: '#9ca3af' }}>
                <i className="ri-shut-down-line" />
                <strong>{offlineCount}</strong> oflayn
              </div>
            )}
          </div>

          <div className={`ws-status-badge ${connectionState}`}>
            <span className="ws-status-dot" />
            {connectionState === 'connected' && 'Ulangan'}
            {connectionState === 'connecting' && 'Ulanmoqda...'}
            {connectionState === 'reconnecting' && 'Qayta ulanmoqda...'}
            {connectionState === 'disconnected' && 'Aloqa yo\'q'}
          </div>
        </div>
      </div>

      {/* Map Viewport */}
      <div ref={mapContainer} className="live-map-viewport" />

      {/* Detail Drawer when vehicle is clicked */}
      {selectedVehicle && (
        <VehicleDetailDrawer
          vehicle={selectedVehicle}
          onClose={() => setSelectedVehicle(null)}
          onCenterMap={handleCenterMap}
        />
      )}
    </div>
  );
}
