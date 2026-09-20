// Durable offline queue for driver GPS fixes.
//
// Every fix carries a client-generated idempotency key, so a batch can be retried safely
// (the backend drops duplicates). Records are tagged with the shift id: fixes recorded during
// one shift are never uploaded into another shift. IndexedDB survives reloads and app restarts;
// when it is unavailable (very old WebViews, tests) an in-memory store keeps the app working.
import type { GpsPoint } from '../../types/driver'

export interface QueuedFix {
  key: string
  shiftId: number
  point: GpsPoint
}

export interface GpsQueue {
  add(shiftId: number, point: GpsPoint): Promise<void>
  /** Oldest-first fixes of one shift. */
  take(shiftId: number, limit: number): Promise<GpsPoint[]>
  /** Oldest-first fixes left over from any OTHER shift (uploaded as that shift's history). */
  takeOtherShifts(shiftId: number, limit: number): Promise<QueuedFix[]>
  remove(keys: string[]): Promise<void>
  /** Removes fixes that belong to any other shift; returns how many were dropped. */
  dropOtherShifts(shiftId: number): Promise<number>
  count(shiftId?: number): Promise<number>
  clear(): Promise<void>
}

/** ~27 hours at a 5 s interval; beyond that the oldest history is dropped (live data matters more). */
export const MAX_QUEUED_FIXES = 20_000

const byCapturedAt = (a: GpsPoint, b: GpsPoint) => Date.parse(a.captured_at) - Date.parse(b.captured_at)

export class MemoryGpsQueue implements GpsQueue {
  private readonly items = new Map<string, QueuedFix>()

  constructor(private readonly max = MAX_QUEUED_FIXES) {}

  async add(shiftId: number, point: GpsPoint) {
    this.items.set(point.idempotency_key, { key: point.idempotency_key, shiftId, point })
    if (this.items.size > this.max) {
      const oldest = [...this.items.values()].sort((a, b) => byCapturedAt(a.point, b.point)).slice(0, this.items.size - this.max)
      oldest.forEach((r) => this.items.delete(r.key))
    }
  }

  async take(shiftId: number, limit: number) {
    return [...this.items.values()]
      .filter((r) => r.shiftId === shiftId)
      .map((r) => r.point)
      .sort(byCapturedAt)
      .slice(0, limit)
  }

  async takeOtherShifts(shiftId: number, limit: number) {
    return [...this.items.values()]
      .filter((r) => r.shiftId !== shiftId)
      .sort((a, b) => byCapturedAt(a.point, b.point))
      .slice(0, limit)
  }

  async remove(keys: string[]) {
    keys.forEach((k) => this.items.delete(k))
  }

  async dropOtherShifts(shiftId: number) {
    let dropped = 0
    for (const [key, r] of this.items) {
      if (r.shiftId !== shiftId) {
        this.items.delete(key)
        dropped += 1
      }
    }
    return dropped
  }

  async count(shiftId?: number) {
    if (shiftId === undefined) return this.items.size
    let n = 0
    this.items.forEach((r) => {
      if (r.shiftId === shiftId) n += 1
    })
    return n
  }

  async clear() {
    this.items.clear()
  }
}

const DB_NAME = 'mashrutgo-driver'
const STORE = 'gps_queue'

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

class IndexedDbGpsQueue implements GpsQueue {
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(private readonly max = MAX_QUEUED_FIXES) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'key' })
          store.createIndex('shiftId', 'shiftId', { unique: false })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      this.dbPromise.catch(() => {
        this.dbPromise = null
      })
    }
    return this.dbPromise
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db()).transaction(STORE, mode).objectStore(STORE)
  }

  async add(shiftId: number, point: GpsPoint) {
    const record: QueuedFix = { key: point.idempotency_key, shiftId, point }
    await promisify((await this.store('readwrite')).put(record))
    if ((await this.count()) > this.max) await this.trim()
  }

  private async trim() {
    const all = (await promisify((await this.store('readonly')).getAll())) as QueuedFix[]
    const excess = all.length - this.max
    if (excess <= 0) return
    const oldest = all.sort((a, b) => byCapturedAt(a.point, b.point)).slice(0, excess)
    await this.remove(oldest.map((r) => r.key))
  }

  async take(shiftId: number, limit: number) {
    const store = await this.store('readonly')
    const rows = (await promisify(store.index('shiftId').getAll(IDBKeyRange.only(shiftId)))) as QueuedFix[]
    return rows.map((r) => r.point).sort(byCapturedAt).slice(0, limit)
  }

  async takeOtherShifts(shiftId: number, limit: number) {
    const all = (await promisify((await this.store('readonly')).getAll())) as QueuedFix[]
    return all
      .filter((r) => r.shiftId !== shiftId)
      .sort((a, b) => byCapturedAt(a.point, b.point))
      .slice(0, limit)
  }

  async remove(keys: string[]) {
    if (!keys.length) return
    const store = await this.store('readwrite')
    await Promise.all(keys.map((k) => promisify(store.delete(k))))
  }

  async dropOtherShifts(shiftId: number) {
    const all = (await promisify((await this.store('readonly')).getAll())) as QueuedFix[]
    const stale = all.filter((r) => r.shiftId !== shiftId).map((r) => r.key)
    await this.remove(stale)
    return stale.length
  }

  async count(shiftId?: number) {
    const store = await this.store('readonly')
    if (shiftId === undefined) return promisify(store.count())
    return promisify(store.index('shiftId').count(IDBKeyRange.only(shiftId)))
  }

  async clear() {
    await promisify((await this.store('readwrite')).clear())
  }
}

/** IndexedDB when available and working, otherwise in-memory. */
export function createGpsQueue(): GpsQueue {
  if (typeof indexedDB === 'undefined') return new MemoryGpsQueue()
  const idb = new IndexedDbGpsQueue()
  const memory = new MemoryGpsQueue()
  let broken = false
  // Wrap every call: if IndexedDB fails at runtime (quota, private mode), fall back for the session.
  const guard =
    <A extends unknown[], R>(fn: (q: GpsQueue) => (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      if (!broken) {
        try {
          return await fn(idb)(...args)
        } catch (err) {
          broken = true
          console.warn('GPS queue: IndexedDB unavailable, using memory', err)
        }
      }
      return fn(memory)(...args)
    }
  return {
    add: guard((q) => q.add.bind(q)),
    take: guard((q) => q.take.bind(q)),
    takeOtherShifts: guard((q) => q.takeOtherShifts.bind(q)),
    remove: guard((q) => q.remove.bind(q)),
    dropOtherShifts: guard((q) => q.dropOtherShifts.bind(q)),
    count: guard((q) => q.count.bind(q)),
    clear: guard((q) => q.clear.bind(q)),
  }
}
