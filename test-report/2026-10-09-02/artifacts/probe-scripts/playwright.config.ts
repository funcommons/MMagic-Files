/**
 * 第二轮回归 · 新功能取证补拍配置（临时探针，不进仓库）
 * - testDir/outputDir 全在 /tmp；截图直写 REPO/test-report/2026-10-09-02/screenshots/
 * - dev server 复用已起的 vite 5199（与主套件同源）
 */
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '/tmp/mmf-probe',
  workers: 1,
  fullyParallel: false,
  timeout: 150_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: '/tmp/mmf-probe/artifacts',
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
})
