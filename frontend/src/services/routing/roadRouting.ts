/**
 * Smart Road Snapping Service for Visual Route Editor.
 * Fetches real street/road geometry using OSM road network in Andijon.
 */

export async function fetchRoadSegment(
  from: [number, number], // [lng, lat]
  to: [number, number]   // [lng, lat]
): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      if (data.code === 'Ok' && data.routes && data.routes[0]?.geometry?.coordinates?.length) {
        return data.routes[0].geometry.coordinates as [number, number][];
      }
    }
  } catch (err) {
    console.warn('Street routing failed, using direct connection:', err);
  }

  // Fallback: connect directly
  return [from, to];
}
