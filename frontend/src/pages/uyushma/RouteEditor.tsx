import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAuth } from '../../contexts/AuthContext';
import { uyushmaApi } from '../../services/api/uyushmaApi';
import { routeEditorApi } from '../../services/api/routeEditorApi';
import type {
  DirectionEditorState,
  RouteDraft,
  RouteWaypoint,
} from '../../types/routeEditor';
import './RouteEditor.css';

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || 'get_your_key_at_maptiler';
const ANDIJON_CENTER: [number, number] = [72.344, 40.783];

// Initial direction state helper
function createEmptyDirection(dir: 'outbound' | 'inbound', startName = 'Bosh bekat (A)', endName = 'Oxirgi bekat (B)'): DirectionEditorState {
  return {
    direction: dir,
    startPoint: { name: startName, coordinates: dir === 'outbound' ? [72.348, 40.785] : [72.361, 40.756] },
    endPoint: { name: endName, coordinates: dir === 'outbound' ? [72.361, 40.756] : [72.348, 40.785] },
    waypoints: [],
    geometry: null,
    distanceKm: 0,
    durationMin: 0,
    isDirty: false,
  };
}

export function RouteEditor() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const uyushmaId = user?.uyushma_id || 'uyushma-01';

  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  // Metadata
  const [routeNumber, setRouteNumber] = useState('12');
  const [routeName, setRouteName] = useState("O'sh ko'chasi — Yangi Bozor");
  const [routeStatus, setRouteStatus] = useState<'draft' | 'published'>('draft');

  // Active Direction Tab
  const [activeDirection, setActiveDirection] = useState<'outbound' | 'inbound'>('outbound');

  // Independent directions
  const [outbound, setOutbound] = useState<DirectionEditorState>(() =>
    createEmptyDirection('outbound', "O'sh ko'chasi (A)", "Yangi Bozor (B)")
  );
  const [inbound, setInbound] = useState<DirectionEditorState>(() =>
    createEmptyDirection('inbound', "Yangi Bozor (B)", "O'sh ko'chasi (A)")
  );

  // Undo history stack
  const [history, setHistory] = useState<{ outbound: DirectionEditorState; inbound: DirectionEditorState }[]>([]);

  // Feedback notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Current active direction object
  const currentDirState = activeDirection === 'outbound' ? outbound : inbound;
  const setCurrentDirState = activeDirection === 'outbound' ? setOutbound : setInbound;

  // ── Push current state to undo history before making edits ──
  const pushHistory = useCallback(() => {
    setHistory(prev => [...prev.slice(-15), { outbound: { ...outbound }, inbound: { ...inbound } }]);
  }, [outbound, inbound]);

  // ── Recalculate auto-path through A -> Waypoints -> B ──
  const recalculatePath = useCallback(async (state: DirectionEditorState): Promise<DirectionEditorState> => {
    if (!state.startPoint || !state.endPoint) {
      return { ...state, geometry: null, distanceKm: 0, durationMin: 0 };
    }

    try {
      const res = await routeEditorApi.calculatePath({
        origin: state.startPoint.coordinates,
        destination: state.endPoint.coordinates,
        waypoints: state.waypoints.map(w => w.coordinates),
      });

      return {
        ...state,
        geometry: res.geometry,
        distanceKm: res.distance_km,
        durationMin: res.duration_min,
        isDirty: true,
      };
    } catch {
      return state;
    }
  }, []);

  // ── Load initial route if editing existing route ──
  useEffect(() => {
    if (!id) return;
    uyushmaApi.getRoutes(uyushmaId).then(allRoutes => {
      const target = allRoutes.find(r => r.id === id);
      if (target) {
        setRouteNumber(target.route_number);
        setRouteName(target.route_name);
        const outDir = target.directions.find(d => d.direction === 'outbound');
        const inDir = target.directions.find(d => d.direction === 'inbound');

        if (outDir) {
          const outState = createEmptyDirection('outbound', outDir.start_name, outDir.end_name);
          recalculatePath(outState).then(setOutbound);
        }
        if (inDir) {
          const inState = createEmptyDirection('inbound', inDir.start_name, inDir.end_name);
          recalculatePath(inState).then(setInbound);
        }
      }
    });
  }, [id, uyushmaId, recalculatePath]);

  // ── Initialize MapLibre GL ──
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const styleUrl = `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${MAPTILER_KEY}`;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: styleUrl,
      center: ANDIJON_CENTER,
      zoom: 12.5,
      pitch: 0,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

    map.on('load', () => {
      // Add GeoJSON line source and layers for route preview
      map.addSource('route-path-source', {
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

      // Outer glow / casing
      map.addLayer({
        id: 'route-path-glow',
        type: 'line',
        source: 'route-path-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#3b82f6',
          'line-width': 10,
          'line-opacity': 0.35,
          'line-blur': 3,
        },
      });

      // Core crisp transit line
      map.addLayer({
        id: 'route-path-line',
        type: 'line',
        source: 'route-path-source',
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#60a5fa',
          'line-width': 5,
        },
      });

      // Initial route calculation
      recalculatePath(outbound).then(res => {
        setOutbound(res);
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Update Map Layer geometry when currentDirState geometry changes ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const src = map.getSource('route-path-source') as maplibregl.GeoJSONSource | undefined;
    if (src) {
      if (currentDirState.geometry) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: currentDirState.geometry,
        });
      } else {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        });
      }
    }
  }, [currentDirState.geometry]);

  // ── Render and Synchronize HTML Markers on Map ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Helper to create styled pin element
    const createPin = (label: string, className: string) => {
      const el = document.createElement('div');
      el.className = `map-marker-pin ${className}`;
      el.innerText = label;
      return el;
    };

    // Marker A (Origin)
    if (currentDirState.startPoint) {
      const elA = createPin('A', 'start');
      const markerA = new maplibregl.Marker({ element: elA, draggable: true })
        .setLngLat(currentDirState.startPoint.coordinates)
        .addTo(map);

      markerA.on('dragend', async () => {
        const lngLat = markerA.getLngLat();
        pushHistory();
        const updatedState = {
          ...currentDirState,
          startPoint: { ...currentDirState.startPoint!, coordinates: [lngLat.lng, lngLat.lat] as [number, number] },
        };
        const calculated = await recalculatePath(updatedState);
        setCurrentDirState(calculated);
      });

      markersRef.current.push(markerA);
    }

    // Intermediate Waypoint markers
    currentDirState.waypoints.forEach((wp, idx) => {
      const elWp = createPin(String(idx + 1), 'waypoint');
      const markerWp = new maplibregl.Marker({ element: elWp, draggable: true })
        .setLngLat(wp.coordinates)
        .addTo(map);

      markerWp.on('dragend', async () => {
        const lngLat = markerWp.getLngLat();
        pushHistory();
        const newWaypoints = currentDirState.waypoints.map(w =>
          w.id === wp.id ? { ...w, coordinates: [lngLat.lng, lngLat.lat] as [number, number] } : w
        );
        const updatedState = { ...currentDirState, waypoints: newWaypoints };
        const calculated = await recalculatePath(updatedState);
        setCurrentDirState(calculated);
      });

      markersRef.current.push(markerWp);
    });

    // Marker B (Destination)
    if (currentDirState.endPoint) {
      const elB = createPin('B', 'end');
      const markerB = new maplibregl.Marker({ element: elB, draggable: true })
        .setLngLat(currentDirState.endPoint.coordinates)
        .addTo(map);

      markerB.on('dragend', async () => {
        const lngLat = markerB.getLngLat();
        pushHistory();
        const updatedState = {
          ...currentDirState,
          endPoint: { ...currentDirState.endPoint!, coordinates: [lngLat.lng, lngLat.lat] as [number, number] },
        };
        const calculated = await recalculatePath(updatedState);
        setCurrentDirState(calculated);
      });

      markersRef.current.push(markerB);
    }
  }, [currentDirState, pushHistory, recalculatePath, setCurrentDirState]);

  // ── Map Click Handler: Add Waypoint ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMapClick = async (e: maplibregl.MapMouseEvent) => {
      const newCoord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      pushHistory();

      const newWp: RouteWaypoint = {
        id: `wp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: `Oraliq bekat #${currentDirState.waypoints.length + 1}`,
        coordinates: newCoord,
        order: currentDirState.waypoints.length,
      };

      const updated = {
        ...currentDirState,
        waypoints: [...currentDirState.waypoints, newWp],
      };

      const calculated = await recalculatePath(updated);
      setCurrentDirState(calculated);
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [currentDirState, pushHistory, recalculatePath, setCurrentDirState]);

  // ── Actions: Fit Bounds ──
  const handleFitBounds = () => {
    const map = mapRef.current;
    if (!map || !currentDirState.geometry || currentDirState.geometry.coordinates.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    currentDirState.geometry.coordinates.forEach(c => bounds.extend(c));
    map.fitBounds(bounds, { padding: 80, duration: 1000 });
  };

  // ── Actions: Undo Last Edit ──
  const handleUndo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setOutbound(last.outbound);
    setInbound(last.inbound);
    setToastMessage("Oxirgi amal bekor qilindi (Undo)");
  };

  // ── Waypoint Reordering & Deletion ──
  const handleDeleteWaypoint = async (wpId: string) => {
    pushHistory();
    const updated = {
      ...currentDirState,
      waypoints: currentDirState.waypoints.filter(w => w.id !== wpId),
    };
    const calculated = await recalculatePath(updated);
    setCurrentDirState(calculated);
  };

  const handleMoveWaypoint = async (idx: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && idx === 0) ||
      (direction === 'down' && idx === currentDirState.waypoints.length - 1)
    ) {
      return;
    }
    pushHistory();
    const list = [...currentDirState.waypoints];
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    const temp = list[idx];
    list[idx] = list[targetIdx];
    list[targetIdx] = temp;

    const updated = { ...currentDirState, waypoints: list };
    const calculated = await recalculatePath(updated);
    setCurrentDirState(calculated);
  };

  // ── Save Draft ──
  const handleSaveDraft = async () => {
    const draft: Partial<RouteDraft> = {
      routeId: id || `rt-${Date.now().toString().slice(-4)}`,
      routeNumber,
      routeName,
      status: 'draft',
      outbound,
      inbound,
    };
    await routeEditorApi.saveDraft(draft.routeId!, draft);
    setRouteStatus('draft');
    setOutbound(prev => ({ ...prev, isDirty: false }));
    setInbound(prev => ({ ...prev, isDirty: false }));
    setToastMessage("Qoralama muvaffaqiyatli saqlandi! 💾");
  };

  // ── Publish Route ──
  const handlePublish = async () => {
    const draft: Partial<RouteDraft> = {
      routeId: id || `rt-${Date.now().toString().slice(-4)}`,
      routeNumber,
      routeName,
      status: 'published',
      outbound,
      inbound,
    };
    await routeEditorApi.publishRoute(draft.routeId!, draft);
    setRouteStatus('published');
    setOutbound(prev => ({ ...prev, isDirty: false }));
    setInbound(prev => ({ ...prev, isDirty: false }));
    setToastMessage("Yo'nalish muvaffaqiyatli chop etildi (Published)! 🚀");
  };

  return (
    <div className="route-editor-layout">
      {/* ── Top Command Bar ── */}
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
              onChange={e => setRouteNumber(e.target.value)}
              placeholder="№"
              title="Yo'nalish raqami"
            />
            <input
              type="text"
              className="input-route-name"
              value={routeName}
              onChange={e => setRouteName(e.target.value)}
              placeholder="Yo'nalish nomi..."
              title="Yo'nalish nomi"
            />
          </div>

          <span className={`editor-status-pill ${routeStatus}`}>
            {routeStatus === 'draft' ? 'Qoralama' : 'Chop etilgan'}
          </span>

          {(outbound.isDirty || inbound.isDirty) && (
            <span className="unsaved-dot">
              <i className="ri-record-circle-line" />
              Saqlanmagan o'zgarishlar
            </span>
          )}
        </div>

        <div className="editor-top-bar__actions">
          <button
            className="btn-editor-action"
            onClick={handleFitBounds}
            title="Marshrutni to'liq ekranga moslash"
          >
            <i className="ri-scan-2-line" />
            Fit Bounds
          </button>

          <button
            className="btn-editor-action"
            onClick={handleUndo}
            disabled={history.length === 0}
            title="Oxirgi tahrirni bekor qilish"
          >
            <i className="ri-arrow-go-back-line" />
            Undo
          </button>

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

      {/* ── Main Split-Screen Workspace ── */}
      <div className="editor-workspace">
        {/* Left Control Sidebar */}
        <aside className="editor-sidebar">
          {/* Direction Switch Tabs */}
          <div className="direction-tabs-header">
            <button
              className={`direction-tab-btn ${activeDirection === 'outbound' ? 'active' : ''}`}
              onClick={() => setActiveDirection('outbound')}
            >
              <span className="direction-tab-btn__title">
                <i className="ri-arrow-right-line" />
                Borish (Outbound)
              </span>
              <span className="direction-tab-btn__stats">
                {outbound.distanceKm} km • ~{outbound.durationMin} daq
              </span>
            </button>

            <button
              className={`direction-tab-btn ${activeDirection === 'inbound' ? 'active' : ''}`}
              onClick={() => setActiveDirection('inbound')}
            >
              <span className="direction-tab-btn__title">
                <i className="ri-arrow-left-line" />
                Qaytish (Inbound)
              </span>
              <span className="direction-tab-btn__stats">
                {inbound.distanceKm} km • ~{inbound.durationMin} daq
              </span>
            </button>
          </div>

          {/* Sidebar Content */}
          <div className="editor-sidebar__content">
            {/* Route Stats */}
            <div className="route-stats-strip">
              <div className="stat-box">
                <span className="val accent">{currentDirState.distanceKm}</span>
                <span className="lbl">Masofa (km)</span>
              </div>
              <div className="stat-box">
                <span className="val">{currentDirState.durationMin}</span>
                <span className="lbl">Vaqt (daq)</span>
              </div>
              <div className="stat-box">
                <span className="val">{currentDirState.waypoints.length + 2}</span>
                <span className="lbl">Jami bekat</span>
              </div>
            </div>

            {/* Sequence of Points */}
            <div className="points-sequence-container">
              {/* Point A (Start) */}
              <div className="point-card">
                <div className="point-card__left">
                  <div className="point-marker-dot start">A</div>
                  <div style={{ flex: 1 }}>
                    <input
                      type="text"
                      className="point-card__name-input"
                      value={currentDirState.startPoint?.name || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setCurrentDirState(prev => ({
                          ...prev,
                          startPoint: prev.startPoint ? { ...prev.startPoint, name: val } : null,
                        }));
                      }}
                      placeholder="Bosh bekat (A)"
                    />
                    <div className="point-card__coords">
                      {currentDirState.startPoint?.coordinates[1].toFixed(4)},{' '}
                      {currentDirState.startPoint?.coordinates[0].toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Waypoints List */}
              {currentDirState.waypoints.map((wp, idx) => (
                <div key={wp.id} className="point-card">
                  <div className="point-card__left">
                    <div className="point-marker-dot waypoint">{idx + 1}</div>
                    <div style={{ flex: 1 }}>
                      <input
                        type="text"
                        className="point-card__name-input"
                        value={wp.name}
                        onChange={e => {
                          const val = e.target.value;
                          setCurrentDirState(prev => ({
                            ...prev,
                            waypoints: prev.waypoints.map(w => (w.id === wp.id ? { ...w, name: val } : w)),
                          }));
                        }}
                        placeholder={`Oraliq bekat #${idx + 1}`}
                      />
                      <div className="point-card__coords">
                        {wp.coordinates[1].toFixed(4)}, {wp.coordinates[0].toFixed(4)}
                      </div>
                    </div>
                  </div>

                  <div className="point-card__actions">
                    <button
                      className="btn-point-icon"
                      onClick={() => handleMoveWaypoint(idx, 'up')}
                      disabled={idx === 0}
                      title="Yuqoriga surish"
                    >
                      <i className="ri-arrow-up-s-line" />
                    </button>
                    <button
                      className="btn-point-icon"
                      onClick={() => handleMoveWaypoint(idx, 'down')}
                      disabled={idx === currentDirState.waypoints.length - 1}
                      title="Pastga surish"
                    >
                      <i className="ri-arrow-down-s-line" />
                    </button>
                    <button
                      className="btn-point-icon delete"
                      onClick={() => handleDeleteWaypoint(wp.id)}
                      title="O'chirish"
                    >
                      <i className="ri-close-line" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Add Waypoint hint button */}
              <div
                className="btn-add-waypoint-strip"
                onClick={() => setToastMessage("Xaritada kerakli nuqtaga bosing — waypoint avtomatik qo'shiladi")}
              >
                <i className="ri-add-circle-line" />
                Xaritadan Waypoint qo'shish
              </div>

              {/* Point B (End) */}
              <div className="point-card">
                <div className="point-card__left">
                  <div className="point-marker-dot end">B</div>
                  <div style={{ flex: 1 }}>
                    <input
                      type="text"
                      className="point-card__name-input"
                      value={currentDirState.endPoint?.name || ''}
                      onChange={e => {
                        const val = e.target.value;
                        setCurrentDirState(prev => ({
                          ...prev,
                          endPoint: prev.endPoint ? { ...prev.endPoint, name: val } : null,
                        }));
                      }}
                      placeholder="Oxirgi bekat (B)"
                    />
                    <div className="point-card__coords">
                      {currentDirState.endPoint?.coordinates[1].toFixed(4)},{' '}
                      {currentDirState.endPoint?.coordinates[0].toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Right Map Canvas */}
        <main className="editor-map-canvas">
          <div className="map-floating-instructions">
            <i className="ri-cursor-line" />
            <span>
              Xaritaga bosib yangi waypoint qo'shing yoki mavjud nuqtalarni suring (Drag & Drop)
            </span>
          </div>

          <div ref={mapContainer} className="editor-map-container" />
        </main>
      </div>

      {/* Toast popup */}
      {toastMessage && (
        <div
          className="payment-toast-banner success"
          style={{ top: '5rem', zIndex: 9999 }}
          onClick={() => setToastMessage(null)}
        >
          <div className="payment-toast-content">
            <i className="ri-checkbox-circle-fill" />
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
