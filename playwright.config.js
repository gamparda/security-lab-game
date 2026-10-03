import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: process.env.GAME_URL || 'http://localhost:5173', headless: true, trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: process.env.GAME_URL ? undefined : { command: process.env.GAME_SERVER || 'python3 run.py', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
