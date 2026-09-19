import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock maplibre-gl Marker used by the adapter
vi.mock('maplibre-gl', () => {
  class Marker {
    el: any
    lnglat: any
    removed = false
    constructor(el: any) {
      this.el = el
    }
    setLngLat(lnglat: any) {
      this.lnglat = lnglat
      return this
    }
    addTo(map: any) {
      map._addedMarkers = map._addedMarkers || []
      map._addedMarkers.push(this)
      return this
    }
    remove() {
      this.removed = true
    }
  }

  // maplibre-gl exports named symbols and a default object; provide both
  const mock = { Marker }
  return {
    default: mock,
    ...mock
  }
})

import { addMarker, removeMarker, clearAllMarkers, drawPolyline, clearPolyline } from './maptiler'

function makeFakeMap() {
  return {
    _markers: new Map(),
    _sources: {} as Record<string, any>,
    _layers: new Set<string>(),
    addSource(id: string, src: any) {
      this._sources[id] = src
    },
    addLayer(layer: any) {
      this._layers.add(layer.id)
    },
    getSource(id: string) {
      return this._sources[id]
    },
    getLayer(id: string) {
      return this._layers.has(id) ? { id } : undefined
    },
    removeLayer(id: string) {
      this._layers.delete(id)
      this._removedLayer = id
    },
    removeSource(id: string) {
      delete this._sources[id]
      this._removedSource = id
    },
    getCenter() {
      return { lng: 72.34, lat: 40.78 }
    }
  }
}

describe('maptiler helpers', () => {
  let map: any

  beforeEach(() => {
    map = makeFakeMap()
  })

  it('addMarker and removeMarker manage registry', () => {
    const marker = addMarker(map, 'm1', [72.34, 40.78], 'X')
    expect(map._markers.has('m1')).toBe(true)
    expect(marker).toBeTruthy()
    removeMarker(map, 'm1')
    expect(map._markers.has('m1')).toBe(false)
  })

  it('clearAllMarkers removes all markers', () => {
    addMarker(map, 'a', [72.34, 40.78])
    addMarker(map, 'b', [72.345, 40.781])
    expect(map._markers.size).toBe(2)
    clearAllMarkers(map)
    expect(map._markers.size).toBe(0)
  })

  it('drawPolyline and clearPolyline manage source and layer', () => {
    const coords: [number, number][] = [
      [72.34, 40.78],
      [72.345, 40.781]
    ]
    drawPolyline(map, 't1', coords)
    expect(map.getSource('line-t1')).toBeTruthy()
    expect(map.getLayer('line-t1')).toBeTruthy()
    clearPolyline(map, 't1')
    expect(map.getLayer('line-t1')).toBeUndefined()
    expect(map.getSource('line-t1')).toBeUndefined()
  })
})
