import { expect, test } from '@playwright/test'
import { api } from '../helpers'

/**
 * The passenger journey: no account, A to B, a usable shortlist of real plans.
 * This is the product's core feature and the one most exposed to regressions in the router.
 */
test.describe('Yo\'lovchi: A -> B qidiruvi', () => {
  test('anonim foydalanuvchi variant ro\'yxatini oladi', async ({ page }) => {
    await page.goto('/')

    // Pick from the autocomplete, not from the published-routes list further down the page:
    // demo line 15 is literally named "Eski shahar - Yangi bozor" and would match by text.
    await page.getByLabel('A — Qayerdan').fill('Eski shahar')
    await page.getByTestId('place-suggestions').getByRole('button', { name: /Eski shahar/ }).first().click()

    await page.getByLabel('B — Qayerga').fill('Yangi bozor')
    await page.getByTestId('place-suggestions').getByRole('button', { name: /Yangi bozor/ }).first().click()

    // Product copy uses the typographic apostrophe U+2018, not ASCII -- selectors must match it.
    await page.getByRole('button', { name: 'Yo\u2018nalishni topish' }).click()

    await expect(page).toHaveURL(/\/search/)
    const cards = page.getByTestId('itineraries-list').locator('> *')
    await expect(cards.first()).toBeVisible()

    // A shortlist, not the whole search space
    const count = await cards.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(20)

    // The plans are real: priced in so'm, and at least one rides a demo line rather than walking
    await expect(page.getByTestId('itineraries-list').getByText(/so\u2018m/).first()).toBeVisible()
    await expect(page.getByTestId('itineraries-list').getByText(/\b(15|22|7|33)\b/).first()).toBeVisible()

    // Selecting a plan opens its step-by-step legs
    await cards.first().click()
    await expect(page.getByRole('heading', { name: /Bosqichma-bosqich/ })).toBeVisible()
  })

  test('javob qisqa ro\'yxat bo\'ladi, megabaytlik emas', async ({ page }) => {
    await page.goto('/')
    const res = await api(page, 'POST', '/routing/search', {
      origin: { lat: 40.7836, lng: 72.3337, name: 'Eski shahar' },
      destination: { lat: 40.7760, lng: 72.3640, name: 'Yangi bozor' },
      preferences: { mode: 'fastest' },
    })
    expect(res.status).toBe(200)

    const itineraries = res.body.itineraries as unknown[]
    expect(itineraries.length).toBeGreaterThan(0)
    expect(itineraries.length).toBeLessThanOrEqual(20)

    // Every recommended plan is present in the list the UI renders
    const ids = new Set(itineraries.map((i: any) => i.id))
    for (const mode of ['fastest', 'cheapest', 'least_walking', 'least_transfers']) {
      expect(ids).toContain(res.body.recommended[mode].id)
    }

    const bytes = JSON.stringify(res.body).length
    expect(bytes, `javob hajmi ${Math.round(bytes / 1024)} KB`).toBeLessThan(1_000_000)
  })

  test('faqat piyoda varianti har doim bo\'ladi', async ({ page }) => {
    await page.goto('/')
    const res = await api(page, 'POST', '/routing/search', {
      // Two points with no line between them: the passenger still gets an answer
      origin: { lat: 40.7000, lng: 72.2000, name: 'A' },
      destination: { lat: 40.7010, lng: 72.2010, name: 'B' },
      preferences: { mode: 'fastest' },
    })
    expect(res.status).toBe(200)
    expect(res.body.itineraries.some((i: any) => i.id === 'itin_walk')).toBe(true)
  })
})
