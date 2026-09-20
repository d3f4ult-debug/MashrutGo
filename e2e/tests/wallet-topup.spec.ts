import { expect, test } from '@playwright/test'
import { api, signInClient } from '../helpers'

/**
 * The money chain: a sandbox top-up runs through the same server path a real Click callback
 * takes, and must land in the immutable ledger exactly once.
 */
test.describe('Hamyon: to\'ldirish va ledger', () => {
  test('sandbox to\'ldirish balansni oshiradi va ledgerga bir marta tushadi', async ({ page }) => {
    await signInClient(page)

    const before = (await api(page, 'GET', '/wallet/balance')).body.balance_uzs as number
    const entriesBefore = (await api(page, 'GET', '/wallet/transactions')).body.length as number

    await page.getByRole('button', { name: 'Click orqali to‘ldirish' }).click()
    await page.getByPlaceholder(/Summa/).fill('10000')
    await page.getByRole('button', { name: /Davom etish/ }).click()

    // Sandbox stands in for Click's callback; production never shows this button
    await page.getByRole('button', { name: /To‘lovni tasdiqlash/ }).click()

    await expect
      .poll(async () => (await api(page, 'GET', '/wallet/balance')).body.balance_uzs, { timeout: 30_000 })
      .toBe(before + 10000)

    // Exactly one new ledger entry, and it is a top-up for the right amount
    const entries = (await api(page, 'GET', '/wallet/transactions')).body
    expect(entries.length).toBe(entriesBefore + 1)
    expect(entries[0].entry_type).toBe('topup')
    expect(entries[0].amount_uzs).toBe(10000)
    expect(entries[0].balance_after_uzs).toBe(before + 10000)

    // The new balance is on screen, formatted as so'm
    await expect(page.getByText(/so‘m/).first()).toBeVisible()
  })

  test('hamyon faqat tizimga kirgan mijoz uchun', async ({ page }) => {
    await page.goto('/wallet')
    await expect(page.getByText(/hisobingizga kiring/i)).toBeVisible()
    const res = await api(page, 'GET', '/wallet/balance')
    expect(res.status).toBe(401)
  })
})
