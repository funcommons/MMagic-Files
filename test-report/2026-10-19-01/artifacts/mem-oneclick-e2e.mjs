/**
 * 一键直达 E2E：①不点「装载」，从未装载态直接点⑤「加载」→ 自动装载 + registerApp（md 未勾选）
 * + uploadFiles + md 编辑器打开；②已装载态再点「加载」→ 日志出现「先卸载旧会话」→ 重装后再次打开。
 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
fs.writeFileSync('/tmp/mem-demo.md', '# 一键直达验证\n\n未装载直接点加载，应自动装载并动态初始化 md 插件。\n')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 80)))
await page.goto('http://localhost:5200/embed/file')
await page.waitForTimeout(1500)

const sec = page.locator('.fc-section').filter({ hasText: '内存文件' })

// 前置（未装载）：选「编辑」模式 → 应用下拉 catalog 可选 → 选 Markdown 编辑
// （el-select 自动化交互已知不稳：点完校验选中态，未生效重试）
await sec.getByText('编辑', { exact: true }).first().click()
await page.waitForTimeout(400)
let optCount = 0
let appPicked = false
for (let i = 0; i < 3 && !appPicked; i++) {
  await sec.locator('.el-select, [class*="select"]').first().click()
  await page.waitForTimeout(500)
  optCount = await page.locator('.el-select-dropdown__item:visible').count()
  await page.locator('.el-select-dropdown__item:visible', { hasText: 'Markdown 编辑' }).first().click()
  await page.waitForTimeout(400)
  const sel = await sec.locator('.el-select, [class*="select"]').first().textContent()
  appPicked = !!sel && sel.includes('Markdown 编辑')
}
console.log('APP_PICKED =', JSON.stringify({ optCount, appPicked }))

// 取消勾选 md 插件（走 registerApp 动态初始化路径）
await page.locator('.el-checkbox').filter({ hasText: 'Markdown 编辑' }).first().scrollIntoViewIfNeeded()
await page.locator('.el-checkbox').filter({ hasText: 'Markdown 编辑' }).first().click()
await page.waitForTimeout(300)

// 选文件（仍未装载）
await sec.locator('input[type="file"]').first().setInputFiles('/tmp/mem-demo.md')
await page.waitForTimeout(500)

const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
async function mdOpen() {
  const f = af()
  if (!f) return false
  return f.evaluate(() => !!document.querySelector('.mm-md-root, .mm-md-preview, .mm-md-source')).catch(() => false)
}
async function waitFor(pred, timeout = 30_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await pred()) return true
    await page.waitForTimeout(500)
  }
  return false
}
const logText = () => page.locator('body').textContent().catch(() => '')

// ① 一键加载（第一击：idle → 自动装载）
const loadBtn = sec.getByRole('button', { name: /加载/ })
const disabledBefore = await loadBtn.isDisabled()
await loadBtn.click()
const opened1 = await waitFor(mdOpen)
await page.waitForTimeout(1200)
let text1 = await logText()
const reg1 = (text1.match(/registerApp ✓/g) ?? []).length
const up1 = (text1.match(/uploadFiles ✓/g) ?? []).length
const remountLog1 = text1.includes('先卸载旧会话')
console.log('CLICK1 =', JSON.stringify({ disabledBefore, opened1, reg1, up1, remountLog1 }))

// ② 已装载态再点「加载」→ 先卸载重装 → 再次打开
await loadBtn.click()
const opened2 = await waitFor(mdOpen)
await page.waitForTimeout(1500)
const text2 = await logText()
const reg2 = (text2.match(/registerApp ✓/g) ?? []).length
const up2 = (text2.match(/uploadFiles ✓/g) ?? []).length
const remountLog2 = text2.includes('先卸载旧会话')
console.log('CLICK2 =', JSON.stringify({ opened2, reg2, up2, remountLog2 }))

const a = []
if (!appPicked) a.push('app selection did not stick (el-select)')
if (disabledBefore) a.push('load button disabled before mount (expected enabled)')
if (optCount < 3) a.push('unmounted dropdown options < 3: ' + optCount)
if (!opened1) a.push('click1: md editor did not open')
if (reg1 < 1) a.push('click1: registerApp not called')
if (up1 < 1) a.push('click1: uploadFiles not ok')
if (remountLog1) a.push('click1: unexpected unmount-log on idle first click')
if (!opened2) a.push('click2: md editor did not reopen after remount')
if (reg2 < 2) a.push('click2: registerApp total < 2 (fresh session must re-register)')
if (up2 < 2) a.push('click2: uploadFiles total < 2')
if (!remountLog2) a.push('click2: missing 「先卸载旧会话」log')
if (errors.length) a.push('pageerror: ' + errors.join(' | '))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
console.log('ERRORS =', JSON.stringify(errors))
await page.screenshot({ path: '/tmp/mem-oneclick.png' })
await browser.close()
