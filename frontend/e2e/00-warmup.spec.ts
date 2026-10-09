/**
 * 00-warmup —— 预热用例（非业务线）：
 * 触发 vite dev 对重依赖（monaco-editor / mermaid / docx-preview / xlsx）的按需预构建，
 * 避免后续业务用例在首次动态 import 时遇到「optimized dependencies changed → 整页 reload」的抖动。
 * 通过后登记一份工作台全景截图（ws 全量基线）。
 */
import { test, expect } from '@playwright/test'
import { configUrl, workspaceConfig } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import { shot } from './fixtures/host'

test('warmup：预热重依赖并留存工作台基线截图', async ({ page }) => {
  const cfg = workspaceConfig()
  await installS3Mock(page, { seed: defaultSeed() })

  // monaco（notes.txt → code-editor）
  await page.goto(configUrl(cfg))
  const txtRow = page.locator('[data-testid="row"]', { hasText: 'notes.txt' })
  await expect(txtRow).toBeVisible({ timeout: 30_000 })
  await txtRow.dblclick()
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 60_000 })

  // mermaid（README.md 含 mermaid 围栏）
  await page.locator('[data-testid="row"]', { hasText: 'README.md' }).dblclick()
  await expect(page.locator('.ws__preview-host h1')).toContainText('欢迎使用 MMagic-Files')

  // docx-preview（非法 zip → 降级提示，但动态 import 已触发）
  await page.locator('[data-testid="row"]', { hasText: 'report.docx' }).dblclick()
  await expect(page.locator('.ws__preview-host >> text=/docx|失败|失败|load/i').first()).toBeVisible({ timeout: 30_000 })

  // xlsx（SheetJS）
  await page.locator('[data-testid="row"]', { hasText: 'table.xlsx' }).dblclick()
  await expect(page.locator('.xlsx-view, [class*="xlsx"]').first()).toBeVisible({ timeout: 30_000 })

  await shot(page, 'warmup-workspace-baseline-pass.png')
})
