/**
 * 业务线 8 —— 单文件模式（#file=）：只读（无 save 段）与可写（有 save 段）。
 * 期望（用户手册 §一形态 B）：只读=预览应用渲染；可写=编辑类应用可用。名称取 name 或 URL 末段。
 */
import { test, expect } from '@playwright/test'
import { hostFileUrl, singleFileConfig, MOCK_ENDPOINT, MOCK_BUCKET } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed, README_KEY } from './fixtures/seed'
import { attachConsole, consoleEvidence, shot } from './fixtures/host'

const SOURCE_URL = `${MOCK_ENDPOINT}/${MOCK_BUCKET}/${README_KEY}`

test.describe('业务线8：单文件模式（#file）', () => {
  test('file-01：只读 #file（无 save）→ 名称/「只读」标记 + 预览应用渲染源内容（F2 修复验证）', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await installS3Mock(page, { seed: defaultSeed() })
    await page.goto(hostFileUrl(singleFileConfig(SOURCE_URL)))
    const frame = page.frameLocator('#mmf')
    await expect(frame.locator('.home-hero__title')).toContainText('README.md')
    await expect(frame.getByText('只读')).toBeVisible()

    // F2 修复后契约（手册 §一形态 B「只读=预览应用渲染」）：#file 组装 urlDataSource+registry，
    // 按 name 解析默认应用（.md→markdown-renderer）拉取并渲染源内容。
    // 修复前佐证（file-01-readonly-plaintext-FINDING.png）：仅占位卡，源对象 GET 次数=0。
    const got = state.getRequests.filter((k) => k === README_KEY)
    console.log(`[file-01] 只读 #file 打开后源对象 GET 次数=${got.length}`)
    expect(got.length, '单文件只读模式应拉取并渲染 source 内容（用户手册「预览应用渲染」）').toBeGreaterThan(0)
    const stage = frame.locator('.ws__preview-host')
    await expect(stage.locator('h1')).toContainText('欢迎使用 mmagix-files', { timeout: 30_000 })
    await shot(page, 'fix-single-file-readonly-preview.png')
    console.log('[file-01] 修复验证：只读 #file 由 markdown-renderer 渲染源内容（GET>0 且 DOM 可见）')
    console.log('[file-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('file-02：可写 #file（含 save 段）→ 「可编辑」标记', async ({ page }) => {
    const cap = attachConsole(page)
    await installS3Mock(page, { seed: defaultSeed() })
    await page.goto(
      hostFileUrl(
        singleFileConfig(SOURCE_URL, {
          save: { method: 'PUT', url: `${MOCK_ENDPOINT}/${MOCK_BUCKET}/${README_KEY}` },
        }),
      ),
    )
    const frame = page.frameLocator('#mmf')
    await expect(frame.locator('.home-hero__title')).toContainText('README.md')
    await expect(frame.getByText('可编辑')).toBeVisible()
    await shot(page, 'file-02-editable-tag-pass.png')
    console.log('[file-02] console 证据：\n' + consoleEvidence(cap))
  })
})
