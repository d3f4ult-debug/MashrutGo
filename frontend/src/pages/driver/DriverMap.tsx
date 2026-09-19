/**
 * Driver Live Map — Stage 2
 *
 * Features:
 * - MapLibre GL with MapTiler tiles (dark style)
 * - Assigned route geometry (outbound + inbound)
 * - Real-time waiting client markers via WebSocket
 * - Parking geofence status overlay
 * - Connection status indicator
 *
 * Client markers appear on "Kutayapman" and disappear on "Mashinadaman".
 * No client PII is shown — only session ID marker.
 */

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../services/api/client';
import { useRealtime, useWaitingClients, useParkingStatus } from '../../hooks/useRealtime';
import type { DriverRouteInfo, ParkingStatus, WaitingClient } from '../../types/map';
import './DriverMap.css';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || 'get_your_key_at_maptiler';

// Andijon city center default
const DEFAULT_CENTER: [number, number] = [72.344, 40.783];
const DEFAULT_ZOOM = 13;

export function DriverMap() {
  const { user } = useAuth();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const clientMarkersRef = useRef(new Map<string, maplibregl.Marker>());

  const [routeInfo, setRouteInfo] = useState<DriverRouteInfo | null>(null);
  const [parkings, setParkings] = useState<ParkingStatus[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Connect to realtime WebSocket
  const wsState = useRealtime('/driver/events');

  // Live waiting clients from WS
  const waitingClients = useWaitingClients();

  // Live parking statuses from WS
  const liveParkings = useParkingStatus(parkings);

  // ── Fetch route info & parkings on mount ──
  useEffect(() => {
    if (!user?.route_id) return;

    apiClient
      .get<DriverRouteInfo>(`/routes/${user.route_id}/driver-info`)
      .then(setRouteInfo)
      .catch(() => {
        // Backend not available — use mock data in dev mode
        if (import.meta.env.DEV) {
          setRouteInfo(getMockRouteInfo());
        }
      });

    apiClient
      .get<ParkingStatus[]>(`/routes/${user.route_id}/parkings`)
      .then(setParkings)
      .catch(() => {
        if (import.meta.env.DEV) {
          setParkings(getMockParkings());
        }
      });
  }, [user?.route_id]);

  // ── In dev mode, load mocks immediately if no route_id ──
  useEffect(() => {
    if (import.meta.env.DEV && !user?.route_id) {
      setRouteInfo(getMockRouteInfo());
      setParkings(getMockParkings());
    }
  }, [user?.route_id]);

  // ── Initialize MapLibre ──
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    try {
      const m = new maplibregl.Map({
        container: mapContainer.current,
        style: `https://api.maptiler.com/maps/dataviz-dark/style.json?key=${MAPTILER_KEY}`,
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
      });

      m.addControl(new maplibregl.NavigationControl(), 'top-right');
      m.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        'top-right'
      );
      m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

      m.on('load', () => {
        setMapReady(true);
      });

      m.on('error', (e) => {
        console.error('Map error:', e);
        if (e.error?.message?.includes('403') || e.error?.message?.includes('401')) {
          setLoadError('MapTiler kaliti noto\'g\'ri. VITE_MAPTILER_KEY ni .env ga qo\'shing.');
        }
      });

      map.current = m;
    } catch (err) {
      setLoadError('Xarita yuklanmadi');
      console.error(err);
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ── Draw route geometry ──
  useEffect(() => {
    if (!map.current || !mapReady || !routeInfo) return;
    const m = map.current;

    // Clean previous layers
    routeInfo.directions.forEach((_, i) => {
      const srcId = `route-direction-${i}`;
      if (m.getLayer(srcId)) m.removeLayer(srcId);
      if (m.getSource(srcId)) m.removeSource(srcId);
    });

    // Add each direction
    const bounds = new maplibregl.LngLatBounds();

    routeInfo.directions.forEach((dir, i) => {
      const srcId = `route-direction-${i}`;
      const isOutbound = dir.direction === 'outbound';

      m.addSource(srcId, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: { direction: dir.direction },
          geometry: dir.geometry,
        },
      });

      m.addLayer({
        id: srcId,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': isOutbound ? '#3b82f6' : '#22c55e',
          'line-width': 4,
          'line-opacity': 0.85,
        },
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
      });

      // Extend bounds
      dir.geometry.coordinates.forEach(([lng, lat]) => bounds.extend([lng, lat]));
    });

    // Fit map to route
    if (!bounds.isEmpty()) {
      m.fitBounds(bounds, { padding: 60, maxZoom: 15 });
    }
  }, [mapReady, routeInfo]);

  // ── Draw parking geofence circles ──
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const m = map.current;

    // Clean previous parking layers
    liveParkings.forEach((_, i) => {
      const srcId = `parking-${i}`;
      const layerId = `parking-fill-${i}`;
      const borderLayerId = `parking-border-${i}`;
      if (m.getLayer(layerId)) m.removeLayer(layerId);
      if (m.getLayer(borderLayerId)) m.removeLayer(borderLayerId);
      if (m.getSource(srcId)) m.removeSource(srcId);
    });

    liveParkings.forEach((p, i) => {
      const srcId = `parking-${i}`;
      const circle = createCircleGeoJSON(p.lat, p.lng, p.radius_m);

      m.addSource(srcId, { type: 'geojson', data: circle });

      m.addLayer({
        id: `parking-fill-${i}`,
        type: 'fill',
        source: srcId,
        paint: {
          'fill-color': p.is_driver_inside ? '#22c55e' : '#f59e0b',
          'fill-opacity': 0.15,
        },
      });

      m.addLayer({
        id: `parking-border-${i}`,
        type: 'line',
        source: srcId,
        paint: {
          'line-color': p.is_driver_inside ? '#22c55e' : '#f59e0b',
          'line-width': 2,
          'line-dasharray': [3, 2],
          'line-opacity': 0.6,
        },
      });
    });
  }, [mapReady, liveParkings]);

  // ── Update waiting client markers ──
  useEffect(() => {
    if (!map.current || !mapReady) return;
    const m = map.current;
    const existingMarkers = clientMarkersRef.current;
    const currentIds = new Set(waitingClients.map(c => c.session_id));

    // Remove markers for clients that stopped watching
    existingMarkers.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        existingMarkers.delete(id);
      }
    });

    // Add or update markers
    waitingClients.forEach((client) => {
      const existing = existingMarkers.get(client.session_id);
      if (existing) {
        // Update position
        existing.setLngLat([client.lng, client.lat]);
      } else {
        // Create new marker
        const el = document.createElement('div');
        el.className = 'waiting-client-marker';
        el.innerHTML = `
          <div class="waiting-client-marker__pulse"></div>
          <div class="waiting-client-marker__dot">
            <i class="ri-user-location-fill"></i>
          </div>
        `;

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([client.lng, client.lat])
          .setPopup(
            new maplibregl.Popup({ offset: 15, closeButton: false })
              .setHTML(`<div class="client-popup">Kutayapman <span class="client-popup__time">${formatTime(client.timestamp)}</span></div>`)
          )
          .addTo(m);

        existingMarkers.set(client.session_id, marker);
      }
    });
  }, [mapReady, waitingClients]);

  // ── Simulate mock clients in dev mode ──
  useEffect(() => {
    if (!import.meta.env.DEV || !mapReady) return;

    // Inject a few mock waiting clients after a delay
    const timer = setTimeout(() => {
      const mockEvents = getMockWaitingClients();
      mockEvents.forEach((client, i) => {
        setTimeout(() => {
          // Manually dispatch to simulate WS events
          window.dispatchEvent(new CustomEvent('mock-client-watch', { detail: client }));
        }, i * 800);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [mapReady]);

  return (
    <div className="driver-map-page">
      {/* Connection status bar */}
      <div className={`map-status-bar map-status-bar--${wsState}`}>
        <div className="map-status-bar__indicator" />
        <span>
          {wsState === 'connected' && 'Real-time ulangan'}
          {wsState === 'connecting' && 'Ulanmoqda...'}
          {wsState === 'reconnecting' && 'Qayta ulanmoqda...'}
          {wsState === 'disconnected' && 'Uzilgan'}
        </span>
        {waitingClients.length > 0 && (
          <span className="map-status-bar__badge">
            <i className="ri-user-location-fill" /> {waitingClients.length} kutmoqda
          </span>
        )}
      </div>

      {/* Map container */}
      <div className="driver-map-container" ref={mapContainer}>
        {loadError && (
          <div className="map-error-overlay">
            <i className="ri-error-warning-line" />
            <p>{loadError}</p>
          </div>
        )}
      </div>

      {/* Route info pill */}
      {routeInfo && (
        <div className="map-route-pill">
          <i className="ri-route-line" />
          <span className="map-route-pill__number">{routeInfo.route_number}</span>
          <span className="map-route-pill__name">{routeInfo.route_name}</span>
        </div>
      )}

      {/* Parking status cards */}
      {liveParkings.length > 0 && (
        <div className="map-parking-panel">
          {liveParkings.map((p) => (
            <div
              key={p.parking_id}
              className={`map-parking-card ${p.is_driver_inside ? 'map-parking-card--inside' : ''}`}
            >
              <div className="map-parking-card__icon">
                <i className={p.is_driver_inside ? 'ri-parking-box-fill' : 'ri-parking-box-line'} />
              </div>
              <div className="map-parking-card__info">
                <span className="map-parking-card__name">{p.name}</span>
                <span className="map-parking-card__count">
                  {p.vehicle_count} transport
                  {p.is_driver_inside && (
                    <span className="map-parking-card__inside-badge">Stoyanka hududida</span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      <div className="map-legend">
        <div className="map-legend__item">
          <span className="map-legend__color" style={{ background: '#3b82f6' }} />
          <span>Borish</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__color" style={{ background: '#22c55e' }} />
          <span>Qaytish</span>
        </div>
        <div className="map-legend__item">
          <span className="map-legend__color map-legend__color--client" />
          <span>Kutayapman</span>
        </div>
      </div>
    </div>
  );
}

// ── Helper: create circle GeoJSON from center + radius ──
function createCircleGeoJSON(lat: number, lng: number, radiusM: number) {
  const points = 64;
  const coords: [number, number][] = [];
  const km = radiusM / 1000;

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = km * Math.cos(angle);
    const dy = km * Math.sin(angle);
    const dlat = dy / 110.574;
    const dlng = dx / (111.320 * Math.cos((lat * Math.PI) / 180));
    coords.push([lng + dlng, lat + dlat]);
  }

  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [coords],
    },
  };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
}

// ── Mock data for dev mode ──
function getMockRouteInfo(): DriverRouteInfo {
  return {
    route_id: 'mock-route-1',
    route_number: '14',
    route_name: 'Navbahor — Yangi bozor',
    directions: [
      {
        id: 'dir-out',
        route_id: 'mock-route-1',
        direction: 'outbound',
        start_name: 'Navbahor',
        end_name: 'Yangi bozor',
        geometry: {
          type: 'LineString',
          coordinates: [
            [72.330, 40.790],
            [72.335, 40.788],
            [72.340, 40.785],
            [72.345, 40.783],
            [72.350, 40.780],
            [72.355, 40.778],
            [72.360, 40.776],
          ],
        },
      },
      {
        id: 'dir-in',
        route_id: 'mock-route-1',
        direction: 'inbound',
        start_name: 'Yangi bozor',
        end_name: 'Navbahor',
        geometry: {
          type: 'LineString',
          coordinates: [
            [72.360, 40.776],
            [72.356, 40.774],
            [72.351, 40.775],
            [72.346, 40.778],
            [72.341, 40.781],
            [72.336, 40.784],
            [72.331, 40.787],
            [72.330, 40.790],
          ],
        },
      },
    ],
  };
}

function getMockParkings(): ParkingStatus[] {
  return [
    {
      parking_id: 'park-1',
      name: 'Navbahor stoyankasi',
      lat: 40.790,
      lng: 72.330,
      radius_m: 150,
      vehicle_count: 3,
      is_driver_inside: false,
    },
    {
      parking_id: 'park-2',
      name: 'Yangi bozor stoyankasi',
      lat: 40.776,
      lng: 72.360,
      radius_m: 200,
      vehicle_count: 5,
      is_driver_inside: false,
    },
  ];
}

function getMockWaitingClients(): WaitingClient[] {
  return [
    { session_id: 'mock-c1', lat: 40.786, lng: 72.338, timestamp: Date.now() },
    { session_id: 'mock-c2', lat: 40.782, lng: 72.347, timestamp: Date.now() - 60000 },
    { session_id: 'mock-c3', lat: 40.778, lng: 72.354, timestamp: Date.now() - 120000 },
  ];
}
