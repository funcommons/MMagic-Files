/**
 * 业务线 9 —— office 预览：docx（非法 zip → 降级提示）+ xlsx（真实 SheetJS zip → 表格/sheet 标签）。
 * 期望（用户手册 §二）：docx/xlsx 预览（v1）；损坏文件应有可控降级而非白屏/崩溃。
 */
import * as XLSX from 'xlsx'
import { test, expect } from '@playwright/test'
import { configUrl, workspaceConfig } from './fixtures/config'
import { installS3Mock } from './fixtures/s3-mock'
import { defaultSeed } from './fixtures/seed'
import { attachConsole, consoleEvidence, openRow, shot, waitTreeLoaded } from './fixtures/host'

/** SheetJS 生成真实 xlsx 字节（两个 sheet） */
function buildXlsx(): Buffer {
  const wb = XLSX.utils.book_new()
  const ws1 = XLSX.utils.aoa_to_sheet([
    ['姓名', '年龄', '城市'],
    ['Alice', 30, '北京'],
    ['Bob', 25, '上海'],
  ])
  XLSX.utils.book_append_sheet(wb, ws1, 'Sheet1')
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['项目', '状态'],
    ['E2E 回归', '进行中'],
  ])
  XLSX.utils.book_append_sheet(wb, ws2, '数据')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer
}

async function openWorkspace(page: import('@playwright/test').Page, extraSeed: Record<string, { bytes: Buffer | string; contentType: string }> = {}) {
  const state = await installS3Mock(page, { seed: { ...defaultSeed(), ...extraSeed } })
  await page.goto(configUrl(workspaceConfig()))
  await waitTreeLoaded(page)
  return state
}

test.describe('业务线9：office 预览', () => {
  test('office-01：docx 非法 zip → 可控降级提示（docx-load-fail），不崩溃', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page)
    await openRow(page, 'report.docx')
    const failTip = page.locator('.docx-load-fail')
    await expect(failTip).toBeVisible({ timeout: 30_000 })
    // 提示文案非空（i18n 键或词典文案均可，但不能是裸键崩溃）
    const tipText = (await failTip.textContent()) ?? ''
    expect(tipText.trim().length).toBeGreaterThan(0)
    console.log(`[office-01] 降级提示文案="${tipText.trim()}"`)
    await shot(page, 'office-01-docx-invalid-zip-pass.png')
    console.log('[office-01] console 证据：\n' + consoleEvidence(cap))
  })

  test('office-02：xlsx 真实 zip → 表格渲染 + sheet 标签切换', async ({ page }) => {
    const cap = attachConsole(page)
    await openWorkspace(page, {
      'sessions/test/table.xlsx': {
        bytes: buildXlsx(),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    })
    await openRow(page, 'table.xlsx')
    const view = page.locator('.xlsx-view')
    await expect(view).toBeVisible({ timeout: 30_000 })
    // sheet 标签
    const tabs = page.locator('.xlsx-tab')
    await expect(tabs).toHaveCount(2)
    // 表格内容（Sheet1）
    await expect(page.locator('.xlsx-table')).toContainText('Alice')
    await shot(page, 'office-02a-xlsx-table-pass.png')
    // 切到第二个 sheet
    await page.locator('.xlsx-tab', { hasText: '数据' }).click()
    await expect(page.locator('.xlsx-table')).toContainText('E2E 回归')
    await shot(page, 'office-02b-xlsx-sheet-switch-pass.png')
    console.log('[office-02] console 证据：\n' + consoleEvidence(cap))
  })
})
