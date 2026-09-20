// Pure state transitions for the "Kutayapman" passengers shown to a driver.
// Server events (docs/contracts/REALTIME_EVENTS.md): client.nearby.snapshot / .broadcast / .removed.
import { mapWaitingPassenger, type WaitingPassengerDto } from '../api/driverApi'
import type { WaitingPassenger } from '../../types/driver'

export type WaitingState = Record<string, WaitingPassenger>

export type WaitingAction =
  | { type: 'snapshot'; passengers: WaitingPassenger[] }
  | { type: 'upsert'; passenger: WaitingPassenger }
  | { type: 'remove'; watchId: string }
  | { type: 'clear' }

export function waitingReducer(state: WaitingState, action: WaitingAction): WaitingState {
  switch (action.type) {
    case 'snapshot':
      return Object.fromEntries(action.passengers.map((p) => [p.watchId, p]))
    case 'upsert':
      return { ...state, [action.passenger.watchId]: action.passenger }
    case 'remove': {
      if (!(action.watchId in state)) return state
      const next = { ...state }
      delete next[action.watchId]
      return next
    }
    case 'clear':
      return Object.keys(state).length ? {} : state
    default:
      return state
  }
}

/** Translates a driver-channel event into a reducer action (null = not relevant). */
export function actionFromEvent(type: string, payload: unknown, routeId: number | null): WaitingAction | null {
  if (routeId === null) return null
  if (type === 'client.nearby.snapshot') {
    const p = payload as { route_id: number; passengers: WaitingPassengerDto[] }
    if (p.route_id !== routeId) return null
    return { type: 'snapshot', passengers: p.passengers.map(mapWaitingPassenger) }
  }
  if (type === 'client.nearby.broadcast') {
    const p = payload as WaitingPassengerDto
    if (p.route_id !== routeId) return null
    return { type: 'upsert', passenger: mapWaitingPassenger(p) }
  }
  if (type === 'client.nearby.removed') {
    return { type: 'remove', watchId: String((payload as { watch_id: string | number }).watch_id) }
  }
  return null
}
