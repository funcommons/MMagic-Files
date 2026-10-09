/**
 * 业务线 5 —— 上传：setInputFiles→PutObject→uploadDone 事件；denyExts/超限拒收 toast。
 * 期望（用户手册 §一）：params.uploadMaxBytes 超限前端拒收；denyExts 命中拒收；上传成功入树。
 */
import { test, expect } from '@playwright/test'
import { hostConfigUrl, workspaceConfig, MOCK_PREFIX } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import {
  attachConsole,
  consoleEvidence,
  findEvent,
  shot,
  toolbarButton,
} from './fixtures/host'

const floc = (page: import('@playwright/test').Page) => page.frameLocator('#mmf')

async function openHostWorkspace(page: import('@playwright/test').Page, cfgOverrides: Record<string, unknown> = {}) {
  const state = await installS3Mock(page, { seed: defaultSeed() })
  await page.goto(hostConfigUrl(workspaceConfig(cfgOverrides)))
  await page.frameLocator('#mmf').locator('[data-testid="row"]').first().waitFor({ timeout: 30_000 })
  return state
}

test.describe('业务线5：上传', () => {
  test('up-01：上传 txt → PUT + uploadDone 事件 + 树自动刷新出现新文件（F6 修复验证）', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHostWorkspace(page)
    const frame = floc(page)

    await frame.locator('[data-testid="upload-input"]').setInputFiles({
      name: 'uploaded.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('uploaded via e2e\n', 'utf8'),
    })
    // PUT 到当前目录（根 prefix）+ uploadDone 事件
    await expect.poll(async () => state.putRequests.includes(`${MOCK_PREFIX}uploaded.txt`), { timeout: 15_000 }).toBe(true)
    const evt = await findEvent(page, 'uploadDone')
    expect(evt.payload).toMatchObject({ key: `${MOCK_PREFIX}uploaded.txt` })

    // F6 修复后契约：上传终态接树刷新（hooks.onDone → loadDir force）——免手动刷新即出现。
    // 修复前佐证（up-01a-after-upload-no-refresh.png）：上传完成后树无新文件，需手动刷新。
    await expect(frame.locator('[data-testid="row"]', { hasText: 'uploaded.txt' })).toBeVisible({ timeout: 10_000 })
    await shot(page, 'fix-upload-tree-autorefresh.png')

    // 手动刷新仍可用（幂等复核：刷新后行保持）
    await toolbarButton(frame, '刷新').click()
    await expect(frame.locator('[data-testid="row"]', { hasText: 'uploaded.txt' })).toBeVisible()
    await shot(page, 'up-01b-after-refresh-pass.png')
    console.log('[up-01] 修复验证：上传完成后新文件免手动刷新直接出现在树中（F6 已修）')
    console.log('[up-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('up-02：denyExts 命中（.exe）→ 拒收 toast，无 PUT', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHostWorkspace(page, { permissions: { denyExts: ['exe'] } })
    const frame = floc(page)

    await frame.locator('[data-testid="upload-input"]').setInputFiles({
      name: 'evil.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('MZfakebinary'),
    })
    await expect(page.frameLocator('#mmf').locator('.el-message', { hasText: '拒收' })).toBeVisible({ timeout: 10_000 })
    expect(state.putRequests.filter((k) => k.endsWith('evil.exe'))).toHaveLength(0)
    await shot(page, 'up-02-deny-ext-toast-pass.png', false)
    console.log('[up-02] console 证据：\n' + consoleEvidence(cap))
  })

  test('up-03：uploadMaxBytes 超限 → 拒收 toast（size），无 PUT', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHostWorkspace(page, { params: { uploadMaxBytes: 10 } })
    const frame = floc(page)

    await frame.locator('[data-testid="upload-input"]').setInputFiles({
      name: 'big.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(1024, 'a'),
    })
    await expect(page.frameLocator('#mmf').locator('.el-message', { hasText: '拒收' })).toBeVisible({ timeout: 10_000 })
    expect(state.putRequests.filter((k) => k.endsWith('big.txt'))).toHaveLength(0)
    await shot(page, 'up-03-size-limit-toast-pass.png', false)
    console.log('[up-03] console 证据：\n' + consoleEvidence(cap))
  })
})
