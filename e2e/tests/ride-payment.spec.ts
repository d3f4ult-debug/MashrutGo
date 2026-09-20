import { expect, test } from '@playwright/test'
import { ANDIJON, api, signIn, signInClient } from '../helpers'

/**
 * The fare chain, across two sessions: a passenger pays a driver's vehicle from the wallet, the
 * money leaves the passenger's ledger, reaches the driver's, and shows up on the driver's screen.
 */
test.describe('Yo\'l haqi to\'lovi', () => {
  // Two browser contexts, a shift and a ledger round-trip: slower than a single-page test.
  test.setTimeout(120_000)

  test('mijoz to\'laydi, pul ledgerdan o\'tadi va haydovchi ko\'radi', async ({ browser }) => {
    // --- driver on shift, so the vehicle can take a fare
    const driverCtx = await browser.newContext({ permissions: ['geolocation'], geolocation: ANDIJON })
    const driver = await driverCtx.newPage()
    await signIn(driver, 'driver')
    await driver.getByRole('button', { name: /Smenani boshlash/ }).click()
    await expect(driver.getByRole('button', { name: /Smenani yakunlash/ })).toBeVisible({ timeout: 20_000 })

    const me = (await api(driver, 'GET', '/driver/me')).body
    const plate = me.vehicle?.plate_number ?? me.vehicle?.internal_id
    expect(plate, 'demo haydovchida transport bo\'lishi kerak').toBeTruthy()
    const driverBalanceBefore = (await api(driver, 'GET', '/driver/balance')).body.balance as number

    // --- passenger pays by typing the vehicle identifier
    const riderCtx = await browser.newContext()
    const rider = await riderCtx.newPage()
    await signInClient(rider)
    const riderBalanceBefore = (await api(rider, 'GET', '/wallet/balance')).body.balance_uzs as number

    await rider.goto('/pay')
    const modal = rider.getByRole('dialog')
    await modal.getByRole('tab', { name: /Qo‘lda kiritish/ }).click()
    await modal.getByPlaceholder(/Masalan/).fill(String(plate))
    await modal.getByRole('button', { name: /Transportni aniqlash/ }).click()

    // The resolved vehicle and its fare are shown before any money moves
    await expect(modal.getByText(String(plate)).first()).toBeVisible({ timeout: 20_000 })
    // The confirm button carries the amount, so the passenger sees what they are about to pay
    await modal.getByRole('button', { name: /Hamyondan to‘lash/ }).click()

    // --- the passenger is debited exactly once
    await expect
      .poll(async () => (await api(rider, 'GET', '/wallet/balance')).body.balance_uzs, { timeout: 30_000 })
      .toBeLessThan(riderBalanceBefore)
    const riderBalanceAfter = (await api(rider, 'GET', '/wallet/balance')).body.balance_uzs as number
    const fare = riderBalanceBefore - riderBalanceAfter
    expect(fare).toBeGreaterThan(0)

    const riderLedger = (await api(rider, 'GET', '/wallet/transactions')).body
    expect(riderLedger[0].entry_type).toBe('ride_payment')
    expect(riderLedger[0].amount_uzs).toBe(-fare)

    // --- the driver is credited the same amount and sees the payment
    await expect
      .poll(async () => (await api(driver, 'GET', '/driver/balance')).body.balance, { timeout: 30_000 })
      .toBe(driverBalanceBefore + fare)

    await driver.goto('/driver/payments')
    await expect(driver.getByText(/so‘m/).first()).toBeVisible({ timeout: 20_000 })
    const payments = (await api(driver, 'GET', '/driver/payments')).body
    expect(payments.length).toBeGreaterThan(0)
    expect(payments[0].amount_uzs).toBe(fare)

    // cleanup
    await driver.goto('/driver')
    await driver.getByRole('button', { name: /Smenani yakunlash/ }).click()
    await driver.getByRole('dialog').getByRole('button', { name: /Yakunlash/ }).click()
    await riderCtx.close()
    await driverCtx.close()
  })
})
