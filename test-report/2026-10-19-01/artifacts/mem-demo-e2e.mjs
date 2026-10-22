/**
 * 内存文件独立区 E2E（file 模式）：选 md → getApps 拉应用 → 编辑模式（md 编辑器）→
 * 参数 {"initialMode":"preview"} → 加载 → md 插件以预览形态打开（渲染出 h1，非源码）
 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
fs.writeFileSync('/tmp/mem-demo.md', '# 内存文件演示\n\ninitialMode=preview 应直接渲染本标题。\n')
fs.writeFileSync('/tmp/mem-demo.docx', 'fake docx')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 80)))
await page.goto('http://localhost:5200/embed/file')
await page.waitForTimeout(1500)
await page.getByRole('button', { name: /装载|挂载|Mount/i }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(5000)
// ① 选文件（独立区）
await page.locator('input[ref="memDemoInput"], label:has(.section-title:text("内存文件")) input[type="file"]').first().setInputFiles('/tmp/mem-demo.md').catch(async () => {
  // ref 选择器 fallback：独立区 section 内的 file input
  await page.locator('.fc-section').filter({ hasText: '内存文件' }).locator('input[type="file"]').first().setInputFiles('/tmp/mem-demo.md')
})
await page.waitForTimeout(1500)
// ② 应用下拉（getApps 已拉）
const appOptions = await page.locator('.fc-section').filter({ hasText: '内存文件' }).locator('.el-select, [class*="select"]').first().textContent().catch(() => '')
// ③ 切「编辑」模式
await page.locator('.fc-section').filter({ hasText: '内存文件' }).getByText('编辑', { exact: true }).first().click()
await page.waitForTimeout(600)
// ②b 下拉选 markdown-editor（编辑过滤集含 code-editor/markdown-editor，首项是 code-editor——须显式选）
await page.locator('.fc-section').filter({ hasText: '内存文件' }).locator('.el-select, [class*="select"]').first().click()
await page.waitForTimeout(500)
await page.frames().find((f) => f.url().startsWith('http://localhost:5199')) // noop 保帧引用
const opt = page.locator('.el-select-dropdown__item', { hasText: 'markdown-editor' }).last()
await opt.click()
await page.waitForTimeout(400)
// ④ 参数
await page.locator('.fc-section').filter({ hasText: '内存文件' }).locator('input[placeholder*="initialMode"]').fill('{"initialMode":"preview"}')
// ⑤ 加载
await page.locator('.fc-section').filter({ hasText: '内存文件' }).getByRole('button', { name: /加载/ }).click()
await page.waitForTimeout(6000)
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
const out = await page.locator('.fc-section').filter({ hasText: '内存文件' }).evaluate((sec) => {
  const sel = sec.querySelector('[class*="select"] input, [class*="select"] [class*="placeholder"]')
  const ph = (t) => (t.match(/无命中的应用|未选文件/) ?? [])[0] ?? ''
  const placeholder = sel ? (sel.value || ph(sec.textContent)) : ph(sec.textContent)
  const seg = sec.querySelector('[class*="segmented"], .el-radio-group')?.getBoundingClientRect()
  const label3 = [...sec.querySelectorAll('span')].find((x) => x.textContent?.trim().startsWith('3'))
  const l3 = label3?.getBoundingClientRect()
  return { placeholder, segY: seg ? Math.round(seg.y) : null, label3Y: l3 ? Math.round(l3.y) : null, sameRow: seg && l3 ? Math.abs(seg.y - l3.y) < 20 : null }
})
const appVal = await page.frames().find((f) => f.url().startsWith('http://localhost:5199'))?.evaluate(() => {
  const mdPrev = document.querySelector('.mm-md-preview h1, .mm-md-preview h2')
  return mdPrev ? `md-editor-preview:${mdPrev.textContent?.slice(0, 12)}` : 'other'
})
const a = []
if (!appVal.startsWith('md-editor-preview')) a.push('md editor preview form missing: ' + appVal)
if ((out.placeholder ?? '') === '') a.push('placeholder empty')
if (out.sameRow === false) a.push('mode row wrapped')
console.log('OUT =', JSON.stringify(out).slice(0, 500))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
console.log('ERRORS =', JSON.stringify(errors))
await page.screenshot({ path: '/tmp/mem-demo.png' })
await browser.close()
