import { apiClient } from '../client'
import { driverApi } from '../driverApi'

vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>()
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }
})

const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)

const shiftDto = {
  id: 3,
  driver_id: 1,
  vehicle_id: 1,
  route_id: 1,
  direction: 'outbound',
  status: 'active',
  started_at: '2026-09-19T05:00:00Z',
  ended_at: null,
  last_gps_at: null,
  end_reason: null,
}

describe('driverApi', () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
  })

  it('maps /driver/me including the route geometry and the active shift', async () => {
    get.mockResolvedValue({
      driver_id: 1,
      user_id: 3,
      full_name: 'Otabek Karimov',
      phone: '+998901110001',
      license_number: 'AF1',
      uyushma: { id: 1, name: 'Uyushma', phone: '+998742230001' },
      vehicle: { id: 1, internal_id: 'AND01-V0001', plate_number: '60 A 101 AA', model: 'Damas', color: 'Oq', vehicle_type: 'damas' },
      route: {
        id: 1,
        uyushma_id: 1,
        route_number: '15',
        name: 'Eski shahar — Yangi bozor',
        is_published: true,
        directions: [
          {
            id: 1,
            direction_type: 'outbound',
            origin_name: 'Eski shahar',
            destination_name: 'Yangi bozor',
            origin_lat: 40.7836,
            origin_lng: 72.3337,
            destination_lat: 40.776,
            destination_lng: 72.364,
            polyline: JSON.stringify({ type: 'LineString', coordinates: [[72.3337, 40.7836], [72.364, 40.776]] }),
            distance_meters: 5015,
            duration_seconds: 643,
            waypoints: [{ id: 9, order: 1, name: 'Bobur maydoni', lat: 40.7829, lng: 72.3442, is_stop: true }],
          },
        ],
      },
      fare_uzs: 2500,
      active_shift: shiftDto,
      gps_interval_seconds: 5,
      stale_threshold_seconds: 45,
    })

    const me = await driverApi.me()
    expect(get).toHaveBeenCalledWith('/driver/me')
    expect(me.vehicle?.internalId).toBe('AND01-V0001')
    expect(me.route?.directions[0].geometry).toEqual([
      [72.3337, 40.7836],
      [72.364, 40.776],
    ])
    expect(me.route?.directions[0].stops.map((s) => s.name)).toEqual(['Eski shahar', 'Bobur maydoni', 'Yangi bozor'])
    expect(me.activeShift?.startedAtMs).toBe(Date.parse('2026-09-19T05:00:00Z'))
    expect(me.gpsIntervalSeconds).toBe(5)
  })

  it('sends shift and GPS requests in the backend contract shape', async () => {
    post.mockResolvedValue(shiftDto)
    await driverApi.startShift('inbound')
    expect(post).toHaveBeenCalledWith('/driver/shift/start', { direction: 'inbound' })

    post.mockResolvedValue({ batch_id: 'b1', processed_count: 2, duplicate_count: 1, discarded_count: 0 })
    const points = [
      { idempotency_key: 'k1', lat: 40.78, lng: 72.34, speed_kmh: 10, heading: 90, accuracy_meters: 5, captured_at: '2026-09-19T05:00:00.000Z' },
    ]
    // A backlog of an already finished shift is uploaded with that shift's id
    const res = await driverApi.syncGpsBatch(points, 7, 'b1')
    expect(post).toHaveBeenLastCalledWith(
      '/driver/gps/batch',
      { batch_id: 'b1', points, shift_id: 7 },
      expect.anything(),
    )
    expect(res).toEqual({ batchId: 'b1', processed: 2, duplicates: 1, discarded: 0, serverTimeMs: null })
  })

  it('maps driver payments with the refund window and sends the refund reason', async () => {
    const dto = {
      id: 'p1',
      reference: 'PAY-1',
      vehicle_id: 'AND01-V0001',
      route_id: 1,
      amount_uzs: 2500,
      commission_uzs: 0,
      net_amount_uzs: 2500,
      status: 'completed',
      payment_method: 'wallet',
      identification_method: 'qr',
      created_at: '2026-09-19T05:00:00Z',
      refundable: true,
      refundable_until: '2026-09-19T05:30:00Z',
      refund_window_minutes: 30,
      passenger_label: 'Yo‘lovchi ••33',
    }
    get.mockResolvedValue([dto])
    const [p] = await driverApi.payments('week')
    expect(get).toHaveBeenCalledWith('/driver/payments', { query: { period: 'week', status: undefined, limit: 500 } })
    expect(p.refundableUntilMs).toBe(Date.parse('2026-09-19T05:30:00Z'))

    post.mockResolvedValue({ ...dto, status: 'refunded', refundable: false, refund_reason: 'Adashib' })
    const refunded = await driverApi.refund('p1', '  Adashib  ')
    expect(post).toHaveBeenCalledWith('/driver/payments/p1/refund', { reason: 'Adashib' })
    expect(refunded.status).toBe('refunded')
  })

  it('sends an idempotency key with cash-out requests', async () => {
    post.mockResolvedValue({ id: 4, amount_uzs: 10000, method: 'cash', status: 'pending', created_at: '2026-09-19T05:00:00Z' })
    await driverApi.requestCashout({ amountUzs: 10000, method: 'cash' }, 'key-1')
    expect(post).toHaveBeenCalledWith(
      '/driver/cashouts',
      { amount_uzs: 10000, method: 'cash', payout_details: null },
      { headers: { 'Idempotency-Key': 'key-1' } },
    )
  })
})
