/**
 * 独立区升级 E2E：①未装载也可选应用（catalog 静态清单）②装载插件可选（取消勾选 md）③
 * 加载时动态 registerApp 初始化（协议日志 registerApp ✓ + md 编辑器 DOM 出现）
 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
fs.writeFileSync('/tmp/mem-demo.md', '# 动态初始化验证\n\n取消勾选 md 插件后加载，应经 registerApp 动态载入。\n')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 80)))
await page.goto('http://localhost:5200/embed/file')
await page.waitForTimeout(1500)

// ① 未装载时：独立区应用下拉应可选（catalog 静态清单）——切「编辑」模式 → 选 Markdown 编辑
const sec = page.locator('.fc-section').filter({ hasText: '内存文件' })
await sec.getByText('编辑', { exact: true }).first().click()
await page.waitForTimeout(400)
await sec.locator('.el-select, [class*="select"]').first().click()
await page.waitForTimeout(500)
const optCount = await page.locator('.el-select-dropdown__item:visible').count()
await page.locator('.el-select-dropdown__item:visible', { hasText: 'Markdown 编辑' }).first().click()
await page.waitForTimeout(300)
console.log('UNMOUNTED_PICK =', JSON.stringify({ optCount }))

// ② 取消勾选 md 插件 → 装载（启动不带 md 插件）
await page.locator('.el-checkbox').filter({ hasText: 'Markdown 编辑' }).first().scrollIntoViewIfNeeded()
await page.locator('.el-checkbox').filter({ hasText: 'Markdown 编辑' }).first().click()
await page.getByRole('button', { name: /装载|挂载|Mount/i }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(5000)

// ②b 装载后选文件（独立区 input——memDemo.file 在此才真正赋值）
await sec.locator('input[type="file"]').first().setInputFiles('/tmp/mem-demo.md')
await page.waitForTimeout(1000)

// ③ 编辑模式确认 + 重选 markdown-editor（edit 过滤集首项是 code-editor）+ 加载
await sec.getByText('编辑', { exact: true }).first().click()
await page.waitForTimeout(400)
await sec.locator('.el-select, [class*="select"]').first().click()
await page.waitForTimeout(500)
await page.locator('.el-select-dropdown__item:visible', { hasText: 'Markdown 编辑' }).first().click()
await page.waitForTimeout(400)
await sec.getByRole('button', { name: /加载/ }).click()
await page.waitForTimeout(900)
const toastEarly = (await page.locator('body').textContent().catch(() => ''))?.match(/请先[^，。]{0,30}|失败[^\n]{0,60}|✓[^\n]{0,60}/g) ?? []
await page.waitForTimeout(6500)
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
const out = await af().evaluate(() => ({
  mdDom: !!document.querySelector('.mm-md-root, .mm-md-preview, .mm-md-source'),
  cm: !!document.querySelector('.cm-editor, .CodeMirror'),
}))
const logText = await page.locator('body').textContent()
const regOk = (logText ?? '').includes('registerApp ✓')
const logLines = (logText ?? '').match(/(registerApp|uploadFiles|getApps)[^\n]{0,140}/g) ?? []
globalThis.LOG = logLines.slice(-6)
const a = []
if (optCount < 3) a.push('unmounted dropdown options < 3: ' + optCount)
if (optCount < 3) a.push('unmounted dropdown options < 3 (round2)')
if (!regOk) a.push('registerApp not called')
if (!out.mdDom) a.push('md editor dom missing')
console.log('OUT =', JSON.stringify(out))
console.log('LOGLINES =', JSON.stringify(globalThis.LOG ?? logLines ?? null))
console.log('registerApp ✓ =', regOk)
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
console.log('TOAST_EARLY =', JSON.stringify(toastEarly))
console.log('ERRORS =', JSON.stringify(errors))
await page.screenshot({ path: '/tmp/mem-standalone.png' })
await browser.close()
