export type GeocodeResult = {
  id: string
  name: string
  center: [number, number]
  address?: string
}

export async function geocode(query: string): Promise<GeocodeResult[]> {
  const key = import.meta.env.VITE_MAPTILER_API_KEY || ''
  if (!key) {
    // fallback: return a mocked single result
    return [
      { id: 'mock-1', name: query, center: [69.2401, 41.3112], address: 'Tashkent (mock)' },
    ]
  }
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query)}.json?key=${key}&limit=5`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Geocoding failed')
  const data = await res.json()
  return (data.features || []).map((f: any) => ({
    id: f.id,
    name: f.place_name || f.text || query,
    center: [f.center[0], f.center[1]],
    address: f.place_name,
  }))
}
