/**
 * 业务线 4 —— 工具栏操作：新建目录（prompt→PUT→树刷新）/ 删除（confirm→DeleteObjects）/
 * 重命名（copy+delete）/ 刷新（强制重拉）。
 * 期望（用户手册 §二）：操作后文件树同步；JSSDK 事件（fileChanged）同步宿主。
 */
import { test, expect } from '@playwright/test'
import { hostConfigUrl, workspaceConfig, MOCK_PREFIX } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import {
  attachConsole,
  confirmMessageBox,
  consoleEvidence,
  findEvent,
  shot,
  toolbarButton,
} from './fixtures/host'

async function openHostWorkspace(page: import('@playwright/test').Page) {
  const state = await installS3Mock(page, { seed: defaultSeed() })
  await page.goto(hostConfigUrl(workspaceConfig()))
  await page.frameLocator('#mmf').locator('.ws').waitFor({ state: 'visible', timeout: 30_000 })
  await page.frameLocator('#mmf').locator('[data-testid="row"]').first().waitFor({ timeout: 30_000 })
  return state
}

const floc = (page: import('@playwright/test').Page) => page.frameLocator('#mmf')

test.describe('业务线4：工具栏操作', () => {
  test('tb-01：新建目录 → PUT 目录标记 → 树出现新目录 + fileChanged(put)', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHostWorkspace(page)
    const frame = floc(page)

    await toolbarButton(frame, '新建目录').click()
    await confirmMessageBox(frame, 'newdir')
    expect(state.putRequests).toContain(`${MOCK_PREFIX}newdir/`)
    await expect(frame.locator('[data-testid="dir-name"]', { hasText: 'newdir' })).toBeVisible()
    const evt = await findEvent(page, 'fileChanged')
    expect(evt.payload).toMatchObject({ key: `${MOCK_PREFIX}newdir/`, action: 'put' })
    await shot(page, 'tb-01-mkdir-pass.png')
    console.log('[tb-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('tb-02：选中文件 → 删除（confirm）→ DeleteObjects + 行消失 + fileChanged(delete)', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHostWorkspace(page)
    const frame = floc(page)

    await frame.locator('[data-testid="row"]', { hasText: 'README.md' }).click()
    // 2026-10 布局：选中簇仅在已开 tab 时显示——先打开文件
    await frame.locator('[data-testid="row"]', { hasText: 'README.md' }).first().dblclick()
    await toolbarButton(frame, '删除').click()
    // 确认弹窗含文件名
    const box = frame.locator('.el-message-box')
    await expect(box).toContainText('README.md')
    await confirmMessageBox(frame)
    expect(state.deleteRequests.flat()).toContain(`${MOCK_PREFIX}README.md`)
    await expect(frame.locator('[data-testid="row"]', { hasText: 'README.md' })).toHaveCount(0)
    const evt = await findEvent(page, 'fileChanged')
    expect(evt.payload).toMatchObject({ key: `${MOCK_PREFIX}README.md`, action: 'delete' })
    await shot(page, 'tb-02-delete-pass.png')
    console.log('[tb-02] console 证据：\n' + consoleEvidence(cap))
  })

  test('tb-03：重命名 → copy+delete 语义 → 行更新 + fileChanged(rename)', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHostWorkspace(page)
    const frame = floc(page)

    await frame.locator('[data-testid="row"]', { hasText: 'notes.txt' }).click()
    await frame.locator('[data-testid="row"]', { hasText: 'notes.txt' }).first().dblclick() // 选中簇仅在已开 tab 时显示
    await toolbarButton(frame, '重命名').click()
    await confirmMessageBox(frame, 'renamed.txt')
    expect(state.copyRequests).toContainEqual({ from: `${MOCK_PREFIX}notes.txt`, to: `${MOCK_PREFIX}renamed.txt` })
    expect(state.deleteRequests.flat()).toContain(`${MOCK_PREFIX}notes.txt`)
    await expect(frame.locator('[data-testid="row"]', { hasText: 'renamed.txt' })).toBeVisible()
    await expect(frame.locator('[data-testid="row"]', { hasText: 'notes.txt' })).toHaveCount(0)
    const evt = await findEvent(page, 'fileChanged')
    expect(evt.payload).toMatchObject({ key: `${MOCK_PREFIX}renamed.txt`, action: 'rename', from: `${MOCK_PREFIX}notes.txt` })
    await shot(page, 'tb-03-rename-pass.png')
    console.log('[tb-03] console 证据：\n' + consoleEvidence(cap))
  })

  test('tb-04：刷新 → 强制重拉当前目录（list 请求 +1）', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openHostWorkspace(page)
    const frame = floc(page)

    const before = state.listRequests.filter((r) => r.prefix === MOCK_PREFIX).length
    await toolbarButton(frame, '刷新').click()
    await expect
      .poll(async () => state.listRequests.filter((r) => r.prefix === MOCK_PREFIX).length, { timeout: 10_000 })
      .toBe(before + 1)
    await expect(frame.locator('[data-testid="row"]', { hasText: 'README.md' })).toBeVisible()
    await shot(page, 'tb-04-refresh-pass.png')
    console.log('[tb-04] console 证据：\n' + consoleEvidence(cap))
  })
})
