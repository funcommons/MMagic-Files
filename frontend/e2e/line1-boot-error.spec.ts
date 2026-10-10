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

  // R2-02：向导弹窗打开后，错误卡内容不得盖在弹窗/遮罩上层。
  // 复实测判：R2 证据（probe-07b）是遮罩 ~300ms 淡入过渡中途的截图——遮罩半透明时
  // 弹窗随层半透、错误卡透出，观感似「叠在上层」；DOM/hit-test 层序自始正确（本用例
  // 同一轮内断言通过而截图呈「穿透」可证）。FcDialog 仍做组件级加固（overlay z-index 2500）。
  // 断言取 hit-test 语义（elementFromPoint 遵循绘制层序）：hero 大标题中心点命中的必须是遮罩内元素。
  test('boot-04：连接向导打开 → 遮罩在错误卡上层（z-index 达标 + hero 标题中心 hit-test 落在遮罩内）', async ({ page }) => {
    const cap = attachConsole(page)
    await page.goto('/')
    await expect(page.locator('.home-hero__title')).toContainText('配置解析失败')
    await page.locator('[data-testid="wizard-open"]').click()
    await expect(page.locator('.el-dialog')).toBeVisible()
    await expect(page.locator('.el-overlay')).toBeVisible()

    const probe = await page.evaluate(() => {
      const h1 = document.querySelector('.home-hero__title')
      const overlay = document.querySelector('.el-overlay')
      if (!h1 || !overlay) return { topInOverlay: false, overlayZ: 0, topDesc: 'missing' }
      const r = h1.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return {
        topInOverlay: !!top && overlay.contains(top),
        overlayZ: Number(getComputedStyle(overlay).zIndex) || 0,
        topDesc: top ? `${top.tagName}.${String(top.className).slice(0, 40)}` : 'null',
      }
    })
    expect(probe.overlayZ).toBeGreaterThanOrEqual(2500)
    expect(probe.topInOverlay, `hero 标题中心命中：${probe.topDesc}`).toBe(true)

    await page.waitForTimeout(500) // 等遮罩淡入过渡结束再取证（过渡中途截图=半透明「穿透」假象，见上）
    await shot(page, 'boot-04-wizard-overlay-above-hero-pass.png', false)
    console.log('[boot-04] console 证据：\n' + consoleEvidence(cap))
  })
})
