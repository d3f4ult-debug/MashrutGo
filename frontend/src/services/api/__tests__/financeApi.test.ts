import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../client'
import {
  buildPaymentQuery,
  canApproveCashout,
  canMarkCashoutPaid,
  canRejectCashout,
  financeApi,
  labelOf,
  PAYMENT_METHOD_LABELS,
  periodStartIso,
  tashkentDayStart,
  type CashoutDto,
  type UyushmaPaymentDto,
} from '../financeApi'

// Shapes captured from the running backend (GET /uyushma/1/payments, /cashouts).
const PAYMENT_DTO: UyushmaPaymentDto = {
  id: '1ab92647-fe5d-4b65-83f7-2201214cc49f',
  reference: 'PAY-VKE6JKAD',
  uyushma_id: 1,
  route_id: 1,
  route_number: '15',
  vehicle_id: 1,
  vehicle_internal_id: 'AND01-V0001',
  vehicle_plate: '60 A 101 AA',
  driver_id: 1,
  driver_name: 'Otabek Karimov',
  amount_uzs: 2500,
  commission_uzs: 0,
  net_amount_uzs: 2500,
  status: 'refunded',
  payment_method: 'wallet',
  identification_method: 'manual',
  created_at: '2026-09-19T13:05:12.192984Z',
  refund_reason: 'Yo‘lovchi adashib ikki marta to‘ladi',
  refunded_at: '2026-09-19T13:05:19.395847Z',
  passenger_label: 'Mijoz #0007',
}

const CASHOUT_DTO: CashoutDto = {
  id: 2,
  driver_id: 1,
  driver_name: 'Otabek Karimov',
  driver_phone: '+998901110001',
  uyushma_id: 1,
  vehicle_id: 1,
  vehicle_internal_id: 'AND01-V0001',
  vehicle_plate: '60 A 101 AA',
  amount_uzs: 1000,
  method: 'cash',
  payout_details: null,
  status: 'pending',
  created_at: '2026-09-19T13:05:19.424453Z',
  processed_at: null,
  paid_at: null,
  processed_by: null,
  rejection_reason: null,
  payment_reference: null,
}

type Reply = { status: number; body?: unknown }

function reply({ status, body }: Reply): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response
}

// Hand-rolled fake fetch: queued replies (or thrown errors) + recorded requests.
let requests: [string, RequestInit][] = []
let queue: (Reply | Error)[] = []

function respondWith(...replies: (Reply | Error)[]) {
  queue.push(...replies)
}

function lastCall(): { url: URL; init: RequestInit } {
  const [url, init] = requests[requests.length - 1]
  return { url: new URL(url, 'http://localhost'), init }
}

beforeEach(() => {
  requests = []
  queue = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push([url, init])
    const next = queue.shift()
    if (!next) throw new Error(`Unexpected request ${url}`)
    if (next instanceof Error) throw next
    return reply(next)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('financeApi.getPayments', () => {
  it('sends server-side filters and maps the paginated DTO', async () => {
    respondWith({ status: 200, body: { items: [PAYMENT_DTO], total: 73, page: 2, size: 25, pages: 3 } })

    const res = await financeApi.getPayments('1', {
      routeId: '1',
      status: 'refunded',
      method: 'wallet',
      search: '  PAY-VKE  ',
      dateFrom: '2026-09-18T19:00:00.000Z',
      page: 2,
      size: 25,
    })

    const { url, init } = lastCall()
    expect(init.method).toBe('GET')
    expect(url.pathname).toBe('/api/v1/uyushma/1/payments')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      route_id: '1',
      status: 'refunded',
      method: 'wallet',
      search: 'PAY-VKE',
      date_from: '2026-09-18T19:00:00.000Z',
      page: '2',
      size: '25',
    })
    expect(res).toMatchObject({ total: 73, page: 2, size: 25, pages: 3 })
    expect(res.items[0]).toEqual({
      ...PAYMENT_DTO,
      uyushma_id: '1',
      route_id: '1',
      vehicle_id: '1',
      driver_id: '1',
    })
  })

  it('drops empty filters, clamps size to 200 and search to 50 chars', () => {
    const q = buildPaymentQuery({ search: `  ${'x'.repeat(80)}  `, size: 1000, page: 0 })
    expect(q.search).toHaveLength(50)
    expect(q.size).toBe(200)
    expect(q.page).toBeUndefined()
    expect(buildPaymentQuery({})).toEqual({
      route_id: undefined,
      status: undefined,
      method: undefined,
      search: undefined,
      date_from: undefined,
      date_to: undefined,
      page: undefined,
      size: undefined,
    })
  })

  it('surfaces backend validation detail instead of returning fabricated data', async () => {
    respondWith({
      status: 422,
      body: { detail: [{ loc: ['query', 'method'], msg: "String should match pattern '^(wallet|click)$'" }] },
    })
    await expect(financeApi.getPayments('1', {})).rejects.toMatchObject({ status: 422, message: expect.stringContaining('wallet|click') })
  })

  it('rejects on network failure (no in-memory data)', async () => {
    respondWith(new TypeError('Failed to fetch'))
    const err = await financeApi.getPayments('1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(0)
  })

  it('requires a tenant', async () => {
    await expect(financeApi.getPayments('')).rejects.toThrow('Uyushma tanlanmagan')
    expect(requests).toHaveLength(0)
  })
})

describe('financeApi summary & cash-outs', () => {
  it('passes date_from to the summary', async () => {
    const summary = {
      gross_revenue: 7500,
      total_refunds: 2500,
      platform_commission: 0,
      net_revenue: 5000,
      completed_rides_count: 2,
      refunded_rides_count: 1,
      pending_cashouts_total: 3000,
      paid_cashouts_total: 0,
    }
    respondWith({ status: 200, body: summary })
    await expect(financeApi.getFinanceSummary('1', '2026-09-18T19:00:00.000Z')).resolves.toEqual(summary)
    const { url } = lastCall()
    expect(url.pathname).toBe('/api/v1/uyushma/1/finance/summary')
    expect(url.searchParams.get('date_from')).toBe('2026-09-18T19:00:00.000Z')
  })

  it('lists cash-outs by status and maps ids / nullables', async () => {
    respondWith({ status: 200, body: [CASHOUT_DTO] })
    const [c] = await financeApi.getCashouts('1', 'pending')
    expect(lastCall().url.searchParams.get('status')).toBe('pending')
    expect(c).toMatchObject({ id: '2', driver_id: '1', uyushma_id: '1', vehicle_id: '1', payout_details: null, status: 'pending' })
  })

  it('approves via POST and returns the mapped cash-out', async () => {
    respondWith({ status: 200, body: { ...CASHOUT_DTO, status: 'approved', processed_by: 'Uyushma Admin' } })
    const c = await financeApi.approveCashout('1', '2')
    const { url, init } = lastCall()
    expect(init.method).toBe('POST')
    expect(url.pathname).toBe('/api/v1/uyushma/1/cashouts/2/approve')
    expect(c.status).toBe('approved')
  })

  it('propagates 409 conflicts with the backend detail', async () => {
    respondWith({ status: 409, body: { detail: "Faqat tasdiqlangan so'rovni to'langan deb belgilash mumkin" } })
    const err = await financeApi.markCashoutPaid('1', '2', 'KO-1').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 409, message: "Faqat tasdiqlangan so'rovni to'langan deb belgilash mumkin" })
  })

  it('validates the reject reason (>= 3 chars) before calling the backend and trims it', async () => {
    await expect(financeApi.rejectCashout('1', '2', '  a ')).rejects.toThrow(/kamida 3/)
    expect(requests).toHaveLength(0)

    respondWith({ status: 200, body: { ...CASHOUT_DTO, status: 'rejected', rejection_reason: 'Karta xato' } })
    const c = await financeApi.rejectCashout('1', '2', '  Karta xato  ')
    const { url, init } = lastCall()
    expect(url.pathname).toBe('/api/v1/uyushma/1/cashouts/2/reject')
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Karta xato' })
    expect(c.rejection_reason).toBe('Karta xato')
  })

  it('validates the payment reference (>= 2 chars) and sends it trimmed', async () => {
    await expect(financeApi.markCashoutPaid('1', '2', ' x ')).rejects.toThrow(/kamida 2/)
    expect(requests).toHaveLength(0)

    respondWith({ status: 200, body: { ...CASHOUT_DTO, status: 'paid', payment_reference: 'KO-000123' } })
    const c = await financeApi.markCashoutPaid('1', '2', ' KO-000123 ')
    expect(lastCall().url.pathname).toBe('/api/v1/uyushma/1/cashouts/2/mark-paid')
    expect(JSON.parse(String(lastCall().init.body))).toEqual({ payment_reference: 'KO-000123' })
    expect(c).toMatchObject({ status: 'paid', payment_reference: 'KO-000123' })
  })
})

describe('cash-out lifecycle helpers', () => {
  it('follows pending → approved → paid, pending|approved → rejected', () => {
    expect(canApproveCashout('pending')).toBe(true)
    expect(canApproveCashout('approved')).toBe(false)
    expect(canMarkCashoutPaid('approved')).toBe(true)
    expect(canMarkCashoutPaid('pending')).toBe(false)
    expect(canRejectCashout('pending')).toBe(true)
    expect(canRejectCashout('approved')).toBe(true)
    expect(canRejectCashout('paid')).toBe(false)
    expect(canRejectCashout('rejected')).toBe(false)
  })

  it('labels only real payment methods and passes unknown values through', () => {
    expect(Object.keys(PAYMENT_METHOD_LABELS)).toEqual(['wallet', 'click'])
    expect(labelOf(PAYMENT_METHOD_LABELS, 'click')).toBe('Click')
    expect(labelOf(PAYMENT_METHOD_LABELS, 'future_method')).toBe('future_method')
  })
})

describe('period presets (Asia/Tashkent calendar days)', () => {
  it('maps "today" to local midnight in UTC', () => {
    // 18:00 in Tashkent on 19 Sep
    expect(periodStartIso('today', Date.parse('2026-09-19T13:00:00Z'))).toBe('2026-09-18T19:00:00.000Z')
    // 01:30 in Tashkent on 20 Sep (still 19 Sep in UTC)
    expect(periodStartIso('today', Date.parse('2026-09-19T20:30:00Z'))).toBe('2026-09-19T19:00:00.000Z')
    expect(tashkentDayStart(Date.parse('2026-09-18T19:00:00Z'))).toBe(Date.parse('2026-09-18T19:00:00Z'))
  })

  it('maps 7d / 30d to calendar days including today, and all to no bound', () => {
    const now = Date.parse('2026-09-19T13:00:00Z')
    expect(periodStartIso('7d', now)).toBe('2026-09-12T19:00:00.000Z')
    expect(periodStartIso('30d', now)).toBe('2026-08-20T19:00:00.000Z')
    expect(periodStartIso('all', now)).toBeUndefined()
  })
})
