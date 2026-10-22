/**
 * 关键通过路径证据截图（2026-10-18-01 全量回归配套）v3
 * v1 漏展开 apps-demo 折叠态 → K2~K6 超时；v2 修正但 K4 双击打开的是内置 video（设计行为）；
 * v3：K4 走「打开方式 → Artplayer 播放器」插件链路（探针 .ap-root）。
 * 产物：screenshots/K*.png + key-evidence-results.json
 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const fs = await import('node:fs')
const SHOT = '/Users/justin/codes/funcommons/MMagic-Files/test-report/2026-10-18-01/screenshots'
const results = []
const rec = (id, name, pass, detail) => {
  results.push({ id, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${name} :: ${detail}`)
}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push('DEMO ' + e.message.slice(0, 80)))
await page.goto('http://localhost:5200/embed/play')
await page.getByText('装载 iframe（#config）').first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(6000)
const af = () => page.frames().find((f) => f.url().startsWith('http://localhost:5199'))
const fr = page.frameLocator('iframe')
const expand = async (name) => { await fr.getByText(name, { exact: true }).first().dblclick(); await page.waitForTimeout(800) }

try {
  await fr.getByText('apps-demo').first().waitFor({ timeout: 10000 })
  await page.screenshot({ path: `${SHOT}/K1-workbench-ready.png` })
  rec('K1', '工作台装配（iframe+SDK 就绪+树加载）', true, 'apps-demo 节点可见，协议 ready')
} catch (e) {
  await page.screenshot({ path: `${SHOT}/K1-workbench-ready.png` })
  rec('K1', '工作台装配', false, String(e).slice(0, 120))
}
await expand('apps-demo')

try {
  await expand('docs')
  await fr.getByText('sample.md', { exact: true }).first().dblclick()
  await page.waitForTimeout(2500)
  const bomb = await af().evaluate(() => document.body.innerHTML.includes('Syntax error'))
  await page.screenshot({ path: `${SHOT}/K2-markdown-mermaid.png` })
  rec('K2', '内置 markdown+mermaid（静默降级，无炸弹图）', !bomb, bomb ? '发现 mermaid 错误文本' : '渲染正常无错误呈现')
} catch (e) {
  await page.screenshot({ path: `${SHOT}/K2-markdown-mermaid.png` })
  rec('K2', '内置 markdown+mermaid', false, String(e).slice(0, 120))
}

try {
  await expand('code')
  await fr.getByText('app.ts', { exact: true }).first().dblclick()
  await page.waitForTimeout(2500)
  const monaco = await af().evaluate(() => !!document.querySelector('.monaco-editor'))
  await page.screenshot({ path: `${SHOT}/K3-code-renderer.png` })
  rec('K3', 'code 渲染器（Monaco）', monaco, `monaco-editor 挂载=${monaco}`)
} catch (e) {
  await page.screenshot({ path: `${SHOT}/K3-code-renderer.png` })
  rec('K3', 'code 渲染器', false, String(e).slice(0, 120))
}

try {
  await expand('media')
  await fr.getByText('clip.mp4', { exact: true }).first().click({ button: 'right' })
  await page.waitForTimeout(500)
  await fr.getByText('Artplayer 播放器', { exact: true }).first().click()
  await page.waitForTimeout(5000)
  const probe = await af().evaluate(() => {
    const video = document.querySelector('video')
    return {
      apRoot: !!document.querySelector('.ap-root'),
      stage: document.querySelector('.ap-stage')?.getAttribute('class') ?? null,
      artRoot: [...(document.querySelector('.ap-stage')?.querySelectorAll(':scope > *') ?? [])].map((c) => c.className.toString().slice(0, 40))[0] ?? null,
      videoPresent: !!video,
      videoDuration: video ? Math.round(video.duration * 10) / 10 : null,
    }
  })
  await page.screenshot({ path: `${SHOT}/K4-artplayer.png` })
  rec('K4', 'Artplayer 播放器（打开方式插件链路）', probe.apRoot && probe.videoPresent && (probe.videoDuration ?? 0) > 0, JSON.stringify(probe))
} catch (e) {
  await page.screenshot({ path: `${SHOT}/K4-artplayer.png` })
  rec('K4', 'Artplayer 播放器', false, String(e).slice(0, 120))
}

try {
  await expand('images')
  await fr.getByText('photo.png', { exact: true }).first().dblclick()
  await page.waitForTimeout(2500)
  const img = await af().evaluate(() => !!document.querySelector('img[src^="blob:"], img[src*="X-Amz"], canvas'))
  await page.screenshot({ path: `${SHOT}/K5-image-viewer.png` })
  rec('K5', '图片查看器', img, `图片元素挂载=${img}`)
} catch (e) {
  await page.screenshot({ path: `${SHOT}/K5-image-viewer.png` })
  rec('K5', '图片查看器', false, String(e).slice(0, 120))
}

try {
  await fr.getByText('edit-me.png', { exact: true }).first().click({ button: 'right' })
  await page.waitForTimeout(500)
  await fr.getByText('图片编辑（Filerobot）', { exact: true }).first().click()
  await page.waitForTimeout(12000)
  const fie = await af().evaluate(() => {
    const q = (s) => document.querySelector(s)
    const r = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }
    return { mounted: !!q('.FIE_root'), save: r('.FIE_topbar-save-button'), zoom: r('.FIE_topbar-center-options'), tools: r('.FIE_tools-bar-wrapper'), undo: r('.FIE_topbar-undo-button') }
  })
  const layoutOk = fie.mounted && fie.save && fie.save.w <= 40 && fie.undo && fie.zoom && fie.tools
  await page.screenshot({ path: `${SHOT}/K6-filerobot-editor.png` })
  rec('K6', 'Filerobot 编辑器（图标化+顶栏重排）', !!layoutOk, JSON.stringify(fie))
} catch (e) {
  await page.screenshot({ path: `${SHOT}/K6-filerobot-editor.png` })
  rec('K6', 'Filerobot 编辑器', false, String(e).slice(0, 120))
}

try {
  await fr.getByText('demo.csv', { exact: true }).first().click({ button: 'right' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${SHOT}/K7-context-menu.png` })
  const menu = await af().evaluate(() => /打开方式|重命名|删除|下载/.test(document.body.innerHTML) ? 'menu ok' : 'no menu')
  rec('K7', '右键菜单', menu === 'menu ok', menu)
} catch (e) {
  await page.screenshot({ path: `${SHOT}/K7-context-menu.png` })
  rec('K7', '右键菜单', false, String(e).slice(0, 120))
}

rec('ERR', 'demo 页 pageerror 汇总', errors.length === 0, errors.join(' ; ') || '0 pageerror')
fs.writeFileSync('/Users/justin/codes/funcommons/MMagic-Files/test-report/2026-10-18-01/artifacts/key-evidence-results.json', JSON.stringify(results, null, 2))
console.log('DONE', results.filter((r) => r.pass).length + '/' + results.length)
await browser.close()
