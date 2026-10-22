/** 格式化验证：json 打开（乱序紧凑源）→ 右键格式化 → 文本被规整；yml 点格式化 → 菜单关 + toast */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
fs.writeFileSync('/tmp/data.json', '{"b":2,"a":[1,{"c":3}]}')
fs.writeFileSync('/tmp/ws-demo-1792482250.yml', 'server:\n  port: 9000\n')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)))
await page.goto('http://localhost:5200/embed/play')
await page.waitForTimeout(2000)
await page.getByRole('button', { name: /装载/ }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
const rd = await page.waitForFunction(() => document.body.textContent?.includes('已就绪'), { timeout: 40000 }).then(() => true).catch(() => false)
if (!rd) {
  const st = await page.evaluate(() => (document.querySelector('.stage-head')?.textContent ?? '').slice(0, 80))
  console.error('MOUNT_STATUS =', st)
  await browser.close(); process.exit(1)
}
await page.waitForTimeout(2000)
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
const f = af()
// 直接打开桶内 data.json（json 语法、多行嵌套）
await f.locator('text=ws-messy-1792482250.json').first().dblclick()
await page.waitForTimeout(4000)
// 打开 json → 格式化
await f.locator('text=ws-messy-1792482250.json').first().dblclick()
await page.waitForTimeout(3500)
const edBox = await f.locator('.monaco-editor').boundingBox()
await page.mouse.click(edBox.x + 200, edBox.y + 60, { button: 'right' })
await page.waitForTimeout(400)
await f.locator('.mmagic-code-ctxmenu button', { hasText: '格式化' }).dispatchEvent('click')
let msgBox = ''
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(500)
  const st = await f.evaluate(() => ({
    lines: document.querySelectorAll('.monaco-editor .view-lines .view-line').length,
    msg: document.querySelector('.monaco-message-box')?.textContent?.slice(0, 80) ?? '',
  })).catch(() => ({ lines: -1, msg: '?' }))
  if (st.lines >= 4 || st.msg) { msgBox = st.msg; break }
}
console.error('POLL =', JSON.stringify({ msgBox }))
const jsonState = await f.evaluate(() => ({
  lines: document.querySelectorAll('.monaco-editor .view-lines .view-line').length,
  textHead: (document.querySelector('.monaco-editor .view-lines')?.textContent ?? '').slice(0, 60),
})).catch((e) => ({ err: String(e).slice(0, 100) }))
jsonState.formatted = jsonState.lines >= 4
const foldJson = await f.evaluate(() => ({
  glyphs: document.querySelectorAll('.monaco-editor .margin-view-overlays .cgmr').length,
  lines: document.querySelectorAll('.monaco-editor .view-lines .view-line').length,
})).catch(() => ({ err: 'x' }))
console.log('JSON_FOLD =', JSON.stringify(foldJson))
console.log('JSON =', JSON.stringify(jsonState))
// 打开 yml → 点格式化（置灰）→ 菜单消失 + toast
await f.locator('text=ws-demo-1792482250.yml').first().dblclick()
await page.waitForTimeout(3000)
const edBox2 = await f.locator('.monaco-editor').boundingBox()
await page.mouse.click(edBox2.x + 200, edBox2.y + 60, { button: 'right' })
await page.waitForTimeout(400)
const greyed = await f.evaluate(() => {
  const b = [...document.querySelectorAll('.mmagic-code-ctxmenu button')].find((x) => x.textContent === '格式化')
  return b?.getAttribute('aria-disabled') === 'true'
})
await f.locator('.mmagic-code-ctxmenu button', { hasText: '格式化' }).dispatchEvent('click')
await page.waitForTimeout(800)
const ymlState = await f.evaluate(() => ({
  menuGone: !document.querySelector('.mmagic-code-ctxmenu'),
  toast: [...document.querySelectorAll('.el-message')].map((n) => n.textContent?.trim()).join('|'),
})).catch((e) => ({ err: String(e).slice(0, 100) }))
console.log('GREYED =', greyed)
console.log('YML =', JSON.stringify(ymlState))
const a = []
if (!opened0(errors)) a.push('err: ' + errors.join('|'))
if (!jsonState.formatted) a.push('json not formatted: ' + JSON.stringify(jsonState))
if (!greyed) a.push('yml format not greyed')
if (!ymlState.menuGone) a.push('menu did not close on yml')
if (!String(ymlState.toast).includes('格式化程序')) a.push('no unsupported toast: ' + ymlState.toast)
if (errors.length) a.push('pageerror: ' + errors.join('|'))
function opened0() { return true }
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/format-e2e.png' })
await browser.close()
