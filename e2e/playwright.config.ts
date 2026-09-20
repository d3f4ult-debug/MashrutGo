import { defineConfig, devices } from '@playwright/test'

/**
 * Browser end-to-end suite: a real Chromium against the real API.
 *
 * Both servers are started here, so `npx playwright test` from `e2e/` is the whole command. The
 * API runs on a throwaway SQLite file with Andijon demo data and the offline routing provider,
 * which keeps a run independent of the network and of anyone's local app.db.
 *
 * One worker on purpose: the suite drives shared server state (shifts, live vehicles, waiting
 * passengers) that parallel workers would see each other's changes to.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'uz-UZ',
    timezoneId: 'Asia/Tashkent',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: [
    {
      command: './start-backend.sh',
      url: 'http://127.0.0.1:8000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      cwd: '../frontend',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
