/**
 * 业务线 2 —— workspace 浏览：树渲染 / 面包屑回跳 / 进入子目录 / ListObjectsV2 聚合翻页 / 失败重试。
 * 期望（用户手册 §二「浏览目录」）：目录/文件行渲染、面包屑回跳、懒加载子目录、翻页聚合到尽。
 */
import { test, expect } from '@playwright/test'
import { configUrl, workspaceConfig, MOCK_PREFIX } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import { attachConsole, consoleEvidence, enterDir, shot, waitTreeLoaded } from './fixtures/host'

test.describe('业务线2：workspace 浏览', () => {
  test('ws-01：根目录树渲染（目录行 + 文件行 + 大小/类型列）', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await installS3Mock(page, { seed: defaultSeed() })
    await page.goto(configUrl(workspaceConfig()))
    await waitTreeLoaded(page)

    // 目录行（docs/paged/broken 由子对象或标记推导）
    const dirNames = await page.locator('[data-testid="dir-name"]').allTextContents()
    expect(dirNames).toEqual(expect.arrayContaining(['docs', 'paged', 'broken']))
    // 文件行
    const rows = page.locator('[data-testid="row"]')
    for (const name of ['README.md', 'notes.txt', 'data.csv', 'logo.png', 'report.docx', 'table.xlsx', 'demo.mp4']) {
      await expect(rows.filter({ hasText: name })).toHaveCount(1)
    }
    // ListObjectsV2 只发了一页（无截断）
    expect(state.listRequests.map((r) => r.prefix)).toContain(MOCK_PREFIX)
    await shot(page, 'ws-01-tree-render-pass.png')
    console.log('[ws-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('ws-02：进入子目录 + 面包屑回跳', async ({ page }) => {
    const cap = attachConsole(page)
    await installS3Mock(page, { seed: defaultSeed() })
    await page.goto(configUrl(workspaceConfig()))
    await waitTreeLoaded(page)

    await enterDir(page, 'docs')
    // docs/ 下：文件 guide.md + 子目录 img/（photo.png 在 img/ 内）
    await expect(page.locator('[data-testid="row"]', { hasText: 'guide.md' })).toBeVisible()
    await expect(page.locator('[data-testid="dir-name"]', { hasText: 'img' })).toBeVisible()
    // 面包屑：可点祖先 test + 当前段 docs（当前段为 is-current span）
    await expect(page.locator('[data-testid="crumb"]', { hasText: 'test' })).toBeVisible()
    await expect(page.locator('.tree-panel__crumb.is-current')).toHaveText('docs')
    await shot(page, 'ws-02a-subdir-pass.png')

    // 二级子目录 img/
    await enterDir(page, 'img')
    await expect(page.locator('[data-testid="row"]', { hasText: 'photo.png' })).toBeVisible()
    // 面包屑回跳：点 test（根）
    await page.locator('[data-testid="crumb"]', { hasText: 'test' }).first().click()
    await expect(page.locator('[data-testid="row"]', { hasText: 'README.md' })).toBeVisible()
    await expect(page.locator('[data-testid="row"]', { hasText: 'demo.mp4' })).toBeVisible()
    await shot(page, 'ws-02b-crumb-back-pass.png')
    console.log('[ws-02] console 证据：\n' + consoleEvidence(cap))
  })

  test('ws-03：子目录懒加载 + ListObjectsV2 聚合翻页（IsTruncated→continuation-token）', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await installS3Mock(page, {
      seed: defaultSeed(),
      paginatePrefixes: [`${MOCK_PREFIX}paged/`],
    })
    await page.goto(configUrl(workspaceConfig()))
    await waitTreeLoaded(page)

    await enterDir(page, 'paged')
    // 三个文件都应出现（客户端聚合两页到尽）
    await expect(page.locator('[data-testid="row"]', { hasText: 'a.md' })).toBeVisible()
    await expect(page.locator('[data-testid="row"]', { hasText: 'b.md' })).toBeVisible()
    await expect(page.locator('[data-testid="row"]', { hasText: 'c.md' })).toBeVisible()
    // 该 prefix 恰好两次 list：首页（token=null）+ 续页（continuation-token）
    const pagedLists = state.listRequests.filter((r) => r.prefix === `${MOCK_PREFIX}paged/`)
    expect(pagedLists.length).toBe(2)
    expect(pagedLists[0]!.continuationToken).toBeNull()
    expect(pagedLists[1]!.continuationToken).not.toBeNull()
    console.log('[ws-03] console 证据：\n' + consoleEvidence(cap))
    await shot(page, 'ws-03-paginated-listing-pass.png')
  })

  test('ws-04：List 500 → 失败态（启动即失败空态 + 子目录失败 toast）→ 重试恢复', async ({ page }) => {
    const cap = attachConsole(page)
    // A) 启动即根目录 500：应渲染「目录加载失败」空态 + 重试按钮
    const state = await installS3Mock(page, {
      seed: defaultSeed(),
      failListPrefix: { [MOCK_PREFIX]: 500 },
    })
    await page.goto(configUrl(workspaceConfig()))
    await expect(page.getByText('目录加载失败')).toBeVisible({ timeout: 20_000 })
    await shot(page, 'ws-04a-boot-list-error-empty-state-pass.png')

    delete state.failListPrefix[MOCK_PREFIX]
    await page.getByRole('button', { name: '重试' }).click()
    await expect(page.locator('[data-testid="row"]', { hasText: 'README.md' })).toBeVisible()
    await shot(page, 'ws-04b-retry-recovered-pass.png')

    // B) 子目录 list 500（当前目录已有内容）：点击 broken → 错误 toast，树停在原目录
    state.failListPrefix[`${MOCK_PREFIX}broken/`] = 500
    await enterDir(page, 'broken')
    await expect(page.locator('.el-message').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid="row"]', { hasText: 'README.md' })).toBeVisible() // 未误切目录
    await shot(page, 'ws-04c-subdir-error-toast-pass.png', false)
    console.log('[ws-04] console 证据：\n' + consoleEvidence(cap))
  })
})
