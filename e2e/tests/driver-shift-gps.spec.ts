import { expect, test } from '@playwright/test'
import { ANDIJON, api, signIn } from '../helpers'

/**
 * The GPS chain, end to end in a real browser: the driver starts a shift, the browser's
 * geolocation is published, and the vehicle becomes visible to the fleet map and to passengers.
 * This is the chain that a unit test cannot cover, because it runs through browser permissions,
 * the offline queue and the WebSocket.
 */
test.describe('Haydovchi: smena va jonli GPS', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation(ANDIJON)
  })

  test('smena boshlanadi, GPS yetib boradi, transport jonli ko\'rinadi', async ({ page, context }) => {
    await signIn(page, 'driver')

    await expect(page.getByRole('heading', { name: /Smena/ }).first()).toBeVisible()
    await page.getByRole('button', { name: /Smenani boshlash/ }).click()

    // The shift is open and the dashboard offers to end it
    await expect(page.getByRole('button', { name: /Smenani yakunlash/ })).toBeVisible({ timeout: 20_000 })

    // The browser's position reaches the server and the vehicle counts as online
    await expect
      .poll(async () => (await api(page, 'GET', '/driver/vehicles/live')).body?.length ?? 0, {
        timeout: 30_000,
        message: 'jonli transport serverga yetib bormadi',
      })
      .toBeGreaterThan(0)

    const live = (await api(page, 'GET', '/driver/vehicles/live')).body
    expect(Math.abs(live[0].lat - ANDIJON.latitude)).toBeLessThan(0.05)

    // A passenger, in a separate anonymous session, sees the same vehicle
    const passenger = await context.browser()!.newContext()
    const passengerPage = await passenger.newPage()
    await passengerPage.goto('/')
    const seen = await api(passengerPage, 'GET', `/driver/vehicles/live?route_id=${live[0].route_id}`)
    expect(seen.status).toBe(200)
    expect(seen.body.length).toBeGreaterThan(0)
    await passenger.close()

    // Ending the shift takes it off the map again
    await page.getByRole('button', { name: /Smenani yakunlash/ }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: /Yakunlash/ }).click()
    await expect
      .poll(async () => (await api(page, 'GET', '/driver/vehicles/live')).body?.length ?? -1, { timeout: 30_000 })
      .toBe(0)
  })
})
