/**
 * Playwright E2E 配置（回归 2026-10-09-01）
 * - webServer: vite dev 5199（避开默认 9330），复用已起服务
 * - 证据目录: REPO/test-report/2026-10-09-01/{artifacts,screenshots}
 * - 浏览器: chromium（经 npmmirror 下载；如需换 channel: 'chrome'）
 */
import { defineConfig } from '@playwright/test'

const REPO = '/Users/justin/codes/funcommons/MMagic-Files'

export default defineConfig({
  testDir: 'e2e',
  // 串行执行：保证截图/请求计数断言的确定性，报告可读
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: `${REPO}/test-report/2026-10-09-01/artifacts`,
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    command: 'pnpm exec vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    env: { BROWSER: 'none' },
    timeout: 120_000,
  },
})
