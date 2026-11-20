import { defineConfig } from '@playwright/test'
import { chromiumLaunchOptions } from 'deepspace/testing'

/**
 * Run the Readaloud spec against the deployed app instead of local dev:
 *   DEEPSPACE_TEST_BROWSER_EXECUTABLE_PATH=… npx playwright test -c tests/playwright.live.config.ts
 * Spends real fal credits (one short narration, ~$0.01).
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'readaloud.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: process.env.READALOUD_URL ?? 'https://readaloud.app.space',
    headless: true,
    launchOptions: chromiumLaunchOptions(),
  },
})
