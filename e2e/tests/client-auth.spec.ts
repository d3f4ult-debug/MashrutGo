import { expect, test } from '@playwright/test'
import { ACCOUNTS } from '../helpers'

/** The passenger sign-in modal on the wallet page. */
test.describe('Mijoz kirishi', () => {
  test('noto\'g\'ri parolda xato xabari ko\'rinadi', async ({ page }) => {
    await page.goto('/wallet')
    await page.getByRole('button', { name: /Kirish \/ Ro‘yxatdan o‘tish/ }).click()

    const modal = page.getByRole('dialog')
    await modal.getByLabel('Telefon raqam', { exact: true }).fill(ACCOUNTS.client.phone)
    await modal.getByLabel('Parol', { exact: true }).fill('butunlay-boshqa-parol')
    await modal.locator('form button[type="submit"]').click()

    // The modal must survive the request: it is where the failure is reported.
    await expect(page.getByRole('dialog')).toBeVisible()
    // Backend copy uses ASCII apostrophes while the UI uses U+2018, so match the part with none
    await expect(page.getByRole('dialog').getByText('Telefon raqami yoki parol', { exact: false })).toBeVisible()
  })

  test('to\'g\'ri parolda hamyon ochiladi', async ({ page }) => {
    await page.goto('/wallet')
    await page.getByRole('button', { name: /Kirish \/ Ro‘yxatdan o‘tish/ }).click()

    const modal = page.getByRole('dialog')
    await modal.getByLabel('Telefon raqam', { exact: true }).fill(ACCOUNTS.client.phone)
    await modal.getByLabel('Parol', { exact: true }).fill(ACCOUNTS.client.password)
    await modal.locator('form button[type="submit"]').click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Click orqali to‘ldirish' })).toBeVisible()
  })
})
