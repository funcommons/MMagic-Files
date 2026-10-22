/**
 * 业务线 7 —— features 门控（features.delete=false）。
 * 手册承诺（§一字段速查 + FAQ）：false=对应操作整链禁用（UI 隐藏 + API 拒绝）。
 * 本线三方对照：①JSSDK API remove 是否 4301；②Toolbar 删除按钮是否隐藏/禁用；③内部 UI 路径是否真的拒绝删除。
 */
import { test, expect } from '@playwright/test'
import { hostConfigUrl, workspaceConfig, MOCK_PREFIX } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import {
  attachConsole,
  consoleEvidence,
  sendCommand,
  shot,
  toolbarButton,
} from './fixtures/host'

const FEATURES_OFF = { features: { delete: false } }

async function openHost(page: import('@playwright/test').Page, overrides: Record<string, unknown> = {}) {
  const state = await installS3Mock(page, { seed: defaultSeed() })
  await page.goto(hostConfigUrl(workspaceConfig({ ...FEATURES_OFF, ...overrides })))
  await page.frameLocator('#mmf').locator('[data-testid="row"]').first().waitFor({ timeout: 30_000 })
  return state
}

const floc = (page: import('@playwright/test').Page) => page.frameLocator('#mmf')

test.describe('业务线7：features 门控（delete=false）', () => {
  test('feat-01：JSSDK remove 命令 → reply ok=false code=4301（API 拒绝层）', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHost(page)
    const reply = await sendCommand(page, 'remove', { paths: ['notes.txt'] })
    expect(reply.ok).toBe(false)
    expect(reply.code).toBe(4301)
    // 确认真的没有打到 S3
    expect(state.deleteRequests).toHaveLength(0)
    await shot(page, 'feat-01-api-remove-4301-pass.png')
    console.log('[feat-01] remove reply=' + JSON.stringify(reply))
    console.log('[feat-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('feat-02：features.delete=false → 删除按钮隐藏（F1 修复验证：UI 门控「UI 隐藏」层）', async ({ page }) => {
    const cap = attachConsole(page)
    await openHost(page)
    const frame = floc(page)
    // 先选中并打开一行（排除「无选中禁用」的干扰，专证门控；选中簇仅在已开 tab 时显示）
    await frame.locator('[data-testid="row"]', { hasText: 'notes.txt' }).click()
    await frame.locator('[data-testid="row"]', { hasText: 'notes.txt' }).first().dblclick()
    // 手册承诺「UI 隐藏」：删除入口不渲染。修复前佐证（feat-02-delete-button-still-enabled-FINDING.png）：
    // 按钮可见且可点。
    const delBtn = toolbarButton(frame, '删除')
    await expect(delBtn).toHaveCount(0)
    // 未被门控的操作入口保持可用（门控粒度=逐 feature）
    await expect(toolbarButton(frame, '重命名')).toBeVisible()
    await expect(toolbarButton(frame, '刷新')).toBeVisible()
    await shot(page, 'fix-features-delete-hidden.png')
    console.log('[feat-02] 修复验证：features.delete=false 时删除按钮已隐藏（重命名/刷新不受影响）')
    console.log('[feat-02] console 证据：\n' + consoleEvidence(cap))
  })

  test('feat-03：features.delete=false → UI 删除链整链拒绝，无 S3 删除（F1 修复验证）', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHost(page)
    const frame = floc(page)

    await frame.locator('[data-testid="row"]', { hasText: 'notes.txt' }).click()
    // UI 隐藏层：删除入口不存在 → 确认弹窗链无从触发（「整链禁用」承诺的第一环）。
    // 修复前佐证（feat-03-ui-delete-bypasses-gate-FINDING.png）：按钮可点，DeleteObjects 真实发出。
    await expect(toolbarButton(frame, '删除')).toHaveCount(0)
    await expect(frame.locator('.el-message-box')).toHaveCount(0)

    // 留观察窗口：确认无任何 S3 删除打到 mock（API 层另由 feat-01 的 4301 覆盖）
    await page.waitForTimeout(1500)
    const deleted = state.deleteRequests.flat()
    console.log(`[feat-03] features.delete=false 时 UI 删除路径发出的 DeleteObjects keys=${JSON.stringify(deleted)}`)
    expect(deleted, 'features.delete=false 时 UI 路径不应触发 S3 删除（手册承诺整链拒绝）').toHaveLength(0)
    // 行未被删（对象完好）
    await expect(frame.locator('[data-testid="row"]', { hasText: 'notes.txt' })).toBeVisible()
    await shot(page, 'fix-features-delete-chain.png')
    console.log('[feat-03] 修复验证：UI 删除链整链拒绝（入口隐藏 + 无 S3 删除 + 数据完好）')
    console.log('[feat-03] console 证据：\n' + consoleEvidence(cap))
  })
})
