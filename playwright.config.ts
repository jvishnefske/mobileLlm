import { defineConfig } from '@playwright/test';

// E2E tests run against the production build served by `vite preview`
// (base path '/', so build without BASE_PATH before running).
// Set CHROMIUM_PATH to use a system Chromium instead of the downloaded one.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: 'http://localhost:4317',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
    },
  },
  webServer: {
    command: 'npm run preview -- --port 4317 --strictPort',
    url: 'http://localhost:4317',
    reuseExistingServer: !process.env.CI,
  },
});
