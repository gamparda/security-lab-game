import { defineConfig } from '@playwright/test';

const isWindows = process.platform === 'win32';
// Hosted runners may render in software. D3D11 is a Windows backend choice,
// not evidence of hardware acceleration or representative PC performance.
const chromiumArgs = isWindows
  ? ['--enable-gpu', '--use-gl=angle', process.env.CI ? '--use-angle=d3d11-warp' : '--use-angle=d3d11', '--enable-unsafe-swiftshader']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const chromiumLaunch = {
  browserName: 'chromium',
  // Use the regular browser's headless mode, which shares the native graphics
  // and input implementation used by players, instead of headless shell.
  ...(process.env.CI ? { channel: 'chromium' } : {}),
  launchOptions: {
    args: chromiumArgs,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  },
};
export default defineConfig({
  testDir: './tests/browser',
  // Windows software graphics must not compete across browser processes.
  // Linux keeps one native 3D window alongside headless 2D regressions.
  workers: process.env.CI ? (isWindows ? 1 : 2) : 2,
  use: {
    baseURL: process.env.GAME_URL || 'http://localhost:5173',
    headless: true,
    // Keep tracing work away from live Windows software graphics. Action and
    // console traces remain; explicit screenshots still run where required.
    trace: isWindows && process.env.CI
      ? {mode:'retain-on-failure',screenshots:false,snapshots:false} : 'retain-on-failure',
  },
  webServer: process.env.GAME_URL ? undefined : { command: process.env.GAME_SERVER || (isWindows ? 'python run.py' : 'python3 run.py'), url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  projects: [
    { name: 'desktop', use: { ...chromiumLaunch, headless: process.env.SECURITYLAB_HEADED !== '1', viewport: { width: 1440, height: 1000 } } },
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
        headless: process.env.SECURITYLAB_HEADED !== '1',
        launchOptions: { args: chromiumArgs },
        viewport: { width: 1440, height: 1000 },
      },
    }] : []),
  ],
});
