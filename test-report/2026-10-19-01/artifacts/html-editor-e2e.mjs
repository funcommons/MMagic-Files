/** html-editor 全链 E2E：无源装载 → 传 html → 加载 → 三态切换 → 预览链接确认条 → 取消 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
const MARK = 'HTMLEDITOR-VERIFY-4e7f'
fs.writeFileSync('/tmp/mem-demo.html', `<!doctype html>
<html><head><meta charset="utf-8"><title>${MARK}</title></head>
<body><h1>${MARK}</h1><p>段落内容</p>
<p><a href="https://example.com/next">外部链接</a></p>
</body></html>
`)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 100)))
await page.goto('http://localhost:5200/embed/file')
await page.waitForTimeout(1500)
const sec = page.locator('.fc-section').filter({ hasText: '内存文件' })
await sec.getByText('编辑', { exact: true }).first().click()
await page.waitForTimeout(400)
for (let i = 0; i < 3; i++) {
  await sec.locator('.el-select, [class*="select"]').first().click()
  await page.waitForTimeout(500)
  await page.locator('.el-select-dropdown__item:visible', { hasText: 'HTML 编辑' }).first().click()
  await page.waitForTimeout(400)
  const sel = await sec.locator('.el-select, [class*="select"]').first().textContent()
  if (sel && sel.includes('HTML 编辑')) break
}
await sec.locator('input[type="file"]').first().setInputFiles('/tmp/mem-demo.html')
await page.waitForTimeout(500)
await sec.getByRole('button', { name: /加载/ }).click()
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
// 等 html-editor 源码态出现
let opened = false
const t0 = Date.now()
while (Date.now() - t0 < 30_000) {
  const f = af()
  if (f && await f.evaluate(() => !!document.querySelector('.mm-html-root .cm-editor')).catch(() => false)) { opened = true; break }
  await page.waitForTimeout(500)
}
const f = af()
const srcState = await f.evaluate((m) => {
  const cm = document.querySelector('.mm-html-root .cm-content')
  return {
    cmText: cm?.textContent?.includes(m) ?? false,
    cmLen: cm?.textContent?.length ?? 0,
    srcActive: document.querySelector('.mm-html-pane')?.dataset.active,
  }
}, MARK).catch(() => ({ err: 'x' }))
// 切可视编辑
await f.locator('.mm-html-modes button', { hasText: '可视编辑' }).click()
await page.waitForTimeout(1500)
const wysiwyg = await f.evaluate(() => ({
  tiptap: !!document.querySelector('.mm-html-wysiwyg .tiptap'),
  h1: document.querySelector('.mm-html-wysiwyg .tiptap h1')?.textContent ?? null,
})).catch(() => ({ err: 'x' }))
// 切预览（wysiwyg→preview 触发「重排确认」条——预期交互，点「继续切换」）
await f.locator('.mm-html-modes button', { hasText: '页面预览' }).click()
await page.waitForTimeout(800)
const rewriteBar = f.locator('.mm-html-confirm[data-active="true"]')
if (await rewriteBar.isVisible().catch(() => false)) {
  await rewriteBar.locator('button', { hasText: '继续切换' }).click()
  console.error('rewrite confirmed')
}
await page.waitForTimeout(1500)
const preview = await f.evaluate(() => {
  const fr = document.querySelector('.mm-html-preview iframe')
  return { iframe: !!fr, sandbox: fr?.getAttribute('sandbox') ?? null, h1: (fr?.srcdoc ?? '').includes('HTMLEDITOR') }
}).catch(() => ({ err: 'x' }))
// 预览内点外部链接 → 确认条（沙箱 iframe 无 allow-same-origin：父页不可读 contentDocument，
// 恰是沙箱生效的证据——走 Playwright frame 通道进入）
const pvFrame = page.frames().find((x) => x !== f && (x.url() === 'about:srcdoc' || x.url() === 'about:blank'))
let confirmBar = { active: false, text: 'SKIPPED' }
let popup = 'SKIPPED'
if (!pvFrame) {
  console.error('FRAMES =', JSON.stringify(page.frames().map((x) => x.url().slice(0, 60))))
  const pvState = await f.evaluate(() => {
    const fr = document.querySelector('.mm-html-preview iframe')
    return fr ? { present: true, sandbox: fr.getAttribute('sandbox'), srcdocLen: (fr.srcdoc ?? '').length } : { present: false }
  }).catch(() => ({ err: 'x' }))
  console.error('PREVIEW_STATE =', JSON.stringify(pvState))
} else {
  await pvFrame.locator('a[href]').first().click()
  await page.waitForTimeout(800)
  confirmBar = await f.evaluate(() => {
    const bar = document.querySelector('.mm-html-confirm')
    return { active: bar?.dataset.active === 'true', text: (bar?.textContent ?? '').slice(0, 60) }
  }).catch(() => ({ err: 'x' }))
  const popupPromise = new Promise((r) => page.once('popup', () => r('POPUP_OPENED')))
  await f.locator('.mm-html-confirm button').last().click()
  popup = await Promise.race([popupPromise, new Promise((r) => setTimeout(() => r('NO_POPUP'), 1500))])
}
console.log('SRC =', JSON.stringify(srcState))
console.log('WYSIWYG =', JSON.stringify(wysiwyg))
console.log('PREVIEW =', JSON.stringify(preview))
console.log('CONFIRM =', JSON.stringify(confirmBar))
console.log('POPUP =', popup)
const a = []
if (!opened) a.push('html editor did not open')
if (!srcState.cmText) a.push('source text missing mark')
if (!wysiwyg.tiptap || !String(wysiwyg.h1).includes(MARK)) a.push('wysiwyg broken: ' + JSON.stringify(wysiwyg))
if (!preview.iframe || preview.sandbox !== 'allow-scripts') a.push('preview sandbox wrong: ' + preview.sandbox)
if (!confirmBar.active) a.push('confirm bar not shown')
if (!String(confirmBar.text).includes('新标签页')) a.push('confirm text wrong')
if (popup !== 'POPUP_OPENED') a.push('window.open not fired after confirm: ' + popup)
if (errors.length) a.push('pageerror: ' + errors.join('|'))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/html-editor-e2e.png' })
await browser.close()
