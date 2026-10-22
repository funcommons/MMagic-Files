/**
 * 内存文件通路 E2E（uploadFiles target=memory）：
 * T1 workspace：面板开「内存处理」→ 选 png → 上传 → reply accepted mem:// + iframe 自动开预览（img 挂载）
 * T2 单文件：/embed/file → 装载 → 上传按钮选 png → 预览打开（mem:// 经 urlDataSource 分支）
 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
// 1×1 png 夹具
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
fs.writeFileSync('/tmp/mem-test.png', PNG)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 80)))
const r = {}

// ── T1 workspace ──
await page.goto('http://localhost:5200/embed/play')
await page.getByText('装载 iframe（#config）').first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(6000)
await page.locator('.uploader input[type="file"]').first().setInputFiles('/tmp/mem-test.png')
// 开「内存处理」开关（el-switch）
await page.locator('.fc-section').filter({ hasText: 'uploadFiles' }).locator('.el-switch').first().click()
await page.waitForTimeout(300)
await page.getByRole('button', { name: /uploadFiles/ }).first().click()
await page.waitForTimeout(2500)
await page.locator('.log-toggle').first().click().catch(() => {})
await page.waitForTimeout(400)
const logText = await page.locator('body').textContent().catch(() => '')
const m = logText && logText.match(/uploadFiles[^\n]{0,180}/g)
r.LOG = m ? m.slice(-4) : null
const t1 = await page.frames().find((f) => f.url().startsWith('http://localhost:5199'))?.evaluate(() => {
  // mem 预览打开 = 出现 img（image-viewer 渲染 mem:// key）
  const img = document.querySelector('.ws__preview-host img')
  const tabs = [...document.querySelectorAll('[class*="tab"]')].map((t) => t.textContent ?? '').filter((x) => x.includes('mem-test'))
  return { imgMounted: !!img, tabTitles: tabs.slice(0, 3) }
})
r.T1 = { ...t1, errors: errors.length }
await page.screenshot({ path: '/tmp/mem-t1.png' })

// ── T2 单文件 ──
await page.goto('http://localhost:5200/embed/file')
await page.waitForTimeout(1500)
// 装载（按钮文案同 workspace？FilePlay 的 mount 按钮 label=t('demo.file.mount')——用「装载」匹配）
await page.getByRole('button', { name: /装载|挂载|Mount/i }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(5000)
// 对照实验：先 setTheme（base 命令）再上传——分辨 file 模式 overrides 是否整体失效
const probe = page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
await page.getByRole('button', { name: /setTheme/i }).first().click()
await page.waitForTimeout(1500)
// 上传按钮（hidden input 在 label.mem-upload 内）
await page.locator('label.mem-upload input[type="file"]').setInputFiles('/tmp/mem-test.png')
await page.waitForTimeout(2500)
const logText2 = await page.locator('body').textContent().catch(() => '')
const m2 = logText2 && logText2.match(/uploadFiles[^\n]{0,160}/g)
const t2 = await page.frames().find((f) => f.url().startsWith('http://localhost:5199'))?.evaluate(() => {
  const img = document.querySelector('img')
  return { imgMounted: !!img }
})
r.T2LOG = m2 ? m2.slice(-3) : null
r.T2 = { ...t2 }
await page.screenshot({ path: '/tmp/mem-t2.png' })
console.log('RESULT =', JSON.stringify(r))
console.log('ERRORS =', JSON.stringify(errors))
await browser.close()
