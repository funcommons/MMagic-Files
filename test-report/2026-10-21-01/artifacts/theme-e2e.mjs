/** P1-1/P1-2 E2E：主题联动（dark 切换编辑器变暗/亮恢复）+ Ctrl+/ 行注释（basic-languages 自带配置验证） */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)))
page.on('dialog', (d) => d.accept())
await page.goto('http://localhost:5200/embed/play')
await page.waitForTimeout(2000)
await page.getByRole('button', { name: /装载/ }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForFunction(() => document.body.textContent?.includes('已就绪'), { timeout: 40000 })
await page.waitForTimeout(1500)
const f = () => page.frames().find((fr) => fr.url().startsWith('http://localhost:5199'))
const treeNode = (name) => f().locator('span, div').filter({ hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).last()

// ── P1-1 主题联动 ──
await treeNode('ws-messy-1792482250.json').dblclick()
await page.waitForTimeout(3500)
const readColors = () => f().evaluate(() => {
  const ed = document.querySelector('.monaco-editor')
  const lines = document.querySelector('.monaco-editor .view-lines')
  return {
    bg: getComputedStyle(ed).backgroundColor,
    fg: getComputedStyle(lines).color,
  }
})
const light = await readColors()
await f().evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
await page.waitForTimeout(800)
const dark = await readColors()
await f().evaluate(() => { document.documentElement.setAttribute('data-theme', 'light') })
await page.waitForTimeout(800)
const back = await readColors()
f().evaluate(() => { document.documentElement.removeAttribute('data-theme') }).catch(() => {})
const parseRgb = (s) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number)
const isDarkBg = (s) => parseRgb(s).every((v) => v < 100)
console.log('LIGHT =', JSON.stringify(light))
console.log('DARK =', JSON.stringify(dark))
console.log('BACK =', JSON.stringify(back))

// ── P1-2 行注释（yml → 行首 #）：monaco CtrlCmd+K CtrlCmd+C 组合键（mac=Meta；单键 Ctrl+/
//    在合成键盘事件下不触发，组合键等价验证 language configuration 已生效）──
await treeNode('ws-demo-1792482250.yml').dblclick()
await page.waitForTimeout(3000)
const before = await f().evaluate(() => document.querySelector('.monaco-editor .view-line')?.textContent ?? '')
await f().locator('.monaco-editor .view-lines').click({ position: { x: 60, y: 12 } })
await page.waitForTimeout(300)
await page.keyboard.press('Meta+k')
await page.waitForTimeout(150)
await page.keyboard.press('Meta+c')
await page.waitForTimeout(600)
const after = await f().evaluate(() => document.querySelector('.monaco-editor .view-line')?.textContent ?? '')
console.log('COMMENT_BEFORE =', JSON.stringify(before))
console.log('COMMENT_AFTER =', JSON.stringify(after))

const a = []
if (dark.bg === light.bg) a.push('dark bg unchanged: ' + dark.bg)
if (!isDarkBg(dark.bg)) a.push('dark bg not dark: ' + dark.bg)
if (isDarkBg(light.bg)) a.push('light bg not light: ' + light.bg)
if (back.bg !== light.bg) a.push('restore mismatch: ' + back.bg)
if (!after.trimStart().startsWith('#')) a.push('Ctrl+/ no comment injected: ' + after)
if (errors.length) a.push('pageerror: ' + errors.join('|'))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/theme-e2e.png' })
await browser.close()
