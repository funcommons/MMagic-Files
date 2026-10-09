/**
 * 业务线 6 —— 会话到期：ttlSeconds=5 → SessionBanner 整屏到期终态 + expired 事件；
 * 到期后 JSSDK 命令被拒（5000 SESSION_EXPIRED）。
 * 期望（用户手册 §三 / JSSDK §三）：到期前端自毁 + expired 事件 + 终态后任何 cmd 拒绝。
 */
import { test, expect } from '@playwright/test'
import { hostConfigUrl, workspaceConfig } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import { attachConsole, consoleEvidence, findEvent, sendCommand, shot } from './fixtures/host'

test.describe('业务线6：会话到期', () => {
  test('sess-01：ttl=5s → 到期整屏遮罩 + expired(ttl) 事件', async ({ page }) => {
    test.setTimeout(60_000)
    const cap = attachConsole(page)
    await installS3Mock(page, { seed: defaultSeed() })
    await page.goto(hostConfigUrl(workspaceConfig({ backend: { ttlSeconds: 5 } })))
    const frame = page.frameLocator('#mmf')
    await frame.locator('[data-testid="row"]').first().waitFor({ timeout: 30_000 })

    // 到期遮罩（SessionBanner 500ms 轮询 → ≤5.5s 内出现）
    await expect(frame.locator('[data-testid="expired-mask"]')).toBeVisible({ timeout: 15_000 })
    await expect(frame.locator('[data-testid="expired-mask"]')).toContainText('会话已结束')

    // 宿主应收到 expired 事件（reason=ttl）
    const evt = await findEvent(page, 'expired', 8000)
    expect(evt.payload).toMatchObject({ reason: 'ttl' })
    await shot(page, 'sess-01-expired-mask-pass.png')
    console.log('[sess-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('sess-02：到期后 navigate 命令 → reply ok=false code=5000（F4 修复验证：契约 §七终态回包）', async ({ page }) => {
    test.setTimeout(60_000)
    const cap = attachConsole(page)
    const state = await installS3Mock(page, { seed: defaultSeed() })
    await page.goto(hostConfigUrl(workspaceConfig({ backend: { ttlSeconds: 5 } })))
    const frame = page.frameLocator('#mmf')
    await frame.locator('[data-testid="row"]').first().waitFor({ timeout: 30_000 })
    await expect(frame.locator('[data-testid="expired-mask"]')).toBeVisible({ timeout: 15_000 })

    // 《JSSDK 接口文档》§七：SESSION_EXPIRED 5000=「会话已终态后的任何 cmd」。
    // F4 修复后：onExpire 不再 bus.destroy()（监听与 handler 表保留），后续 cmd 由
    // guardTerminal 拒绝并回包 5000。修复前佐证（sess-02-cmd-no-reply-after-expiry-pass.png）：
    // 通道已销毁，宿主收不到任何 reply（harness 超时 code=-1）。
    const listsBefore = state.listRequests.length
    const reply = await sendCommand(page, 'navigate', { path: 'docs/' }, 6000)
    console.log('[sess-02] navigate reply=' + JSON.stringify(reply))
    expect(reply.ok).toBe(false)
    expect(reply.timeout).toBeUndefined() // 有回包（非 harness 超时）
    expect(reply.code).toBe(5000)
    // 操作确实未被执行（无新增 S3 list 调用）——「拒绝执行 + 错误码回包」语义完整
    expect(state.listRequests.length).toBe(listsBefore)
    await shot(page, 'fix-expired-cmd-5000.png')
    console.log('[sess-02] 修复验证：到期后 cmd 收 5000 reply（契约 §七）')
    console.log('[sess-02] console 证据：\n' + consoleEvidence(cap))
  })
})
