/**
 * 业务线 3 —— 渲染器预览：md→markdown HTML / png→img / csv→表格 / txt→Monaco / mp4→video /
 * 未匹配类型→fallback 下载提示 / GET 失败→错误 toast。
 * 期望（第一期文件类型支持计划）：各类型走默认应用渲染；未命中→「可下载后查看」。
 */
import { test, expect } from '@playwright/test'
import { configUrl, workspaceConfig } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import { attachConsole, consoleEvidence, openRow, shot, waitTreeLoaded } from './fixtures/host'

async function openWorkspace(page: import('@playwright/test').Page, failGetKey: Record<string, number> = {}) {
  const state = await installS3Mock(page, { seed: defaultSeed(), failGetKey })
  await page.goto(configUrl(workspaceConfig()))
  await waitTreeLoaded(page)
  return state
}

test.describe('业务线3：渲染器预览', () => {
  test('render-01：.md → markdown HTML（标题/链接加固 target=_blank）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'README.md')
    const stage = page.locator('.ws__preview-host')
    await expect(stage.locator('h1')).toContainText('欢迎使用 MMagic-Files')
    await expect(stage.locator('strong')).toContainText('加粗')
    const link = stage.locator('a[href="https://example.com/mmagic"]')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
    await shot(page, 'render-01-markdown-pass.png')
    console.log('[render-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('render-02：.png → <img>（blob URL）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'logo.png')
    const img = page.locator('.mmagic-image-view img')
    await expect(img).toBeVisible()
    expect(await img.getAttribute('src')).toMatch(/^blob:/)
    await shot(page, 'render-02-image-pass.png')
    console.log('[render-02] console 证据：\n' + consoleEvidence(cap))
  })

  test('render-03：.csv 默认应用=csv-table 表格（F3 修复验证：注册序渲染类优先，舞台尺寸达标）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'data.csv')
    // F3 修复后契约：csv-table（渲染类）注册序先于 code-editor，resolveDefault 命中表格预览；
    // code-editor 的 csv 文本态经「打开方式」可达（M2 菜单落地前不占默认）。
    const table = page.locator('.mmagic-csv-table')
    await expect(table).toBeVisible({ timeout: 30_000 })
    const headers = await page.locator('.mmagic-csv-table thead th, .mmagic-csv-table thead td').allTextContents()
    expect(headers.join('|')).toContain('name')
    await expect(page.locator('.mmagic-csv-table tbody', { hasText: 'Alice' })).toBeVisible()
    // F5：预览舞台恒定尺寸——渲染器舞台可视（boundingBox > 200px）
    await expect
      .poll(async () => (await page.locator('.mmf-preview-stage').boundingBox())?.height ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(200)
    await shot(page, 'fix-csv-table-default.png', false)
    console.log('[render-03] console 证据：\n' + consoleEvidence(cap))
  })

  test('render-03b：.csv 默认链不再命中 code-editor（F3 修复验证：Monaco 不抢占默认）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'data.csv')
    // 修复前佐证（保留于 render-03b-csv-default-code-editor-FINDING.png）：默认命中 code-editor。
    // 修复后：csv-table 为默认，Monaco 不再出现在默认打开链。
    await expect(page.locator('.mmagic-csv-table')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.monaco-editor')).toHaveCount(0)
    await shot(page, 'fix-csv-default-not-monaco.png', false)
    console.log('[render-03b] 修复验证：.csv 默认命中 csv-table，code-editor 不再抢占默认')
    console.log('[render-03b] console 证据：\n' + consoleEvidence(cap))
  })

  test('render-04：.txt → Monaco 编辑器（只读预览，内容一致，舞台尺寸达标）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'notes.txt')
    const monaco = page.locator('.monaco-editor')
    await expect(monaco).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.view-lines')).toContainText('hello mmagic')
    // F5（优化建议 C1）：.ws__preview-host 恒定尺寸防回归断言——Monaco 实测可视（boundingBox>200px）。
    // 修复前佐证（render-04b/04c-*-FINDING.png）：容器塌陷 5×5px、预览视觉空白。
    await expect.poll(async () => (await monaco.boundingBox())?.width ?? 0, { timeout: 10_000 }).toBeGreaterThan(200)
    await expect.poll(async () => (await monaco.boundingBox())?.height ?? 0, { timeout: 10_000 }).toBeGreaterThan(200)
    await shot(page, 'fix-monaco-stage-size.png', false)
    console.log('[render-04] console 证据：\n' + consoleEvidence(cap))
  })

  test('render-05：.mp4 → <video controls>（媒体在恒定舞台内可视）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'demo.mp4')
    const video = page.locator('.ws__preview-host video')
    await expect(video).toBeVisible()
    expect(await video.getAttribute('controls')).not.toBeNull()
    // F5：媒体渲染器在恒定舞台内可视（宽度撑满、>200px）
    await expect.poll(async () => (await video.boundingBox())?.width ?? 0, { timeout: 10_000 }).toBeGreaterThan(200)
    await shot(page, 'render-05-video-pass.png')
    console.log('[render-05] console 证据：\n' + consoleEvidence(cap))
  })

  test('render-06：未匹配类型 .xyz → fallback 下载提示（含下载按钮）', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'blob.xyz')
    const fallback = page.locator('.mmf-preview-fallback')
    await expect(fallback).toBeVisible()
    await expect(fallback).toContainText('暂无支持该类型的应用')
    await expect(fallback.locator('button', { hasText: '下载文件' })).toBeVisible()
    await shot(page, 'render-06-fallback-download-pass.png')
    console.log('[render-06] console 证据：\n' + consoleEvidence(cap))
  })

  test('render-07：渲染取流 GET 500 → per-tab 错误边界（标题+信息+重试+下载），不崩工作台', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await openWorkspace(page)
    // 让 guide.md 的 GET 失败（进入 docs 后双击打开）
    state.failGetKey['sessions/test/docs/guide.md'] = 500
    await page.locator('[data-testid="dir-name"]', { hasText: 'docs' }).click()
    await expect(page.locator('[data-testid="row"]', { hasText: 'guide.md' })).toBeVisible()
    await page.locator('[data-testid="row"]', { hasText: 'guide.md' }).dblclick() // Lane F5：双击=打开预览
    // 缺口 7 契约（preview.ts per-tab 错误边界）：渲染失败降级错误节点（标题+信息+重试+下载门控），
    // 不崩工作台。旧口径（toast 经 unhandledrejection 全局兜底）已被错误边界取代。
    const errNode = page.locator('.mmf-preview-error')
    await expect(errNode).toBeVisible({ timeout: 15_000 })
    await expect(errNode).toContainText('应用渲染失败')
    await expect(errNode.locator('button', { hasText: '重试' })).toBeVisible()
    await expect(errNode.locator('button', { hasText: '下载文件' })).toBeVisible()
    // 工作台不崩：树仍在、可继续交互
    await expect(page.locator('[data-testid="row"]', { hasText: 'guide.md' })).toBeVisible()
    await shot(page, 'render-07-render-error-boundary-pass.png')
    console.log('[render-07] console 证据：\n' + consoleEvidence(cap))
  })
})
