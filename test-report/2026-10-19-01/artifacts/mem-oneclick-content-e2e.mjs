/** 内容级铁证：一键加载后 iframe 内出现的是 mem-demo.md 的内容（非 #file 源 hello.md） */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
const MARK = 'ONECLICK-CONTENT-7f3a9'
fs.writeFileSync('/tmp/mem-demo.md', `# ${MARK}\n\n内容级验证。\n`)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 80)))
await page.goto('http://localhost:5200/embed/file')
await page.waitForTimeout(1500)

const sec = page.locator('.fc-section').filter({ hasText: '内存文件' })
await sec.getByText('编辑', { exact: true }).first().click()
await page.waitForTimeout(400)
for (let i = 0; i < 3; i++) {
  await sec.locator('.el-select, [class*="select"]').first().click()
  await page.waitForTimeout(500)
  await page.locator('.el-select-dropdown__item:visible', { hasText: 'Markdown 编辑' }).first().click()
  await page.waitForTimeout(400)
  const sel = await sec.locator('.el-select, [class*="select"]').first().textContent()
  if (sel && sel.includes('Markdown 编辑')) break
}
await page.locator('.el-checkbox').filter({ hasText: 'Markdown 编辑' }).first().scrollIntoViewIfNeeded()
await page.locator('.el-checkbox').filter({ hasText: 'Markdown 编辑' }).first().click()
await page.waitForTimeout(300)
await sec.locator('input[type="file"]').first().setInputFiles('/tmp/mem-demo.md')
await page.waitForTimeout(500)
await sec.getByRole('button', { name: /加载/ }).click()

const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
let hit = false
const t0 = Date.now()
while (Date.now() - t0 < 30_000) {
  const f = af()
  if (f) {
    hit = await f
      .evaluate((m) => {
        const body = document.body.textContent ?? ''
        return body.includes(m)
      }, MARK)
      .catch(() => false)
    if (hit) break
  }
  await page.waitForTimeout(600)
}
// 深挖：内容出现在哪个容器（md 编辑器 root / CodeMirror / 其它）
const f = af()
const where = await f.evaluate((m) => {
  const q = (sel) => [...document.querySelectorAll(sel)].filter((n) => (n.textContent ?? '').includes(m)).length
  return {
    mdRoot: q('.mm-md-root, .mm-md-preview, .mm-md-source'),
    cm: q('.cm-content, .cm-editor'),
    total: (document.body.textContent ?? '').includes(m),
  }
}, MARK).catch(() => ({ mdRoot: -1, cm: -1, total: false }))
console.log('CONTENT =', JSON.stringify({ hit, where }))
console.log('ASSERTS =', hit && (where.mdRoot > 0 || where.cm > 0) && errors.length === 0 ? 'ALL PASS' : `FAIL errors=${JSON.stringify(errors)}`)
await page.screenshot({ path: '/tmp/mem-oneclick-content.png' })
await browser.close()
