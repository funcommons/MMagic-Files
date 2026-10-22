/** code-editor 验证：36px 工具栏、折叠符常显、minimap、自绘中文右键菜单 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)))
await page.goto('http://localhost:5200/embed/play')
await page.waitForTimeout(2000)
await page.getByRole('button', { name: /装载/ }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(6000)
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
const f = af()
// 双击 ws-upload-test.txt（txt → 内置 code-editor）
await f.locator('text=ws-upload-test.txt').first().dblclick()
let opened = false
const t0 = Date.now()
while (Date.now() - t0 < 20_000) {
  if (await f.evaluate(() => !!document.querySelector('.mmagic-code .monaco-editor')).catch(() => false)) { opened = true; break }
  await page.waitForTimeout(500)
}
await page.waitForTimeout(1500)
const st = await f.evaluate(() => {
  const bar = document.querySelector('.mmagic-code-bar')
  const ed = document.querySelector('.monaco-editor')
  return {
    barH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    barBg: bar ? getComputedStyle(bar).backgroundColor : null,
    folding: !!document.querySelector('.monaco-editor .folding, .monaco-editor .margin-view-overlays .folded-background, .monaco-editor .cldr'),
    foldingGutter: !!document.querySelector('.monaco-editor .margin-view-overlays'),
    minimap: !!document.querySelector('.monaco-editor .minimap'),
    sticky: !!document.querySelector('.monaco-editor .sticky-widget'),
  }
}).catch((e) => ({ err: String(e).slice(0, 120) }))
// 右键 → 自绘菜单
const edBox = await f.locator('.monaco-editor').boundingBox()
await page.mouse.click(edBox.x + 200, edBox.y + 100, { button: 'right' })
await page.waitForTimeout(600)
const menu = await f.evaluate(() => {
  const m = document.querySelector('.mmagic-code-ctxmenu')
  return m ? [...m.querySelectorAll('button')].map((b) => b.textContent?.trim()) : null
}).catch(() => null)
console.log('OPENED =', opened)
console.log('STATE =', JSON.stringify(st))
console.log('MENU =', JSON.stringify(menu))
const a = []
if (!opened) a.push('code editor not opened')
if (st.barH !== 36) a.push('bar height != 36: ' + st.barH)
if (!st.minimap) a.push('minimap missing')
if (!st.foldingGutter) a.push('gutter missing')
if (!menu || !menu.includes('剪切')) a.push('ctx menu missing 剪切: ' + JSON.stringify(menu))
if (!menu || !menu.includes('命令面板')) a.push('ctx menu missing 命令面板')
if (errors.length) a.push('pageerror: ' + errors.join('|'))
// 右键菜单反馈链：复制（无选区=整行）→ toast；yaml 下格式化置灰
const edBox2 = await f.locator('.monaco-editor').boundingBox()
await page.mouse.click(edBox2.x + 200, edBox2.y + 80, { button: 'right' })
await page.waitForTimeout(400)
const copyBtn = f.locator('.mmagic-code-ctxmenu button', { hasText: '复制' })
await copyBtn.click()
await page.waitForTimeout(600)
await page.waitForTimeout(400)
const copyToastText = await f.evaluate(() => {
  const els = [...document.querySelectorAll('.el-message, [class*="toast"]')]
  return els.map((n) => n.textContent?.trim().slice(0, 40)).filter(Boolean).join('|')
})
const copyToast = copyToastText.includes('已复制') || copyToastText.includes('粘贴失败')
await page.mouse.click(edBox2.x + 200, edBox2.y + 80, { button: 'right' })
await page.waitForTimeout(400)
const fmtDisabled = await f.evaluate(() => {
  const b = [...document.querySelectorAll('.mmagic-code-ctxmenu button')].find((x) => x.textContent === '格式化')
  return b ? b.disabled : null
}).catch(() => null)
await page.keyboard.press('Escape')
console.log('FEEDBACK =', JSON.stringify({ copyToast, fmtDisabled }))
if (!copyToast) a.push('no copy/paste toast: ' + copyToastText)
console.error('COPY_TOAST_TEXT =', copyToastText)
if (fmtDisabled !== true) a.push('format not greyed on yaml: ' + fmtDisabled)
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/code-e2e.png' })
await browser.close()
