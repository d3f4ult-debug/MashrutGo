import { expect, test } from '@playwright/test'
import { ACCOUNTS, signIn } from '../helpers'

/** Every role reaches its own panel, and no role reaches another's. */
test.describe('Xodim kirishi va rol chegaralari', () => {
  for (const role of ['driver', 'uyushma', 'admin'] as const) {
    test(`${role} o'z paneliga kiradi`, async ({ page }) => {
      await signIn(page, role)
      await expect(page).toHaveURL(new RegExp(ACCOUNTS[role].home))
    })
  }

  test('noto\'g\'ri parol kiritmaydi', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Telefon raqami').fill(ACCOUNTS.driver.phone)
    await page.getByLabel('Parol').fill('butunlay-boshqa-parol')
    await page.getByRole('button', { name: /kirish/i }).click()
    await expect(page.getByText(/xato|noto'g'ri|topilmadi/i).first()).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('haydovchi admin paneliga kira olmaydi', async ({ page }) => {
    await signIn(page, 'driver')
    await page.goto('/admin')
    await expect(page).not.toHaveURL(/\/admin$/)
  })

  test('tizimga kirmagan foydalanuvchi haydovchi paneliga kira olmaydi', async ({ page }) => {
    await page.goto('/driver')
    await expect(page).toHaveURL(/\/login/)
  })
})
