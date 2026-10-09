import { chromium } from '@playwright/test'
import fs from 'node:fs'

const seed = {}
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
// minimal S3 mock inline
const README = 'hello mmagic\nline2\n'
await page.route((u) => u.hostname === 's3.mock.local', async (route) => {
  const req = route.request(); const u = new URL(req.url()); const method = req.method()
  const q = u.searchParams
  if (method === 'GET' && q.get('list-type') === '2') {
    return route.fulfill({ status: 200, contentType: 'application/xml', body:
      '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>sessions/test/notes.txt</Key><Size>18</Size></Contents></ListBucketResult>' })
  }
  if (method === 'GET') return route.fulfill({ status: 200, contentType: 'text/plain', body: README })
  return route.fulfill({ status: 200, body: '' })
})
const cfg = { mode:'workspace', v:1, backend:{ endpoint:'https://s3.mock.local', region:'r', bucket:'mock-bucket', prefix:'sessions/test/', credentials:{accessKeyId:'a',accessKeySecret:'b',sessionToken:'c'}, ttlSeconds:3600 }, security:{ allowedOrigins:['http://localhost:5199'] } }
await page.goto('http://localhost:5199/#config=' + encodeURIComponent(JSON.stringify(cfg)))
await page.locator('[data-testid="row"]', { hasText: 'notes.txt' }).click()
await page.locator('.monaco-editor').waitFor({ timeout: 30000 })
await page.waitForTimeout(3000)
const info = await page.evaluate(() => {
  const ed = document.querySelector('.monaco-editor')
  const vl = document.querySelector('.view-lines')
  const host = document.querySelector('.ws__preview-host')
  const stage = document.querySelector('.mmf-preview-stage')
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { w: b.width, h: b.height, x: b.x, y: b.y } }
  return {
    editorRect: r(ed), linesRect: r(vl), hostRect: r(host), stageRect: r(stage),
    editorHtmlLen: ed?.innerHTML.length, linesText: vl?.textContent?.slice(0, 80),
    linesStyle: vl ? { color: getComputedStyle(vl).color, font: getComputedStyle(vl).fontSize, whiteSpace: getComputedStyle(vl).whiteSpace } : null,
    editorStyle: ed ? { visibility: getComputedStyle(ed).visibility, opacity: getComputedStyle(ed).opacity, zIndex: getComputedStyle(ed).zIndex } : null,
    iframes: document.querySelectorAll('iframe').length,
    canvases: ed ? ed.querySelectorAll('canvas').length : 0,
    lineHeightEls: ed ? ed.querySelectorAll('.view-line').length : 0,
  }
})
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: '/tmp/monaco-probe.png' })
const el = await page.$('.ws__preview')
if (el) await el.screenshot({ path: '/tmp/monaco-probe-element.png' })
await browser.close()
