import { expect, test } from '@playwright/test'
import { ANDIJON, api, signIn } from '../helpers'

/**
 * The "Kutayapman" chain across two real browser sessions: a passenger marks themselves waiting
 * and appears on the driver's list of waiting passengers; pressing "Mashinadaman" removes them.
 * The passenger's exact position is private outside an active watch, so this is also a privacy test.
 */
test.describe('Kutayapman: yo\'lovchi va haydovchi', () => {
  test('yo\'lovchi haydovchi ro\'yxatida paydo bo\'ladi va "Mashinadaman"da yo\'qoladi', async ({ browser }) => {
    // --- driver: on shift, so the waiting list is available at all
    const driverCtx = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: ANDIJON,
    })
    const driver = await driverCtx.newPage()
    await signIn(driver, 'driver')
    await driver.getByRole('button', { name: /Smenani boshlash/ }).click()
    await expect(driver.getByRole('button', { name: /Smenani yakunlash/ })).toBeVisible({ timeout: 20_000 })

    const me = (await api(driver, 'GET', '/driver/me')).body
    const routeId = me.route?.id ?? me.route_id
    expect(routeId, 'demo haydovchiga yo\'nalish biriktirilgan bo\'lishi kerak').toBeTruthy()

    const waiting = async () => (await api(driver, 'GET', '/driver/passengers/waiting')).body.total_waiting as number
    expect(await waiting()).toBe(0)

    // --- passenger: anonymous, standing on the line
    const riderCtx = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 40.7829, longitude: 72.3442 }, // Bobur maydoni, a stop on the demo lines
    })
    const rider = await riderCtx.newPage()
    await rider.goto(`/route/${routeId}`)
    await rider.getByRole('button', { name: /Kutayapman \/ Kuzatish/ }).click()

    await expect.poll(waiting, { timeout: 30_000, message: 'haydovchi kutayotgan yo\'lovchini ko\'rmadi' }).toBe(1)

    // --- boarding takes the pin off the driver's map immediately
    await rider.getByRole('button', { name: 'Mashinadaman' }).click()
    await expect.poll(waiting, { timeout: 30_000 }).toBe(0)

    // --- "Tushdim" ends the ride
    await rider.getByRole('button', { name: 'Tushdim' }).click()
    await expect(rider.getByRole('button', { name: /Kutayapman \/ Kuzatish/ })).toBeVisible({ timeout: 20_000 })

    // cleanup
    await driver.getByRole('button', { name: /Smenani yakunlash/ }).click()
    await driver.getByRole('dialog').getByRole('button', { name: /Yakunlash/ }).click()
    await riderCtx.close()
    await driverCtx.close()
  })

  test('yo\'nalishdan uzoqdagi nuqta qabul qilinmaydi', async ({ page }) => {
    await page.goto('/')
    const routes = (await api(page, 'GET', '/routes')).body
    const routeId = routes[0].id

    // Moscow is not a bus stop in Andijon
    const res = await api(page, 'POST', '/client/watch/start', {
      route_id: routeId, direction: 'outbound', lat: 55.75, lng: 37.61,
    })
    expect(res.status).toBe(422)
  })
})
