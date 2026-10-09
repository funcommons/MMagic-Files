/**
 * 业务线 11 —— 工作台交互面（Lane F5）：右键菜单（open-with）/ 拖拽上传 / 多选批量删除 /
 * UploadPanel 取消。
 * 期望（手册「双击/回车打开」交互模型 + §一 features）：
 *  - 行右键 → 菜单（打开/打开方式▸应用子列/重命名/删除/下载/新建目录），open-with 指定应用打开预览；
 *  - 容器 drop → queue.enqueue(当前目录) → PUT + 入树 + 上传面板终态；
 *  - ctrl 多选 → 下载批量语义启用 → 删除走多选确认（{n} 文案）→ 两对象一并 DeleteObjects；
 *  - 上传中任务取消钮可见 → 取消 → 「已取消」终态。
 * （双击=打开预览由业务线 3/9 与 warmup 的 dblclick 改造覆盖，此处不重复。）
 */
import os from 'node:os'
import { test, expect } from '@playwright/test'
import { configUrl, workspaceConfig, MOCK_PREFIX } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import {
  attachConsole,
  confirmMessageBox,
  consoleEvidence,
  shot,
  toolbarButton,
  waitTreeLoaded,
} from './fixtures/host'

async function openWorkspace(
  page: import('@playwright/test').Page,
  opts: { delayPutKeys?: Record<string, number> } = {},
) {
  const state = await installS3Mock(page, { seed: defaultSeed(), delayPutKeys: opts.delayPutKeys })
  await page.goto(configUrl(workspaceConfig()))
  await waitTreeLoaded(page)
  return state
}

/**
 * 多选修饰键：macOS 上 Control+click 被 Chromium 合成为右键（contextmenu，无 click 事件），
 * 组件侧 ctrl/meta 等价（onRowClick: ctrlKey || metaKey），故 mac 用 Meta、其余用 Control。
 */
const MULTI_MODIFIER = os.platform() === 'darwin' ? 'Meta' : 'Control'

test.describe('业务线11：工作台交互面（Lane F5）', () => {
  test('wb-01：行右键 → 菜单出现（打开/打开方式/重命名/删除/下载/新建目录），open-with 指定应用打开', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)

    // csv 命中两个应用（csv-table 默认 + code-editor）→「打开方式」下应列应用子列
    await page.locator('[data-testid="row"]', { hasText: 'data.csv' }).click({ button: 'right' })
    const menu = page.locator('.fc-menu')
    await expect(menu).toBeVisible()
    for (const label of ['打开', '打开方式', '重命名', '删除', '下载', '新建目录']) {
      await expect(menu.locator('button', { hasText: label }).first()).toBeVisible()
    }
    await expect(menu.locator('button', { hasText: '表格视图' })).toBeVisible()
    await expect(menu.locator('button', { hasText: '代码编辑' })).toBeVisible()

    // open-with → preview.open(entry, {appId:'code-editor'}) → Monaco 渲染 csv
    await menu.locator('button', { hasText: '代码编辑' }).click()
    await expect(menu).toBeHidden() // 选中后自动关
    await expect(page.locator('.ws__preview-host .monaco-editor')).toBeVisible({ timeout: 30_000 })
    await shot(page, 'wb-01-context-menu-open-with-pass.png', false)
    console.log('[wb-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('wb-02：容器拖拽 drop → enqueue 当前目录 → PUT + 入树 + 上传面板完成态', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openWorkspace(page)

    const dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['dropped via e2e dnd'], 'dropped-dnd.txt', { type: 'text/plain' }))
      return dt
    })
    await page.locator('.tree-panel').dispatchEvent('drop', { dataTransfer })

    // PUT 到当前目录 + 树出现新文件 + 上传面板终态「已完成」
    await expect
      .poll(async () => state.putRequests.includes(`${MOCK_PREFIX}dropped-dnd.txt`), { timeout: 15_000 })
      .toBe(true)
    await expect(page.locator('[data-testid="row"]', { hasText: 'dropped-dnd.txt' })).toBeVisible({ timeout: 10_000 })
    const panel = page.locator('[data-testid="upload-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-testid="upload-item"]', { hasText: 'dropped-dnd.txt' })).toContainText('已完成')
    await shot(page, 'wb-02-dragdrop-upload-pass.png')
    console.log('[wb-02] console 证据：\n' + consoleEvidence(cap))
  })

  test('wb-03：ctrl 多选 → 批量下载钮启用 → 删除走 {n} 多选确认 → 两对象一并删除', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openWorkspace(page)

    await page.locator('[data-testid="row"]', { hasText: 'README.md' }).click()
    await page.locator('[data-testid="row"]', { hasText: 'notes.txt' }).click({ modifiers: [MULTI_MODIFIER] })

    // 多选（均非目录）→「下载」启用（批量打包语义）；重命名按首项可用
    await expect(toolbarButton(page, '下载')).toBeEnabled()
    await expect(toolbarButton(page, '重命名')).toBeEnabled()

    await toolbarButton(page, '删除').click()
    // 多选确认文案（delete-multi-confirm {n}），非单文件名确认
    await expect(page.locator('.el-message-box')).toContainText('确定删除选中的 2 项')
    await confirmMessageBox(page)

    await expect(page.locator('[data-testid="row"]', { hasText: 'README.md' })).toHaveCount(0)
    await expect(page.locator('[data-testid="row"]', { hasText: 'notes.txt' })).toHaveCount(0)
    const deleted = state.deleteRequests.flat()
    expect(deleted).toContain(`${MOCK_PREFIX}README.md`)
    expect(deleted).toContain(`${MOCK_PREFIX}notes.txt`)
    await shot(page, 'wb-03-multi-delete-pass.png')
    console.log('[wb-03] console 证据：\n' + consoleEvidence(cap))
  })

  test('wb-04：上传中任务取消钮可见 → 取消 → 「已取消」终态（UploadPanel）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page, { delayPutKeys: { [`${MOCK_PREFIX}slow.txt`]: 8000 } })

    await page.locator('[data-testid="upload-input"]').setInputFiles([
      { name: 'quick.txt', mimeType: 'text/plain', buffer: Buffer.from('quick') },
      { name: 'slow.txt', mimeType: 'text/plain', buffer: Buffer.from('slow payload') },
    ])
    const panel = page.locator('[data-testid="upload-panel"]')
    await expect(panel).toBeVisible()
    await expect(panel.locator('[data-testid="upload-item"]', { hasText: 'quick.txt' })).toContainText('已完成', {
      timeout: 10_000,
    })

    const slowItem = panel.locator('[data-testid="upload-item"]', { hasText: 'slow.txt' })
    const cancelBtn = slowItem.locator('[data-testid="upload-cancel"]')
    await expect(cancelBtn).toBeVisible()
    await cancelBtn.click()
    await expect(slowItem).toContainText('已取消', { timeout: 5_000 })
    // 取消后清记录钮可用（终态存在）且清除后面板消失
    await panel.locator('[data-testid="upload-clear"]').click()
    await expect(panel).toBeHidden()
    await shot(page, 'wb-04-upload-cancel-pass.png', false)
    console.log('[wb-04] console 证据：\n' + consoleEvidence(cap))
  })
})
