/**
 * 本地文件夹模式 E2E v2（同源直调路径）：local-e2e-host.html（同源宿主壳）→ iframe 内
 * patch showDirectoryPicker → 5199 origin 的 OPFS handle（同源克隆可传，跨源 OPFS 会静默丢包
 * ——实验证据见 test-report）→ 点 iframe 内「打开本地文件夹」直调按钮 → 树/预览/写回全链。
 * 跨源宿主代理路径（openLocalFolder 命令）由 demo 页覆盖命令链；真实 picked handle 跨源手测。
 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
page.on('dialog', (d) => d.accept())
await page.goto('http://localhost:5199/local-e2e-host.html')
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForFunction(() => document.body.textContent?.includes('ready ✓'), { timeout: 40000 })
await page.waitForTimeout(1500)
const f = () => page.frames().find((fr) => fr.url().startsWith('http://localhost:5199/#') || (fr.url().startsWith('http://localhost:5199/') && fr !== page.mainFrame()))

// ① iframe 内 patch picker → 5199 OPFS（同源 handle）+ 预置文件
await f().evaluate(async () => {
  const root = await navigator.storage.getDirectory()
  const fh = await root.getFileHandle('note-local.ts', { create: true })
  const w = await fh.createWritable()
  await w.write('// 本地模式 E2E\nconst ok = 1')
  await w.close()
  window.showDirectoryPicker = async () => root
})
await page.waitForTimeout(300)

// ② 点 iframe 内直调按钮（同源 iframe 规范允许直调）
const entryBtn = f().locator('.ws__local-perm--entry')
console.log('ENTRY_BTN =', await entryBtn.count())
await entryBtn.click()
await page.waitForTimeout(2500)

// ③ 授权条兜底（若 needs-permission）
let permBar = await f().evaluate(() => !!document.querySelector('.ws__local-perm:not(.ws__local-perm--entry)'))
if (permBar) {
  await f().locator('.ws__local-perm__btn').click()
  await page.waitForTimeout(1500)
}
// ④ 树显示 OPFS 文件
let treeHas = await f().evaluate(() => document.body.textContent?.includes('note-local.ts') ?? false)
for (let i = 0; i < 10 && !treeHas; i++) {
  await page.waitForTimeout(500)
  treeHas = await f().evaluate(() => document.body.textContent?.includes('note-local.ts') ?? false)
}
console.log('PERM_BAR =', permBar, ' TREE_HAS =', treeHas)

// ⑤ 双击预览（markdown，应用层零改动验证）
let preview = { skipped: true }
if (treeHas) {
  const node = f().locator('span, div').filter({ hasText: /^note-local\.ts$/ }).last()
  await node.dblclick()
  await page.waitForTimeout(3500)
  preview = await f().evaluate(() => ({
    hasMd: !!document.querySelector('.markdown-body, [class*=markdown]'),
    bodyHas: !!document.querySelector('.monaco-editor'),
  })).catch((e) => ({ err: String(e).slice(0, 100) }))
}
console.log('PREVIEW =', JSON.stringify(preview))

// ⑥ 写回链：宿主 uploadFiles（target=bucket→本地域 put）→ 上传队列→LocalFsClient.put→OPFS 落盘
let writeBack = 'skipped'
try {
  const up = await page.evaluate(async () => {
    const r = await window.__hostCall('uploadFiles', {
      files: [new File(['// uploaded 写回验证'], 'up-local.ts', { type: 'text/plain' })],
      target: 'bucket',
    })
    return JSON.stringify(r).slice(0, 120)
  })
  await page.waitForTimeout(2500)
  const reread = await f().evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    try {
      const fh = await root.getFileHandle('up-local.ts')
      return (await fh.getFile()).text()
    } catch { return 'NOT_FOUND' }
  })
  const treeUp = await f().evaluate(() => document.body.textContent?.includes('up-local.ts') ?? false)
  writeBack = reread === '// uploaded 写回验证' && treeUp ? `written ✓ (${up})` : `mismatch: ${JSON.stringify(reread)} tree=${treeUp} reply=${up}`
} catch (e) {
  writeBack = 'err: ' + String(e).slice(0, 90)
}
console.log('WRITE_BACK =', writeBack)

const a = []
if (treeHas !== true) a.push('tree missing note-local.md')
if (preview.bodyHas !== true) a.push('preview missing: ' + JSON.stringify(preview))
if (!String(writeBack).includes('written')) a.push('write-back failed: ' + writeBack)
if (errors.length) a.push('pageerror: ' + errors.join('|'))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/local-fs-e2e.png' })
await browser.close()
