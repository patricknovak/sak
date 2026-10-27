import { defineConfig, devices } from '@playwright/test';

// Two surfaces under test: the marketing site (landing/) and the built app (dist/ via vite preview).
// Auth against a real test account is optional (E2E_EMAIL + E2E_PASSWORD); without them that spec skips.
// Analytics egress: every spec imports e2e/fixtures.ts, which blocks googletagmanager / google-analytics /
// doubleclick on the browser context (fulfill GTM with 204, abort collect). Do not import @playwright/test
// directly in specs or that block is skipped.
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'landing',
      testMatch: /landing\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'app',
      testMatch: /app-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' },
    },
  ],
  webServer: [
    {
      command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory landing',
      url: 'http://127.0.0.1:4173/',
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: 'npx vite preview --port 4174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:4174/',
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
  ],
});
