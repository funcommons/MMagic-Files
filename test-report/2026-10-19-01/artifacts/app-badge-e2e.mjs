/**
 * 应用徽标 E2E（用户口径：工具栏显示当前应用名，多应用点击切换）：
 * 打开 hello.md → 徽标显示「Markdown 渲染」→ 点徽标下拉 → 切 code-editor → Monaco 出现 + 徽标文案变
 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 80)))
await page.goto('http://localhost:5200/embed/play')
await page.getByText('装载 iframe（#config）').first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(6000)
const fr = page.frameLocator('iframe')
await fr.getByText('apps-demo', { exact: true }).first().dblclick(); await page.waitForTimeout(800)
await fr.getByText('docs', { exact: true }).first().dblclick(); await page.waitForTimeout(800)
await fr.getByText('sample.md', { exact: true }).first().dblclick()
await page.waitForTimeout(2500)
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
// 1) 徽标显示当前应用
const badge1 = await af().evaluate(() => {
  const b = document.querySelector('[data-testid="toolbar-app-badge"]')
  return { text: (b?.textContent ?? '').trim(), visible: !!b && b.getBoundingClientRect().width > 0 }
})
// 2) 点徽标 → 下拉菜单 → 切 code-editor
await fr.locator('[data-testid="toolbar-app-badge"]').click()
await page.waitForTimeout(600)
const menuItems = await af().evaluate(() => [...document.querySelectorAll('[data-testid^="toolbar-app-"]')].map((e) => ({ id: e.getAttribute('data-testid'), text: (e.textContent ?? '').trim() })))
await fr.locator('[data-testid="toolbar-app-code-editor"]').click()
await page.waitForTimeout(2500)
const after = await af().evaluate(() => ({
  monaco: !!document.querySelector('.monaco-editor'),
  badge: (document.querySelector('[data-testid="toolbar-app-badge"]')?.textContent ?? '').trim(),
}))
const a = []
if (!badge1.visible || !badge1.text) a.push('badge not visible ' + JSON.stringify(badge1))
if (!badge1.text.includes('Markdown')) a.push('badge not markdown ' + badge1.text)
if (menuItems.length < 2) a.push('menu items < 2 ' + JSON.stringify(menuItems))
if (!after.monaco) a.push('monaco not mounted after switch')
if (!after.badge.includes('Code') && !after.badge.includes('代码')) a.push('badge not switched ' + after.badge)
console.log('BADGE1 =', JSON.stringify(badge1))
console.log('MENU =', JSON.stringify(menuItems))
console.log('AFTER =', JSON.stringify(after))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
console.log('ERRORS =', JSON.stringify(errors))
await page.screenshot({ path: '/tmp/app-badge.png' })
await browser.close()
