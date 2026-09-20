import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient, errorMessage } from '../../services/api/client'
import { driverChannel } from '../../services/realtime/websocket'
import { useChannelEvent } from '../../hooks/useRealtime'
import { parseUtc, timeAgo } from '../../utils/format'

interface NotificationDto {
  id: number
  title: string
  body: string
  notification_type: string
  data: Record<string, unknown>
  is_read: boolean
  created_at: string
}

interface Item {
  id: number
  title: string
  body: string
  route: string | null
  isRead: boolean
  createdAtMs: number
}

const REFRESH_MS = 120_000

function mapItem(n: NotificationDto): Item {
  const route = typeof n.data?.route === 'string' ? n.data.route : null
  return { id: n.id, title: n.title, body: n.body, route, isRead: n.is_read, createdAtMs: parseUtc(n.created_at) }
}

/**
 * In-app notification history (`GET /notifications/me`). It is the fallback when push is not
 * configured or the phone blocked notifications, and the archive for events that arrived over
 * the WebSocket while the driver was on another screen.
 */
export function NotificationsBell() {
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    apiClient
      .get<NotificationDto[]>('/notifications/me', { query: { limit: 30 } })
      .then((list) => {
        setItems(list.map(mapItem))
        setError(null)
      })
      .catch((err) => setError(errorMessage(err, 'Bildirishnomalarni yuklab bo‘lmadi')))
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  // The same events that raise a toast also create a stored notification
  useChannelEvent(driverChannel, 'payment.received', load)
  useChannelEvent(driverChannel, 'cashout.status_updated', load)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const navigate = useNavigate()
  const unread = items.filter((i) => !i.isRead).length

  const openItem = async (item: Item) => {
    if (!item.isRead) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isRead: true } : i)))
      apiClient.post(`/notifications/${item.id}/read`).catch(() => load())
    }
    if (item.route) {
      setOpen(false)
      navigate(item.route)
    }
  }

  return (
    <div className="driver-bell" ref={boxRef}>
      <button
        className={`driver-status-dot ${unread ? 'driver-status-dot--warn' : 'driver-status-dot--idle'}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `${unread} ta o‘qilmagan bildirishnoma` : 'Bildirishnomalar'}
        aria-expanded={open}
      >
        <i className="ri-notification-3-line" />
        {unread > 0 && <span className="driver-bell__badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="driver-bell__panel" role="dialog" aria-label="Bildirishnomalar">
          <div className="driver-bell__head">
            <strong>Bildirishnomalar</strong>
            <button onClick={load} aria-label="Yangilash">
              <i className="ri-refresh-line" />
            </button>
          </div>
          {error && <p className="driver-bell__empty">{error}</p>}
          {!error && items.length === 0 && <p className="driver-bell__empty">Hozircha bildirishnoma yo‘q.</p>}
          <ul>
            {items.map((item) => (
              <li key={item.id}>
                <button className={item.isRead ? '' : 'unread'} onClick={() => void openItem(item)}>
                  <span className="driver-bell__title">{item.title}</span>
                  <span className="driver-bell__body">{item.body}</span>
                  <span className="driver-bell__time">{timeAgo(item.createdAtMs)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default NotificationsBell
