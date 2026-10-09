/**
 * 业务线 10 —— 插件失败路径：不可达 CDN / SRI 不符 → error 事件 4201 + 预览降级，不崩工作台。
 * 期望（动态插件方案 V1.1 §四）：加载失败走 error(4201)，工作台不崩；未匹配文件仍走 fallback。
 */
import { test, expect } from '@playwright/test'
import { hostConfigUrl, workspaceConfig } from './fixtures/config'
import { abortHost, installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import { attachConsole, consoleEvidence, findEvent, shot } from './fixtures/host'

const floc = (page: import('@playwright/test').Page) => page.frameLocator('#mmf')

test.describe('业务线10：插件失败路径', () => {
  test('plug-01：不可达插件 URL → 打开未匹配文件触发 ensureApps → error(4201) + fallback', async ({ page }) => {
    const cap = attachConsole(page)
    await installS3Mock(page, { seed: defaultSeed() })
    await abortHost(page, 'unreachable.mock')
    await page.goto(
      hostConfigUrl(
        workspaceConfig({
          plugins: [{ url: 'https://unreachable.mock/x.js', sri: 'sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', lazy: true }],
        }),
      ),
    )
    const frame = floc(page)
    await frame.locator('[data-testid="row"]').first().waitFor({ timeout: 30_000 })

    // 打开未匹配类型 → registry 未命中 → ensureApps → 插件加载失败
    await frame.locator('[data-testid="row"]', { hasText: 'blob.xyz' }).dblclick()
    const evt = await findEvent(page, 'error', 20000)
    expect(evt.payload).toMatchObject({ code: 4201 })
    // 工作台不崩：fallback 下载提示仍在
    await expect(frame.locator('.mmf-preview-fallback')).toBeVisible()
    await expect(frame.locator('[data-testid="row"]').first()).toBeVisible()
    await shot(page, 'plug-01-unreachable-plugin-4201-pass.png')
    console.log('[plug-01] error 事件 payload=' + JSON.stringify(evt.payload))
    console.log('[plug-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('plug-02：SRI 校验不符 → error(4201)，插件未注册', async ({ page }) => {
    const cap = attachConsole(page)
    const state = await installS3Mock(page, { seed: defaultSeed() })
    // 插件 CDN（可拉取但内容与 SRI 不符）
    const PLUGIN_JS = 'export function activate(sdk) { sdk.registerApp({ id: "evil-app", matcher: { ext: ["xyz"] }, renderer: () => {} }) }\n'
    await page.route((url) => url.hostname === 'sri.mock.local', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: PLUGIN_JS }),
    )
    await page.goto(
      hostConfigUrl(
        workspaceConfig({
          plugins: [{ url: 'https://sri.mock.local/plugin.js', sri: 'sha384-not-the-real-hash', lazy: true }],
        }),
      ),
    )
    const frame = floc(page)
    await frame.locator('[data-testid="row"]').first().waitFor({ timeout: 30_000 })

    await frame.locator('[data-testid="row"]', { hasText: 'blob.xyz' }).dblclick()
    const evt = await findEvent(page, 'error', 20000)
    expect(evt.payload).toMatchObject({ code: 4201 })
    // SRI 失败 → 插件未注册 → .xyz 仍走 fallback
    await expect(frame.locator('.mmf-preview-fallback')).toBeVisible()
    expect(state.getRequests.filter((k) => k.includes('plugin.js'))).toHaveLength(0) // 未走 S3
    await shot(page, 'plug-02-sri-mismatch-4201-pass.png')
    console.log('[plug-02] error 事件 payload=' + JSON.stringify(evt.payload))
    console.log('[plug-02] console 证据：\n' + consoleEvidence(cap))
  })
})
