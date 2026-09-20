import { actionFromEvent, waitingReducer, type WaitingState } from '../waitingPassengers'

const dto = (watchId: number, routeId = 1) => ({
  watch_id: String(watchId),
  route_id: routeId,
  direction: 'outbound' as const,
  client_lat: 40.78,
  client_lng: 72.34,
  waiting_since: '2026-09-19T10:00:00+00:00',
  action: 'active',
})

function apply(state: WaitingState, type: string, payload: unknown, routeId: number | null = 1): WaitingState {
  const action = actionFromEvent(type, payload, routeId)
  return action ? waitingReducer(state, action) : state
}

describe('waiting passengers ("Kutayapman") state', () => {
  it('shows a passenger on broadcast and removes the marker on "Mashinadaman"', () => {
    let s: WaitingState = {}
    s = apply(s, 'client.nearby.broadcast', dto(5))
    expect(Object.keys(s)).toEqual(['5'])
    expect(s['5'].waitingSinceMs).toBe(Date.parse('2026-09-19T10:00:00Z'))
    s = apply(s, 'client.nearby.removed', { watch_id: '5', reason: 'on_car' })
    expect(s).toEqual({})
  })

  it('replaces everything with a snapshot and moves a passenger on update', () => {
    let s: WaitingState = apply({}, 'client.nearby.broadcast', dto(1))
    s = apply(s, 'client.nearby.snapshot', { route_id: 1, passengers: [dto(2), dto(3)] })
    expect(Object.keys(s).sort()).toEqual(['2', '3'])
    s = apply(s, 'client.nearby.broadcast', { ...dto(2), client_lat: 40.79, action: 'updated' })
    expect(s['2'].lat).toBe(40.79)
  })

  it('ignores events of other routes and anything while the driver has no shift', () => {
    expect(apply({}, 'client.nearby.broadcast', dto(9, 2))).toEqual({})
    expect(apply({}, 'client.nearby.broadcast', dto(9), null)).toEqual({})
    expect(apply({}, 'payment.received', { payment: {} })).toEqual({})
  })
})
