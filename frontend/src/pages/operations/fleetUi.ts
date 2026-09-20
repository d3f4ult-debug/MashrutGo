// Presentation helpers shared by the live map, the fleet list and the vehicle drawer.
import { timeAgo } from '../../utils/format'
import type { FleetDirection, FleetStatus, LiveFleetVehicle } from '../../types/realtimeFleet'
import type { FleetRouteDetails } from '../../hooks/useLiveFleet'

export const FLEET_STATUS_ORDER: FleetStatus[] = ['on_route', 'in_parking', 'stale', 'awaiting_gps']

export const FLEET_STATUS_LABELS: Record<FleetStatus, string> = {
  on_route: 'Yo‘nalishda',
  in_parking: 'Stoyankada',
  stale: 'GPS kechikmoqda',
  awaiting_gps: 'GPS kutilmoqda',
}

export const FLEET_STATUS_ICONS: Record<FleetStatus, string> = {
  on_route: 'ri-bus-2-line',
  in_parking: 'ri-parking-box-line',
  stale: 'ri-time-line',
  awaiting_gps: 'ri-signal-wifi-off-line',
}

export const DIRECTION_LABELS: Record<FleetDirection, string> = {
  outbound: 'Borish',
  inbound: 'Qaytish',
}

export function vehicleTitle(v: Pick<LiveFleetVehicle, 'plate_number' | 'vehicle_id'>): string {
  return v.plate_number || v.vehicle_id
}

/** One-line freshness text. Never says the vehicle "does not exist" — it is on an active shift. */
export function lastSeenText(v: LiveFleetVehicle, now: number): string {
  switch (v.status) {
    case 'awaiting_gps':
      return `GPS signal yo‘q · smena ${timeAgo(v.shift_started_at, now)} boshlangan`
    case 'stale':
      return v.last_seen ? `GPS signal yo‘q · oxirgi marta ${timeAgo(v.last_seen, now)} ko‘rilgan` : 'GPS signal yo‘q'
    default:
      return `Yangilandi: ${timeAgo(v.last_seen, now)}`
  }
}

export function directionText(v: LiveFleetVehicle, route?: FleetRouteDetails): string {
  const dir = route?.directions.find((d) => d.direction === v.direction)
  const label = DIRECTION_LABELS[v.direction]
  return dir ? `${label}: ${dir.start_name} → ${dir.end_name}` : label
}

export function formatSpeed(kmh: number): string {
  return `${Math.round(kmh)} km/soat`
}

/** Shift duration such as "2 soat 15 daqiqa". */
export function shiftDuration(startedAt: string, now: number, parse: (s: string) => number): string {
  const minutes = Math.max(0, Math.floor((now - parse(startedAt)) / 60_000))
  if (minutes < 60) return `${minutes} daqiqa`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} soat ${m} daqiqa` : `${h} soat`
}

/** Geodesic circle approximation ([lng, lat] ring) for a parking geofence. */
export function circleRing(lat: number, lng: number, radiusM: number, steps = 48): [number, number][] {
  const ring: [number, number][] = []
  const dLat = radiusM / 111_320
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * 2 * Math.PI
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return ring
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}
