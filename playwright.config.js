import { defineConfig } from '@playwright/test';

const chromiumLaunch = { launchOptions: {
  ...(process.platform === 'win32' ? { args: ['--enable-gpu', '--use-angle=d3d11'] } : {}),
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
} };
export default defineConfig({
  testDir: './tests/browser',
  use: {
    baseURL: process.env.GAME_URL || 'http://localhost:5173', headless: true, trace: 'retain-on-failure',
  },
  webServer: process.env.GAME_URL ? undefined : { command: process.env.GAME_SERVER || (process.platform === 'win32' ? 'python run.py' : 'python3 run.py'), url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...chromiumLaunch, viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...chromiumLaunch, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ...(process.env.SECURITYLAB_CROSS_BROWSER === '1' ? [
      { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1440, height: 1000 } } },
      { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1440, height: 1000 } } },
    ] : []),
  ],
});
