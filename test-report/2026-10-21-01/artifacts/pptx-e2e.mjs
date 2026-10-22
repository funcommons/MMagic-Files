/** pptx-viewer 插件 E2E：装载（勾 pptx）→ 上传 pptx → 双击打开 → 断言 slide 渲染 DOM */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
page.on('dialog', (d) => d.accept())
await page.goto('http://localhost:5200/embed/play')
await page.waitForTimeout(2000)
await page.getByRole('button', { name: /装载/ }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForFunction(() => document.body.textContent?.includes('已就绪'), { timeout: 40000 })
await page.waitForTimeout(1500)
// 宿主直传 pptx
await page.locator('input[type="file"]').first().setInputFiles('/tmp/ws-demo-1792482250.pptx')
await page.waitForTimeout(800)
await page.getByRole('button', { name: /uploadFiles（files/ }).first().click()
await page.waitForTimeout(5000)
const f = () => page.frames().find((fr) => fr.url().startsWith('http://localhost:5199'))
const node = f().locator('span, div').filter({ hasText: /^ws-demo-1792482250\.pptx$/ }).last()
const nodeCount = await f().locator('span, div').filter({ hasText: /^ws-demo-1792482250\.pptx$/ }).count()
console.log('NODE =', nodeCount)
await node.dblclick()
await page.waitForTimeout(6000) // 首次装载插件脚本 2MB + 解析渲染
const st = await f().evaluate(() => {
  const root = document.querySelector('.pptx-viewer')
  return {
    hasRoot: !!root,
    pages: document.querySelectorAll('.pptx-viewer__page').length,
    rootChildren: root ? root.children.length : -1,
    text: root ? (root.textContent ?? '').slice(0, 120) : '',
    bodyHasCover: (root?.textContent ?? '').includes('PPTX 预览测试'),
  }
}).catch((e) => ({ err: String(e).slice(0, 120) }))
console.log('PPTX =', JSON.stringify(st))
const a = []
if (!st.hasRoot) a.push('no .pptx-viewer root')
if (st.pages < 1) a.push('no page container')
if (!st.bodyHasCover) a.push('cover text not rendered: ' + st.text)
if (errors.length) a.push('pageerror: ' + errors.join('|'))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/pptx-e2e.png' })
await browser.close()
