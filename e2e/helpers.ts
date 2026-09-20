import { expect, type Page } from '@playwright/test'

/** Demo accounts created by SEED_DEMO_DATA; see backend/app/services/seed_service.py. */
export const ACCOUNTS = {
  admin: { phone: '+998901234567', password: 'admin123', home: '/admin' },
  uyushma: { phone: '+998901234568', password: 'uyushma123', home: '/uyushma' },
  driver: { phone: '+998901110001', password: 'driver123', home: '/driver' },
  client: { phone: '+998901112233', password: 'client123', home: '/' },
} as const

/** Andijon city centre, on the demo routes. */
export const ANDIJON = { latitude: 40.7829, longitude: 72.3442 }

/** Staff (driver, Uyushma, Super Admin) sign in on the dedicated /login page. */
export async function signIn(page: Page, who: 'driver' | 'uyushma' | 'admin') {
  const account = ACCOUNTS[who]
  await page.goto('/login')
  await page.getByLabel('Telefon raqami').fill(account.phone)
  await page.getByLabel('Parol').fill(account.password)
  await page.getByRole('button', { name: /kirish/i }).click()
  await expect(page).toHaveURL(new RegExp(`${account.home}(/|$)`), { timeout: 20_000 })
}

/**
 * Passengers sign in through the header modal, not the staff page: the client app is usable
 * anonymously and only asks for an account at the wallet and payment steps.
 */
export async function signInClient(page: Page) {
  const account = ACCOUNTS.client
  await page.goto('/wallet')
  await page.getByRole('button', { name: /Kirish \/ Ro\u2018yxatdan o\u2018tish/ }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Telefon raqam', { exact: true }).fill(account.phone)
  await modal.getByLabel('Parol', { exact: true }).fill(account.password)
  // "Kirish" is also the login/register tab label, so target the form's submit button
  await modal.locator('form button[type="submit"]').click()
  await expect(modal).toBeHidden({ timeout: 20_000 })
}

/**
 * Call the API the way the app does, reusing the page's stored token. Used to arrange state
 * (a live vehicle, a payment) that has no UI of its own on the screen under test.
 */
export async function api(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const token = localStorage.getItem('auth_token') ?? localStorage.getItem('token')
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    },
    { method, path, body },
  )
}
