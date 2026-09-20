import { useLocation } from 'react-router-dom'

export type PortalBase = '/admin' | '/uyushma'

/**
 * Uyushma management pages are mounted under both `/uyushma/*` (Uyushma admin) and `/admin/*`
 * (Super Admin). Links must stay inside the current portal, otherwise the role guard rejects them.
 */
export function usePortalBase(): PortalBase {
  const { pathname } = useLocation()
  return pathname.startsWith('/admin') ? '/admin' : '/uyushma'
}
