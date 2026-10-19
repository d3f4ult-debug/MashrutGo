import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import { routeEditorApi } from '../../services/api/routeEditorApi';
import { fetchRoadSegment } from '../../services/routing/roadRouting';
import { getSavedMapProvider, setSavedMapProvider, YANDEX_TILES_URL, type MapProvider } from '../../services/map/maptiler';
import type { RouteDraft } from '../../types/routeEditor';
import './RouteEditor.css';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || 'get_your_key_at_maptiler';
const ANDIJON_CENTER: [number, number] = [72.344, 40.783];

// Helper: Haversine distance in km
function calculateHaversineKm(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  let total = 0;
  const R = 6371;
  for (let i = 0; i < coords.length - 1; i++) {
    const c1 = coords[i];
    const c2 = coords[i + 1];
    const dLat = ((c2[1] - c1[1]) * Math.PI) / 180;
    const dLng = ((c2[0] - c1[0]) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((c1[1] * Math.PI) / 180) *
      Math.cos((c2[1] * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return parseFloat(total.toFixed(2));
}

// Distance threshold between points in meters (~12 meters) for freehand
function isFarEnough(p1: [number, number], p2: [number, number], minMeters = 12): boolean {
  const dLat = ((p2[1] - p1[1]) * Math.PI) / 180;
  const dLng = ((p2[0] - p1[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((p1[1] * Math.PI) / 180) *
    Math.cos((p2[1] * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  const distMeters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distMeters >= minMeters;
}

export function RouteEditor() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Route metadata
  const [routeNumber, setRouteNumber] = useState('12');
  const [routeName, setRouteName] = useState("O'sh ko'chasi — Yangi Bozor");
  const [routeStatus, setRouteStatus] = useState<'draft' | 'published'>('draft');

  // Direction tab
  const [activeDirection, setActiveDirection] = useState<'outbound' | 'inbound'>('outbound');

  // Coordinates per direction (pure polylines)
  const [outboundCoords, setOutboundCoords] = useState<[number, number][]>([]);
  const [inboundCoords, setInboundCoords] = useState<[number, number][]>([]);

  // Drawing tools: 'roads' (snaps to actual streets), 'freehand' (paint drag), 'pan' (drag map)
  const [toolMode, setToolMode] = useState<'roads' | 'freehand' | 'pan'>('roads');
  const toolModeRef = useRef<'roads' | 'freehand' | 'pan'>('roads');
  toolModeRef.current = toolMode;

  const [isRouting, setIsRouting] = useState(false);
  const isDrawingRef = useRef(false);
  const currentStrokeRef = useRef<[number, number][]>([]);

  // Undo history per direction
  const [outboundHistory, setOutboundHistory] = useState<[number, number][][]>([]);
  const [inboundHistory, setInboundHistory] = useState<[number, number][][]>([]);

  // Dirty state
  const [isDirty, setIsDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Map Provider (VirCity vs Yandex)
  const [mapProvider, setMapProvider] = useState<MapProvider>(() => getSavedMapProvider());

  // Active coordinates
  const currentCoords = activeDirection === 'outbound' ? outboundCoords : inboundCoords;
  const setCurrentCoords = activeDirection === 'outbound' ? setOutboundCoords : setInboundCoords;

  const currentHistory = activeDirection === 'outbound' ? outboundHistory : inboundHistory;
  const setCurrentHistory = activeDirection === 'outbound' ? setOutboundHistory : setInboundHistory;

  // Stats
  const distanceKm = calculateHaversineKm(currentCoords);
  const durationMin = Math.max(1, Math.round((distanceKm / 22) * 60));

  // ── Load route data if editing ──
  useEffect(() => {
    if (!id) return;
    uyushmaApi.getRoutes(uyushmaId).then(allRoutes => {
      const target = allRoutes.find(r => r.id === id);
      if (target) {
        setRouteNumber(target.route_number);
        setRouteName(target.route_name);
        setRouteStatus(target.is_active ? 'published' : 'draft');

        // Check local storage or existing geometry
        const localDraft = localStorage.getItem(`route_published_${id}`) || localStorage.getItem(`route_draft_${id}`);
        if (localDraft) {
          try {
            const parsed = JSON.parse(localDraft);
            if (parsed.outbound?.geometry?.coordinates?.length) {
              setOutboundCoords(parsed.outbound.geometry.coordinates);
            }
            if (parsed.inbound?.geometry?.coordinates?.length) {
              setInboundCoords(parsed.inbound.geometry.coordinates);
            }

            // Fit map to route bounds if map is ready
            setTimeout(() => {
              const map = mapRef.current;
              const coords = parsed.outbound?.geometry?.coordinates;
              if (map && coords && coords.length > 1) {
                const bounds = new maplibregl.LngLatBounds();
                coords.forEach((c: [number, number]) => bounds.extend(c));
                map.fitBounds(bounds, { padding: 80, duration: 800 });
              }
            }, 300);
          } catch {
            // Ignore parse errors
          }
        }
      }
    });
  }, [id, uyushmaId]);

  // ── Push to undo history ──
  const recordHistory = useCallback((coords: [number, number][]) => {
    setCurrentHistory(prev => [...prev.slice(-25), [...coords]]);
  }, [setCurrentHistory]);

  // ── Initialize MapLibre ──
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const styleUrl =
      MAPTILER_KEY && MAPTILER_KEY !== 'get_your_key_at_maptiler'
        ? `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`
        : 'https://tiles.openfreemap.org/styles/liberty';

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: ANDIJON_CENTER,
      zoom: 13,
      pitch: 0,
      dragRotate: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      // 0. Yandex Raster Source & Layer (base layer underneath drawn routes)
      map.addSource('yandex-raster-source', {
        type: 'raster',
        tiles: [YANDEX_TILES_URL],
        tileSize: 256,
        attribution: '© Yandex Xarita',
      });

      map.addLayer({
        id: 'yandex-raster-layer',
        type: 'raster',
        source: 'yandex-raster-source',
        minzoom: 0,
        maxzoom: 19,
        layout: {
          visibility: getSavedMapProvider() === 'yandex' ? 'visible' : 'none',
        },
      });

      // 1. Line Source
      map.addSource('paint-route-source', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [],
          },
        },
      });

      // 2. Glow layer
      map.addLayer({
        id: 'paint-route-glow',
        type: 'line',
        source: 'paint-route-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#3b82f6',
          'line-width': 12,
          'line-opacity': 0.45,
          'line-blur': 4,
        },
      });

      // 3. Crisp vibrant route line
      map.addLayer({
        id: 'paint-route-line',
        type: 'line',
        source: 'paint-route-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#2563eb',
          'line-width': 6,
        },
      });

      // 4. Start & End subtle indicators (No big pins/letters)
      map.addSource('paint-endpoints-source', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: [],
        },
      });

      // Endpoint circle layer
      map.addLayer({
        id: 'paint-endpoints-circle',
        type: 'circle',
        source: 'paint-endpoints-source',
        paint: {
          'circle-radius': 7,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Sync GeoJSON layers when currentCoords change ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    // Update Line Source
    const lineSrc = map.getSource('paint-route-source') as maplibregl.GeoJSONSource | undefined;
    if (lineSrc) {
      lineSrc.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: currentCoords,
        },
      });
    }

    // Update Endpoints Source (Green dot at start, Red dot at end)
    const pointsSrc = map.getSource('paint-endpoints-source') as maplibregl.GeoJSONSource | undefined;
    if (pointsSrc) {
      const features: GeoJSON.Feature[] = [];
      if (currentCoords.length > 0) {
        features.push({
          type: 'Feature',
          properties: { color: '#22c55e', type: 'start' },
          geometry: { type: 'Point', coordinates: currentCoords[0] },
        });
      }
      if (currentCoords.length > 1) {
        features.push({
          type: 'Feature',
          properties: { color: '#ef4444', type: 'end' },
          geometry: { type: 'Point', coordinates: currentCoords[currentCoords.length - 1] },
        });
      }
      pointsSrc.setData({
        type: 'FeatureCollection',
        features,
      });
    }
  }, [currentCoords]);

  // ── Toggle DragPan behavior based on tool mode ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (toolMode === 'freehand') {
      map.dragPan.disable();
    } else {
      map.dragPan.enable();
    }
  }, [toolMode]);

  // ── Map Click Handler: Snap to Roads (Roads Mode) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMapClick = async (e: maplibregl.MapMouseEvent) => {
      if (toolModeRef.current !== 'roads') return;

      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      recordHistory(currentCoords);

      if (currentCoords.length === 0) {
        // Place first point
        setCurrentCoords([pt]);
        setIsDirty(true);
        setToastMessage("Boshlang'ich nuqta belgilandi. Endi ko'chalar bo'ylab keyingi nuqtani bosing — chiziq avtomatik yo'llar bo'ylab yotadi 🛣️");
        return;
      }

      // Connect along real street network
      setIsRouting(true);
      try {
        const lastPt = currentCoords[currentCoords.length - 1];
        const roadSegment = await fetchRoadSegment(lastPt, pt);

        // Remove duplicate connection point if present
        const cleanSegment = roadSegment.length > 1 ? roadSegment.slice(1) : roadSegment;

        setCurrentCoords(prev => [...prev, ...cleanSegment]);
        setIsDirty(true);
      } catch (err) {
        console.error('Road routing error:', err);
        setCurrentCoords(prev => [...prev, pt]);
      } finally {
        setIsRouting(false);
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [currentCoords, recordHistory, setCurrentCoords]);

  // ── Interactive Map Drawing Listeners (Freehand Mode) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Mouse Down: Start freehand stroke
    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (toolModeRef.current !== 'freehand') return;
      if (e.originalEvent.button !== 0) return;

      isDrawingRef.current = true;
      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      currentStrokeRef.current = [pt];

      setCurrentCoords(prev => {
        recordHistory(prev);
        return [...prev, pt];
      });
      setIsDirty(true);
    };

    // Mouse Move: Freehand drag drawing
    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!isDrawingRef.current || toolModeRef.current !== 'freehand') return;

      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      const stroke = currentStrokeRef.current;
      const lastPt = stroke[stroke.length - 1];

      if (!lastPt || isFarEnough(lastPt, pt, 12)) {
        currentStrokeRef.current.push(pt);
        setCurrentCoords(prev => [...prev, pt]);
      }
    };

    // Mouse Up: End freehand stroke
    const handleMouseUp = () => {
      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      currentStrokeRef.current = [];
    };

    map.on('mousedown', handleMouseDown);
    map.on('mousemove', handleMouseMove);
    map.on('mouseup', handleMouseUp);

    const handleGlobalMouseUp = () => {
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        currentStrokeRef.current = [];
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      map.off('mousedown', handleMouseDown);
      map.off('mousemove', handleMouseMove);
      map.off('mouseup', handleMouseUp);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [recordHistory, setCurrentCoords]);

  // ── Keyboard Shortcuts (Ctrl+Z) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  // ── Action: Undo ──
  const handleUndo = () => {
    if (currentHistory.length === 0) {
      setToastMessage("Bekor qilish uchun tarix mavjud emas");
      return;
    }
    const previous = currentHistory[currentHistory.length - 1];
    setCurrentHistory(prev => prev.slice(0, -1));
    setCurrentCoords(previous);
    setIsDirty(true);
    setToastMessage("Oxirgi amal bekor qilindi (Undo) ↩️");
  };

  // ── Action: Clear Line (Tozalash) ──
  const handleClear = () => {
    if (currentCoords.length === 0) return;
    if (window.confirm("Haqiqatan ham chizilgan marshrut chizig'ini tozalab tashlamoqchimisiz?")) {
      recordHistory(currentCoords);
      setCurrentCoords([]);
      setIsDirty(true);
      setToastMessage("Marshrut chizig'i tozalandi 🗑️");
    }
  };

  // ── Action: Fit Bounds ──
  const handleFitBounds = () => {
    const map = mapRef.current;
    if (!map || currentCoords.length === 0) {
      setToastMessage("Avval xaritada chiziq chizing");
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    currentCoords.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 80, duration: 800 });
  };

  // ── Action: Copy Outbound to Inbound (Reversed) ──
  const handleCopyInverted = () => {
    if (outboundCoords.length === 0) {
      setToastMessage("Avval Borish (Outbound) yo'nalishini chizing");
      return;
    }
    const reversed = [...outboundCoords].reverse();
    setInboundCoords(reversed);
    setActiveDirection('inbound');
    setIsDirty(true);
    setToastMessage("Borish yo'nalishi Qaytishga teskari tartibda nusxalandi! 🔄");
  };

  // ── Action: Switch Map Provider ──
  const handleMapProviderChange = (provider: MapProvider) => {
    setMapProvider(provider);
    setSavedMapProvider(provider);
    const map = mapRef.current;
    if (map && map.getLayer('yandex-raster-layer')) {
      map.setLayoutProperty(
        'yandex-raster-layer',
        'visibility',
        provider === 'yandex' ? 'visible' : 'none'
      );
    }
    setToastMessage(
      provider === 'yandex'
        ? "Yandex Xarita yoqildi 🗺️"
        : "VirCity 3D Vektor xaritasi yoqildi 🏙️"
    );
  };

  // ── Action: Save Draft ──
  const handleSaveDraft = async () => {
    const routeId = id || `rt-${Date.now().toString().slice(-4)}`;
    const startPoint = outboundCoords[0] ? { name: routeName.split('—')[0]?.trim() || "Bosh nuqta", coordinates: outboundCoords[0] } : null;
    const endPoint = outboundCoords[outboundCoords.length - 1] ? { name: routeName.split('—')[1]?.trim() || "Oxirgi nuqta", coordinates: outboundCoords[outboundCoords.length - 1] } : null;

    const draft: Partial<RouteDraft> = {
      routeId,
      routeNumber,
      routeName,
      status: 'draft',
      outbound: {
        direction: 'outbound',
        startPoint,
        endPoint,
        waypoints: [],
        geometry: { type: 'LineString', coordinates: outboundCoords },
        distanceKm: calculateHaversineKm(outboundCoords),
        durationMin: Math.max(1, Math.round((calculateHaversineKm(outboundCoords) / 22) * 60)),
        isDirty: false,
      },
      inbound: {
        direction: 'inbound',
        startPoint: endPoint,
        endPoint: startPoint,
        waypoints: [],
        geometry: { type: 'LineString', coordinates: inboundCoords },
        distanceKm: calculateHaversineKm(inboundCoords),
        durationMin: Math.max(1, Math.round((calculateHaversineKm(inboundCoords) / 22) * 60)),
        isDirty: false,
      },
    };

    await routeEditorApi.saveDraft(routeId, draft);
    setIsDirty(false);
    setRouteStatus('draft');
    setToastMessage("Qoralama muvaffaqiyatli saqlandi! 💾");
  };

  // ── Action: Publish Route ──
  const handlePublish = async () => {
    if (outboundCoords.length < 2) {
      setToastMessage("Chop etishdan oldin marshrut chizig'ini chizing!");
      return;
    }
    const routeId = id || `rt-${Date.now().toString().slice(-4)}`;
    const startPoint = outboundCoords[0] ? { name: routeName.split('—')[0]?.trim() || "Bosh nuqta", coordinates: outboundCoords[0] } : null;
    const endPoint = outboundCoords[outboundCoords.length - 1] ? { name: routeName.split('—')[1]?.trim() || "Oxirgi nuqta", coordinates: outboundCoords[outboundCoords.length - 1] } : null;

    const draft: Partial<RouteDraft> = {
      routeId,
      routeNumber,
      routeName,
      status: 'published',
      outbound: {
        direction: 'outbound',
        startPoint,
        endPoint,
        waypoints: [],
        geometry: { type: 'LineString', coordinates: outboundCoords },
        distanceKm: calculateHaversineKm(outboundCoords),
        durationMin: Math.max(1, Math.round((calculateHaversineKm(outboundCoords) / 22) * 60)),
        isDirty: false,
      },
      inbound: {
        direction: 'inbound',
        startPoint: endPoint,
        endPoint: startPoint,
        waypoints: [],
        geometry: { type: 'LineString', coordinates: inboundCoords },
        distanceKm: calculateHaversineKm(inboundCoords),
        durationMin: Math.max(1, Math.round((calculateHaversineKm(inboundCoords) / 22) * 60)),
        isDirty: false,
      },
    };

    await routeEditorApi.publishRoute(routeId, draft);
    setIsDirty(false);
    setRouteStatus('published');
    setToastMessage("Yo'nalish muvaffaqiyatli chop etildi (Published)! 🚀");
  };

  return (
    <div className="route-editor-layout">
      {/* ── Top Bar ── */}
      <header className="editor-top-bar">
        <div className="editor-top-bar__left">
          <button
            className="btn-back-link"
            onClick={() => navigate('/uyushma/routes')}
            title="Yo'nalishlar ro'yxatiga qaytish"
          >
            <i className="ri-arrow-left-line" />
          </button>

          <div className="editor-route-title-input">
            <input
              type="text"
              className="input-route-num"
              value={routeNumber}
              onChange={e => {
                setRouteNumber(e.target.value);
                setIsDirty(true);
              }}
              placeholder="№"
              title="Yo'nalish raqami"
            />
            <input
              type="text"
              className="input-route-name"
              value={routeName}
              onChange={e => {
                setRouteName(e.target.value);
                setIsDirty(true);
              }}
              placeholder="Yo'nalish nomi..."
              title="Yo'nalish nomi"
            />
          </div>

          <span className={`editor-status-pill ${routeStatus}`}>
            {routeStatus === 'draft' ? 'Qoralama' : 'Chop etilgan'}
          </span>

          {isDirty && (
            <span className="unsaved-dot">
              <i className="ri-record-circle-line" />
              Saqlanmagan o'zgarishlar
            </span>
          )}
        </div>

        <div className="editor-top-bar__actions">
          {/* Map Provider Selector (VirCity / Yandex) */}
          <div className="editor-map-provider-toggle">
            <button
              type="button"
              className={`btn-provider-pill ${mapProvider === 'vircity' ? 'active-vircity' : ''}`}
              onClick={() => handleMapProviderChange('vircity')}
              title="VirCity 3D Vektor xaritasi"
            >
              <i className="ri-building-line" />
              <span>VirCity (3D)</span>
            </button>
            <button
              type="button"
              className={`btn-provider-pill ${mapProvider === 'yandex' ? 'active-yandex' : ''}`}
              onClick={() => handleMapProviderChange('yandex')}
              title="Yandex Xarita (Yandex Maps)"
            >
              <i className="ri-map-2-line" />
              <span>Yandex</span>
            </button>
          </div>

          <button className="btn-editor-action btn-save-draft" onClick={handleSaveDraft}>
            <i className="ri-save-3-line" />
            Qoralamani saqlash
          </button>

          <button className="btn-editor-action btn-publish" onClick={handlePublish}>
            <i className="ri-check-double-line" />
            Chop etish (Publish)
          </button>
        </div>
      </header>

      {/* ── Workspace ── */}
      <div className="editor-workspace">
        {/* Left Compact Paint Toolbar Sidebar */}
        <aside className="editor-paint-sidebar">
          {/* Direction Tabs */}
          <div className="paint-dir-tabs">
            <button
              className={`paint-dir-tab ${activeDirection === 'outbound' ? 'active' : ''}`}
              onClick={() => setActiveDirection('outbound')}
            >
              <i className="ri-arrow-right-line" />
              Borish ({calculateHaversineKm(outboundCoords)} km)
            </button>
            <button
              className={`paint-dir-tab ${activeDirection === 'inbound' ? 'active' : ''}`}
              onClick={() => setActiveDirection('inbound')}
            >
              <i className="ri-arrow-left-line" />
              Qaytish ({calculateHaversineKm(inboundCoords)} km)
            </button>
          </div>

          {/* Stats Widget */}
          <div className="paint-stats-card">
            <div className="paint-stat-item">
              <span className="stat-label">Masofa</span>
              <span className="stat-value primary">{distanceKm} km</span>
            </div>
            <div className="paint-stat-item">
              <span className="stat-label">Vaqt</span>
              <span className="stat-value">~{durationMin} daq</span>
            </div>
            <div className="paint-stat-item">
              <span className="stat-label">Nuqtalar</span>
              <span className="stat-value">{currentCoords.length} ta</span>
            </div>
          </div>

          {/* Drawing Tools Buttons */}
          <div className="paint-tools-panel">
            <div className="paint-tools-title">Chizish asbobi (Mode)</div>

            <button
              className={`btn-paint-tool ${toolMode === 'roads' ? 'active-draw' : ''}`}
              onClick={() => {
                setToolMode('roads');
                setToastMessage("Yo'llarga yopishish (Snap to Roads) yoqildi: Xaritada ko'chalarga bosing — chiziq avtomatik yo'llar bo'ylab chiziladi 🛣️");
              }}
            >
              <i className="ri-road-map-line" />
              <div>
                <strong>Yo'llar bo'ylab (Snap to Roads)</strong>
                <small>Ko'chalarga bosing — yo'l bo'ylab ulanadi</small>
              </div>
            </button>

            <button
              className={`btn-paint-tool ${toolMode === 'freehand' ? 'active-draw' : ''}`}
              onClick={() => {
                setToolMode('freehand');
                setToastMessage("Erkin chizish (Freehand) yoqildi: Sichqonchani bosib xaritada chizing ✏️");
              }}
            >
              <i className="ri-pencil-fill" />
              <div>
                <strong>Erkin chizish (Freehand Paint)</strong>
                <small>Sichqonchani bosib ushlab chizing</small>
              </div>
            </button>

            <button
              className={`btn-paint-tool ${toolMode === 'pan' ? 'active-pan' : ''}`}
              onClick={() => {
                setToolMode('pan');
                setToastMessage("Xaritani surish (Pan) rejimi yoqildi ✋");
              }}
            >
              <i className="ri-hand-coin-line" />
              <div>
                <strong>Xaritani surish (Pan)</strong>
                <small>Xaritani erkin harakatlantirish</small>
              </div>
            </button>

            <div className="paint-actions-grid">
              <button
                className="btn-paint-subaction"
                onClick={handleUndo}
                disabled={currentHistory.length === 0}
                title="Oxirgi amalni bekor qilish (Ctrl+Z)"
              >
                <i className="ri-arrow-go-back-line" />
                Undo
              </button>

              <button
                className="btn-paint-subaction danger"
                onClick={handleClear}
                disabled={currentCoords.length === 0}
                title="Chiziqni tozalash"
              >
                <i className="ri-delete-bin-line" />
                Tozalash
              </button>

              <button
                className="btn-paint-subaction"
                onClick={handleFitBounds}
                disabled={currentCoords.length === 0}
                title="Marshrutni ekranga moslash"
              >
                <i className="ri-scan-2-line" />
                Fit Map
              </button>
            </div>

            {activeDirection === 'outbound' && outboundCoords.length > 1 && (
              <button className="btn-copy-inverted" onClick={handleCopyInverted}>
                <i className="ri-shuffle-line" />
                Qaytishga teskari nusxalash
              </button>
            )}
          </div>

          {/* Quick Guidance Box */}
          <div className="paint-instructions-box">
            <div className="instructions-title">
              <i className="ri-lightbulb-line" />
              Qanday chiziladi?
            </div>
            <p>
              1. <strong>Yo'llar bo'ylab (Tavsiya etiladi):</strong> Xaritada ko'cha va burilish nuqtalariga bosing — chiziq binolarni kesib o'tmasdan, aynan <strong>haqiqiy ko'chalar bo'ylab</strong> chiziladi!
            </p>
            <p>
              2. <strong>Erkin chizish:</strong> Sichqonchani bosib xohlagan joyingizdan chiziq tortishingiz mumkin.
            </p>
            <p>
              3. Xato qilsangiz <strong>Undo (Ctrl+Z)</strong> tugmasini bosing.
            </p>
          </div>
        </aside>

        {/* Right Map Canvas */}
        <main className="editor-map-canvas">
          {/* Floating Map Provider Pill on Canvas */}
          <div className="canvas-map-provider-floating">
            <button
              type="button"
              className={`btn-floating-provider ${mapProvider === 'vircity' ? 'active-vircity' : ''}`}
              onClick={() => handleMapProviderChange('vircity')}
              title="VirCity 3D Vektor xaritasi"
            >
              <span className={`w-2 h-2 rounded-full ${mapProvider === 'vircity' ? 'bg-cyan-400' : 'bg-slate-400'}`} />
              <span>VirCity (3D)</span>
            </button>
            <button
              type="button"
              className={`btn-floating-provider ${mapProvider === 'yandex' ? 'active-yandex' : ''}`}
              onClick={() => handleMapProviderChange('yandex')}
              title="Yandex Xarita (Yandex Maps)"
            >
              <span className={`w-2 h-2 rounded-full ${mapProvider === 'yandex' ? 'bg-amber-400' : 'bg-slate-400'}`} />
              <span>Yandex</span>
            </button>
          </div>

          <div className={`map-floating-instructions ${toolMode !== 'pan' ? 'draw-active' : ''}`}>
            {isRouting ? (
              <>
                <i className="ri-loader-4-line ri-spin" style={{ color: '#fde047' }} />
                <span>Yo'llar bo'ylab hisoblanmoqda...</span>
              </>
            ) : (
              <>
                <i className={toolMode === 'roads' ? 'ri-road-map-line' : toolMode === 'freehand' ? 'ri-pencil-fill' : 'ri-cursor-line'} />
                <span>
                  {toolMode === 'roads'
                    ? "🛣️ Yo'llar bo'ylab chizish faol: Xaritadagi ko'cha yoki burilishlarga ketma-ket bosing — marshrut faqat yo'llar bo'ylab chiziladi!"
                    : toolMode === 'freehand'
                    ? "✏️ Erkin chizish rejimi: Sichqonchani bosib ushlab chizing"
                    : "✋ Xaritani surish: Xaritani erkin harakatlantiring"}
                </span>
              </>
            )}
          </div>

          <div
            ref={mapContainer}
            className={`editor-map-container ${toolMode !== 'pan' ? 'cursor-paint' : 'cursor-grab'}`}
          />
        </main>
      </div>

      {/* Toast Feedback */}
      {toastMessage && (
        <div
          className="payment-toast-banner success"
          style={{ top: '5rem', zIndex: 9999 }}
          onClick={() => setToastMessage(null)}
        >
          <div className="payment-toast-content">
            <i className="ri-information-fill" />
            <div className="payment-toast-text">
              <p>{toastMessage}</p>
            </div>
          </div>
          <button className="btn-toast-close" onClick={() => setToastMessage(null)}>
            <i className="ri-close-line" />
          </button>
        </div>
      )}
    </div>
  );
}
