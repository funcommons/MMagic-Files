/**
 * 第二轮回归 · 新功能取证补拍（临时探针，不进仓库、不断言产品行为、不改码）
 * 只做真实交互 + 截图；截图直写 REPO/test-report/2026-10-09-02/screenshots/
 * 复用主套件 fixtures（s3-mock / seed / config / host 工具）。
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { configUrl, workspaceConfig, MOCK_PREFIX } from '/Users/justin/codes/funcommons/MMagic-Files/frontend/e2e/fixtures/config'
import { installS3Mock } from '/Users/justin/codes/funcommons/MMagic-Files/frontend/e2e/fixtures/s3-mock'
import { defaultSeed } from '/Users/justin/codes/funcommons/MMagic-Files/frontend/e2e/fixtures/seed'
import { waitTreeLoaded, clickRow, openRow, enterDir, confirmMessageBox } from '/Users/justin/codes/funcommons/MMagic-Files/frontend/e2e/fixtures/host'

const SHOT = '/Users/justin/codes/funcommons/MMagic-Files/test-report/2026-10-09-02/screenshots'

async function shot(page: Page, name: string, fullPage = true): Promise<void> {
  await page.screenshot({ path: `${SHOT}/${name}`, fullPage })
}

/** 深目录种子：deep/ 下 120 个文件（>100 触发分页条） */
function deepSeed(): Record<string, { bytes: Buffer | string; contentType: string }> {
  const seed = defaultSeed()
  for (let i = 1; i <= 120; i++) {
    const n = String(i).padStart(3, '0')
    seed[`${MOCK_PREFIX}deep/f-${n}.txt`] = { bytes: `deep file ${n}\n`, contentType: 'text/plain' }
  }
  return seed
}

async function openWorkspace(page: Page, opts: { seed?: ReturnType<typeof defaultSeed>; delayPutKeys?: Record<string, number> } = {}) {
  const state = await installS3Mock(page, { seed: opts.seed ?? defaultSeed(), delayPutKeys: opts.delayPutKeys })
  await page.goto(configUrl(workspaceConfig()))
  await waitTreeLoaded(page)
  return state
}

const MOD = 'Meta' // macOS 上 mod+k = Meta+k

test('probe-01 工作台全景：树+分页器+预览tab+StatusBar+传输中心', async ({ page }) => {
  const seed = deepSeed()
  const state = await installS3Mock(page, { seed, delayPutKeys: { [`${MOCK_PREFIX}pano.txt`]: 8000 } })
  await page.goto(configUrl(workspaceConfig()))
  await waitTreeLoaded(page)

  // 预览 tab ×2（notes.txt 钉住 + data.csv 活动态——预览态原位替换，需先钉住才并存）
  await openRow(page, 'notes.txt')
  await expect(page.locator('[data-testid="preview-tabs"]')).toBeVisible()
  await page.locator('[data-testid="preview-tab"].is-active').dblclick()
  await expect(page.locator('[data-testid="preview-tab"].is-pinned')).toHaveCount(1)
  await openRow(page, 'data.csv')
  await expect(page.locator('[data-testid="preview-tab"]')).toHaveCount(2)

  // 传输中心：慢上传进行中（8s 窗口内截全景）
  await page.locator('[data-testid="upload-input"]').setInputFiles([
    { name: 'pano.txt', mimeType: 'text/plain', buffer: Buffer.from('panorama upload') },
  ])
  await expect(page.locator('[data-testid="upload-panel"]')).toBeVisible()
  await expect(page.locator('[data-testid="upload-item"]').first()).toBeVisible()

  // 分页器：进入 deep/（120 条 > 100）
  await enterDir(page, 'deep')
  await expect(page.locator('[data-testid="tree-pager"]')).toBeVisible()

  // StatusBar 在底部
  await expect(page.locator('[data-testid="statusbar"]')).toBeVisible()
  await shot(page, 'probe-01-workspace-panorama.png')
  void state
})

test('probe-02 全局搜索：冷索引空态 → 扫描 → 结果', async ({ page }) => {
  await openWorkspace(page, { seed: deepSeed() })
  await page.locator('[data-testid="toolbar-search"]').click()
  const dlg = page.locator('.search-dialog, [class*="search"]', { has: page.locator('[data-testid="query"]') }).first()
  await expect(dlg).toBeVisible()

  // 冷索引：未扫描直接查 → 空
  await page.locator('[data-testid="query"]').fill('md')
  await page.waitForTimeout(600)
  await shot(page, 'probe-02a-search-cold-empty.png')

  // 扫描 → 已索引条数 > 0 → 查询出结果
  await page.locator('[data-testid="scan"]').click()
  await expect(page.locator('[data-testid="index-count"]')).toContainText(/\d/, { timeout: 30_000 })
  const countText = await page.locator('[data-testid="index-count"]').textContent()
  console.log('[probe-02] index-count =', countText)
  await page.locator('[data-testid="query"]').fill('md')
  await expect(page.locator('[data-testid="result-row"]').first()).toBeVisible({ timeout: 10_000 })
  await shot(page, 'probe-02b-search-scan-results.png')
})

test('probe-03 分享对话框：生成 GET 预签名链接', async ({ page }) => {
  await openWorkspace(page)
  await clickRow(page, 'README.md')
  await page.locator('[data-testid="toolbar-share"]').click()
  await expect(page.locator('[data-testid="share-dialog"]')).toBeVisible()
  await page.locator('[data-testid="share-generate"]').click()
  await expect(page.locator('[data-testid="share-get-url"]')).toHaveValue(/X-Amz-Signature/, { timeout: 15_000 })
  const val = await page.locator('[data-testid="share-get-url"]').inputValue()
  console.log('[probe-03] GET url =', val.slice(0, 120), '...')
  await shot(page, 'probe-03-share-dialog-get-url.png')
})

test('probe-04 预览 tab：连开两文件 + 双击钉住', async ({ page }) => {
  await openWorkspace(page)
  await openRow(page, 'notes.txt')
  await expect(page.locator('[data-testid="preview-tab"]')).toHaveCount(1)
  // 钉住第一个 → 再开第二个 → 两 tab 并存（预览态不钉住会被原位替换）
  await page.locator('[data-testid="preview-tab"].is-active').dblclick()
  await expect(page.locator('[data-testid="preview-tab"].is-pinned')).toHaveCount(1)
  await openRow(page, 'data.csv')
  await expect(page.locator('[data-testid="preview-tab"]')).toHaveCount(2)
  // 双击活动 tab（data.csv）→ 钉住 → 两 tab 均为钉住态
  await page.locator('[data-testid="preview-tab"].is-active').dblclick()
  await expect(page.locator('[data-testid="preview-tab-pin"]')).toHaveCount(2)
  await expect(page.locator('[data-testid="preview-tab"].is-pinned')).toHaveCount(2)
  await shot(page, 'probe-04-preview-tabs-pin.png')
})

test('probe-05 传输中心：暂停/恢复', async ({ page }) => {
  const D = 8000
  const delays: Record<string, number> = {}
  const names = ['slow-1.txt', 'slow-2.txt', 'slow-3.txt', 'slow-4.txt']
  for (const n of names) delays[`${MOCK_PREFIX}${n}`] = D
  await openWorkspace(page, { delayPutKeys: delays })
  const mk = (name: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name} payload\n`) })
  await page.locator('[data-testid="upload-input"]').setInputFiles(names.map(mk))
  const panel = page.locator('[data-testid="upload-panel"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-testid="upload-item"]')).toHaveCount(4)

  // 并发=3：slow-1~3 上传中（PUT 各慢 8s）→ slow-4 排队；暂停排队中的 slow-4（直传在途项无暂停效果）
  const item2 = panel.locator('[data-testid="upload-item"]', { hasText: 'slow-4.txt' })
  await item2.locator('[data-testid="upload-pause"]').click()
  await expect(item2).toContainText('已暂停')
  await expect(item2.locator('[data-testid="upload-resume"]')).toBeVisible()
  await shot(page, 'probe-05a-transfer-pause.png')

  // 恢复 → 三条全部「已完成」
  await item2.locator('[data-testid="upload-resume"]').click()
  await expect(panel.locator('[data-testid="upload-item"]', { hasText: '已完成' })).toHaveCount(4, { timeout: 45_000 })
  await shot(page, 'probe-05b-transfer-resume-done.png')
})

test('probe-06 命令面板：⌘K 唤起取证（AppLayout 未挂载 → 无响应）', async ({ page }) => {
  await openWorkspace(page)
  await page.keyboard.press(`${MOD}+k`)
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(800)
  const n = await page.locator('.fc-cp').count()
  console.log('[probe-06] ⌘K/Ctrl+K 后 .fc-cp 面板数量 =', n, '（0=面板未唤起；mod+k 唯一绑定在未挂载的 AppLayout）')
  await shot(page, 'probe-06-command-palette-no-response.png', false)
  expect(n).toBe(0)
})

test('probe-07 boot 失败卡 + 本地连接向导表单', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('配置解析失败')).toBeVisible()
  await shot(page, 'probe-07a-boot-error-card.png')
  await page.locator('[data-testid="wizard-open"]').click()
  await expect(page.locator('[data-testid="f-endpoint"]')).toBeVisible()
  // 填几项让表单有内容（不提交）
  await page.locator('[data-testid="f-name"]').fill('本地 MinIO')
  await page.locator('[data-testid="f-endpoint"]').fill('http://127.0.0.1:9000')
  await page.locator('[data-testid="f-bucket"]').fill('demo')
  await page.locator('[data-testid="f-access-key"]').fill('AKIA-demo')
  await shot(page, 'probe-07b-connect-wizard-form.png')
})

test('probe-08 键盘流：Alt+↑ 面包屑回退（前后）', async ({ page }) => {
  await openWorkspace(page)
  await enterDir(page, 'docs')
  await expect(page.locator('[data-testid="row"]', { hasText: 'guide.md' })).toBeVisible()
  await shot(page, 'probe-08a-keyboard-before-docs.png', false)

  await page.locator('[data-testid="tree-list"]').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.locator('[data-testid="row"]', { hasText: 'README.md' })).toBeVisible({ timeout: 10_000 })
  await shot(page, 'probe-08b-keyboard-altup-root.png', false)
})

test('probe-09 上传冲突对话框（覆盖/跳过/关闭三态）', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('[data-testid="upload-input"]').setInputFiles([
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('conflict copy\n') },
  ])
  const box = page.locator('.el-message-box')
  await expect(box).toBeVisible()
  await expect(box).toContainText('文件名冲突')
  await page.waitForTimeout(500) // 等 fade-in 完成
  const btns = await box.locator('.el-message-box__btns button').allTextContents()
  console.log('[probe-09] 冲突对话框按钮 =', JSON.stringify(btns), '（关闭=X，词典 conflict-abort 键未渲染）')
  await shot(page, 'probe-09-upload-conflict-dialog.png', false)
  await box.locator('.el-message-box__btns button').first().click() // 跳过收场
})

test('probe-10 深目录分页条 + 跳页', async ({ page }) => {
  await openWorkspace(page, { seed: deepSeed() })
  await enterDir(page, 'deep')
  const pager = page.locator('[data-testid="tree-pager"]')
  await expect(pager).toBeVisible()
  await expect(page.locator('[data-testid="tree-pager-page"]')).toContainText('1 / 2')
  await expect(page.locator('[data-testid="row"]')).toHaveCount(100)
  await shot(page, 'probe-10a-deep-dir-pager.png', false)

  // 跳页输入 → 第 2 页 20 条
  await page.locator('[data-testid="tree-pager-jump"]').fill('2')
  await page.locator('[data-testid="tree-pager-jump"]').press('Enter')
  await expect(page.locator('[data-testid="tree-pager-page"]')).toContainText('2 / 2')
  await expect(page.locator('[data-testid="row"]')).toHaveCount(20)
  await shot(page, 'probe-10b-deep-dir-pager-page2.png', false)
})

test('probe-11 csv 双闸叠加：20MB 确认放行后仍被 csv 渲染器 20MB 拒', async ({ page }) => {
  const big = ('a,b,c\n' + 'x,y,z\n').repeat(21 * 1024 * 102) // ≈21MB
  const seed = defaultSeed()
  seed[`${MOCK_PREFIX}big.csv`] = { bytes: Buffer.from(big, 'utf8'), contentType: 'text/csv' }
  await openWorkspace(page, { seed })
  await openRow(page, 'big.csv')

  // 第一闸：预览级确认（CONFIRM=20MB < size ≤ REJECT=50MB）
  const box = page.locator('.el-message-box')
  await expect(box).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(500) // 等 fade-in 完成
  await shot(page, 'probe-11a-csv-largefile-confirm.png', false)
  await confirmMessageBox(page)

  // 第二闸：csv 渲染器 20MB 拒（>20MB 提示）——双闸叠加实锤
  await expect(page.locator('.ws__preview-host')).toContainText('CSV 过大', { timeout: 20_000 })
  await shot(page, 'probe-11b-csv-renderer-rejected-after-confirm.png', false)
})

test('probe-12 markdown 5MB 上限提示（单位口径取证）', async ({ page }) => {
  const big = ('# 标题\n\n段落内容测试。\n\n').repeat(200_000) // ≈5.9MB（>5MB 渲染闸，<20MB 预览确认闸）
  const seed = defaultSeed()
  seed[`${MOCK_PREFIX}big.md`] = { bytes: Buffer.from(big, 'utf8'), contentType: 'text/markdown' }
  await openWorkspace(page, { seed })
  await openRow(page, 'big.md')
  await expect(page.locator('.ws__preview-host')).toContainText('5MB', { timeout: 20_000 })
  await shot(page, 'probe-12-markdown-5mb-limit.png', false)
})

test('probe-13 painter：svg 打开画板保存（PNG 降级提示取证）', async ({ page }) => {
  const seed = defaultSeed()
  seed[`${MOCK_PREFIX}icon.svg`] = {
    bytes: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#409eff"/><circle cx="32" cy="32" r="16" fill="#fff"/></svg>',
    contentType: 'image/svg+xml',
  }
  const state = await openWorkspace(page, { seed })
  const before = state.putRequests.length

  // 右键 icon.svg → 打开方式 → 图片标注（image-painter）
  await page.locator('[data-testid="row"]', { hasText: 'icon.svg' }).click({ button: 'right' })
  const menu = page.locator('.fc-menu')
  await expect(menu).toBeVisible()
  await menu.locator('button', { hasText: '图片标注' }).first().click()
  const canvas = page.locator('.ws__preview-host canvas')
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await shot(page, 'probe-13a-painter-svg-canvas.png', false)

  // 保存 → PUT 发生；观察有无「svg 将存为 PNG」提示（预期：无）
  await page.locator('button.mmagic-painter-save').click()
  await expect
    .poll(async () => state.putRequests.length, { timeout: 15_000 })
    .toBeGreaterThan(before)
  console.log('[probe-13] putRequests =', JSON.stringify(state.putRequests.slice(before)))
  await page.waitForTimeout(600)
  await shot(page, 'probe-13b-painter-svg-saved-no-hint.png', false)
})
