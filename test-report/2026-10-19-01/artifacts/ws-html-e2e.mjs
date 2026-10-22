/** 工作台 E2E：插件多选行（checkbox 样式）→ 上传 html → 打开方式 → html-editor 三态 + 保存钮居右图标 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
const MARK = 'WSHTML-VERIFY-8b2c'
fs.writeFileSync('/tmp/ws-page.html', `<!doctype html><html><head><meta charset="utf-8"><title>${MARK}</title></head><body><h1>${MARK}</h1><p><a href="https://example.com/x">外部链接</a></p></body></html>`)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)))
await page.goto('http://localhost:5200/embed/play')
await page.waitForTimeout(2000)
// 装载（默认全插件含 html）
await page.getByRole('button', { name: /装载/ }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(6000)
// ① 多选行样式断言（checkbox + HTML 编辑 + 装载插件 label）
const row = await page.evaluate(() => {
  const label = [...document.querySelectorAll('.el-form-item__label')].find((n) => (n.textContent ?? '').includes('装载插件'))
  const boxes = [...document.querySelectorAll('.el-checkbox')].map((c) => c.textContent?.trim() ?? '')
  return { hasLabel: !!label, boxes }
})
console.log('ROW =', JSON.stringify(row))
// ② 上传 html（宿主直传）
await page.locator('input[type="file"]').first().setInputFiles('/tmp/ws-page.html')
await page.waitForTimeout(800)
await page.getByRole('button', { name: /uploadFiles（files/ }).first().click()
await page.waitForTimeout(4000)
// ③ iframe 里右键 ws-page.html → 打开方式 → HTML 编辑
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
const f = af()
const node = f.locator('span, div').filter({ hasText: /^ws-page\.html$/ }).last()
await node.click({ button: 'right' })
await page.waitForTimeout(800)
// 右键菜单找「打开方式」（hover 出子菜单）
const openWith = f.locator('text=打开方式').first()
if (await openWith.isVisible().catch(() => false)) {
  await openWith.hover()
  await page.waitForTimeout(600)
  await f.locator('text=HTML 编辑').last().click()
} else {
  await page.keyboard.press('Escape')
  console.error('NO_OPENWITH_MENU')
}
await page.waitForTimeout(3000)
// ④ html-editor 三态 + 保存钮几何（右侧、仅图标）
const ed = await f.evaluate(() => {
  const root = document.querySelector('.mm-html-root')
  if (!root) return { opened: false }
  const save = document.querySelector('.mm-html-save')
  const bar = document.querySelector('.mm-html-toolbar')
  const sr = save?.getBoundingClientRect()
  const br = bar?.getBoundingClientRect()
  const modes = [...document.querySelectorAll('.mm-html-modes button')].map((b) => b.textContent?.trim())
  return {
    opened: true,
    modes,
    saveRight: sr && br ? Math.round(br.right - sr.right) : null,
    saveTextOnlyIcon: save?.textContent?.trim() === '',
    saveTitle: save?.getAttribute('title') ?? null,
    dirty: document.querySelector('.mm-html-badge')?.textContent ?? '',
  }
}).catch((e) => ({ err: String(e).slice(0, 120) }))
console.log('EDITOR =', JSON.stringify(ed, null, 1))
const a = []
if (!row.hasLabel) a.push('no 装载插件 label')
if (!row.boxes.some((b2) => b2.includes('HTML 编辑'))) a.push('no HTML 编辑 checkbox: ' + JSON.stringify(row.boxes))
if (!ed.opened) a.push('html-editor did not open in workspace')
if (ed.modes?.length !== 3) a.push('modes != 3: ' + JSON.stringify(ed.modes))
if (ed.saveTextOnlyIcon !== true) a.push('save button has text')
if ((ed.saveRight ?? 99) > 20) a.push('save not at right edge: ' + ed.saveRight) // 8(gap)+10(padding)=18 为正常右缘
if (errors.length) a.push('pageerror: ' + errors.join('|'))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/ws-html-e2e.png' })
await browser.close()
