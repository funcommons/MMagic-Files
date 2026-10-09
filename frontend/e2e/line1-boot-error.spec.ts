/**
 * 业务线 1 —— boot 错误态（无 fragment / 坏 JSON / 版本不支持）。
 * 期望（契约 §4.1 + Home.vue ①）：错误卡渲染，code=4001，detail 可见。
 */
import { test, expect } from '@playwright/test'
import { workspaceConfig, configUrl } from './fixtures/config'
import { attachConsole, consoleEvidence, shot } from './fixtures/host'

test.describe('业务线1：boot 错误态', () => {
  test('boot-01：URL 无 fragment → 配置错误卡渲染（code=4001）', async ({ page }) => {
    const cap = attachConsole(page)
    await page.goto('/')
    await expect(page.locator('.home-hero__title')).toContainText('配置解析失败')
    const subtitle = await page.locator('.home-hero__subtitle').textContent()
    expect(subtitle).toContain('code=4001')
    await shot(page, 'boot-01-no-fragment-pass.png')
    console.log('[boot-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('boot-02：#config 为坏 JSON → 4001 + JSON 解析失败 detail', async ({ page }) => {
    const cap = attachConsole(page)
    await page.goto('/#config=' + encodeURIComponent('{bad json,,'))
    await expect(page.locator('.home-hero__title')).toContainText('配置解析失败')
    const subtitle = await page.locator('.home-hero__subtitle').textContent()
    expect(subtitle).toContain('code=4001')
    await shot(page, 'boot-02-bad-json-pass.png')
    console.log('[boot-02] console 证据：\n' + consoleEvidence(cap))
  })

  test('boot-03：#config v=2（版本不支持）→ 4001 + 版本提示', async ({ page }) => {
    const cap = attachConsole(page)
    const cfg = workspaceConfig({ v: 2 })
    await page.goto(configUrl(cfg))
    await expect(page.locator('.home-hero__title')).toContainText('配置解析失败')
    const subtitle = await page.locator('.home-hero__subtitle').textContent()
    expect(subtitle).toContain('code=4001')
    expect(subtitle).toContain('版本')
    await shot(page, 'boot-03-version-unsupported-pass.png')
    console.log('[boot-03] console 证据：\n' + consoleEvidence(cap))
  })
})
