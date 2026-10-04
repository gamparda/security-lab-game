import { defineConfig } from '@playwright/test';

const isWindows = process.platform === 'win32';
// Hosted runners may render in software. D3D11 is a Windows backend choice,
// not evidence of hardware acceleration or representative PC performance.
const chromiumArgs = isWindows
  ? ['--enable-gpu', '--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const chromiumLaunch = {
  browserName: 'chromium',
  launchOptions: {
    args: chromiumArgs,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  },
};
export default defineConfig({
  testDir: './tests/browser',
  // Native pointer lock needs a real display on Linux. Headed runs share that
  // display, so keep one active browser to avoid stealing focus from 3D input.
  workers: process.env.SECURITYLAB_HEADED === '1' ? 1 : undefined,
  use: {
    baseURL: process.env.GAME_URL || 'http://localhost:5173',
    headless: process.env.SECURITYLAB_HEADED !== '1', trace: 'retain-on-failure',
  },
  webServer: process.env.GAME_URL ? undefined : { command: process.env.GAME_SERVER || (isWindows ? 'python run.py' : 'python3 run.py'), url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...chromiumLaunch, viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...chromiumLaunch, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ...(process.env.SECURITYLAB_CROSS_BROWSER === '1' ? [
      { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1440, height: 1000 } } },
      { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1440, height: 1000 } } },
    ] : []),
    ...(isWindows && process.env.SECURITYLAB_EDGE === '1' ? [{
      name: 'windows-edge',
      // Keep the full 2D regression suite and focused native-host 3D smoke cases.
      grep: /game\.spec\.js|@windows-edge/,
      use: {
        browserName: 'chromium', channel: 'msedge',
        launchOptions: { args: chromiumArgs },
        viewport: { width: 1440, height: 1000 },
      },
    }] : []),
  ],
});
