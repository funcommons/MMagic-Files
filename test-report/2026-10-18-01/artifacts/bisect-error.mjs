import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
let errCount = 0
let lastStep = 'init'
page.on('pageerror', (e) => { errCount++; console.log(`[PAGEERROR after ${lastStep}] #${errCount}: ${e.message.slice(0, 120)}\nFULL_STACK:\n${e.stack ?? '(no stack)'}\n`) })
await page.goto('http://localhost:5200/embed/play')
await page.getByText('装载 iframe（#config）').first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(6000)
const fr = page.frameLocator('iframe')
lastStep = 'mount'
await fr.getByText('apps-demo', { exact: true }).first().dblclick(); await page.waitForTimeout(800); lastStep = 'expand apps-demo'
await fr.getByText('docs').first().dblclick(); await page.waitForTimeout(600); lastStep = 'expand docs'
await fr.getByText('sample.md', { exact: true }).first().dblclick(); await page.waitForTimeout(2500); lastStep = 'open sample.md'
await fr.getByText('code').first().dblclick(); await page.waitForTimeout(600); lastStep = 'expand code'
await fr.getByText('app.ts', { exact: true }).first().dblclick(); await page.waitForTimeout(2500); lastStep = 'open app.ts'
await fr.getByText('media').first().dblclick(); await page.waitForTimeout(600); lastStep = 'expand media'
await fr.getByText('clip.mp4', { exact: true }).first().dblclick(); await page.waitForTimeout(5000); lastStep = 'open clip.mp4'
await fr.getByText('images').first().dblclick(); await page.waitForTimeout(600); lastStep = 'expand images'
await fr.getByText('photo.png', { exact: true }).first().dblclick(); await page.waitForTimeout(2500); lastStep = 'open photo.png'
await fr.getByText('edit-me.png', { exact: true }).first().click({ button: 'right' }); await page.waitForTimeout(500); lastStep = 'rightclick edit-me.png'
await fr.getByText('图片编辑（Filerobot）', { exact: true }).first().click(); await page.waitForTimeout(12000); lastStep = 'open filerobot'
await fr.getByText('demo.csv', { exact: true }).first().click({ button: 'right' }); await page.waitForTimeout(600); lastStep = 'rightclick demo.csv'
console.log('TOTAL pageerror =', errCount)
await browser.close()
