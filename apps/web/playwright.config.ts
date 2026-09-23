import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests against the production build (real service worker) and the
 * dev API on a fresh dev database. Start them with:  npm run e2e
 * (global setup rebuilds the dev database; see tests/e2e/global-setup.ts)
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'node ../../tools/dev-api/server.mjs', port: 54321, reuseExistingServer: true,
      env: { DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:54329/ipl_dev' } },
    { command: 'npx vite build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 120_000,
      env: { VITE_SUPABASE_URL: 'http://localhost:54321' } },
  ],
});
