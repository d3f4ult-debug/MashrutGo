import React, { useState, useEffect } from 'react';
import { getSavedMapProvider, switchMapProvider, type MapProvider } from '@/services/map/maptiler';

interface MapProviderSwitcherProps {
  map: any;
  className?: string;
  onProviderChange?: (provider: MapProvider) => void;
}

export const MapProviderSwitcher: React.FC<MapProviderSwitcherProps> = ({
  map,
  className = '',
  onProviderChange,
}) => {
  const [provider, setProvider] = useState<MapProvider>(() => getSavedMapProvider());

  useEffect(() => {
    if (map) {
      switchMapProvider(map, provider);
    }
  }, [map, provider]);

  const handleSelect = (next: MapProvider) => {
    setProvider(next);
    if (map) {
      switchMapProvider(map, next);
    }
    onProviderChange?.(next);
  };

  return (
    <div
      className={`map-provider-switcher inline-flex items-center bg-slate-900/90 text-white rounded-full p-1 shadow-md border border-slate-700/80 backdrop-blur-md select-none transition-all ${className}`}
      title="Xarita provayderini tanlash"
    >
      <button
        type="button"
        onClick={() => handleSelect('vircity')}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
          provider === 'vircity'
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
        }`}
        title="VirCity 3D Vektor xaritasi"
      >
        <span className={`w-2 h-2 rounded-full ${provider === 'vircity' ? 'bg-cyan-300' : 'bg-slate-400'}`} />
        <span>VirCity (3D)</span>
      </button>

      <button
        type="button"
        onClick={() => handleSelect('yandex')}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
          provider === 'yandex'
            ? 'bg-amber-600 text-white shadow-sm'
            : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
        }`}
        title="Yandex Xarita (Yandex Maps)"
      >
        <span className={`w-2 h-2 rounded-full ${provider === 'yandex' ? 'bg-yellow-200' : 'bg-slate-400'}`} />
        <span>Yandex</span>
      </button>
    </div>
  );
};

export default MapProviderSwitcher;
