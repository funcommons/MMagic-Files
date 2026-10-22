/** xlsx-viewer 样式渲染 E2E（B 方案 ExcelJS）：openpyxl 真实样式文件 → 上传打开 → 断言底色/字色/合并/列宽 */
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
await page.locator('input[type="file"]').first().setInputFiles('/tmp/ws-style-1792482250.xlsx')
await page.waitForTimeout(800)
await page.getByRole('button', { name: /uploadFiles（files/ }).first().click()
await page.waitForTimeout(5000)
const f = () => page.frames().find((fr) => fr.url().startsWith('http://localhost:5199'))
const node = f().locator('span, div').filter({ hasText: /^ws-style-1792482250\.xlsx$/ }).last()
await node.dblclick()
await page.waitForTimeout(4000)
const st = await f().evaluate(() => {
  const table = document.querySelector('.xlsx-sheet table.xlsx-table')
  if (!table) return { hasTable: false }
  const rows = table.querySelectorAll('tr')
  const head = rows[0]?.cells[0]
  const cs = head ? getComputedStyle(head) : null
  const headStyle = head ? head.style : null
  return {
    hasTable: true,
    rows: rows.length,
    tab: document.querySelector('.xlsx-tabs button')?.textContent ?? '',
    headText: head?.textContent ?? '',
    headBg: cs?.backgroundColor ?? '',
    headColor: cs?.color ?? '',
    headBold: cs?.fontWeight ?? '',
    headAlign: cs?.textAlign ?? '',
    headBorderTop: cs?.borderTopWidth ?? '',
    rowH: rows[0]?.style.height ?? '',
    secondRowCells: rows[1]?.cells.length ?? -1,
    colspan: rows[1]?.cells[0]?.colSpan ?? 0,
    mergeText: rows[1]?.cells[0]?.textContent ?? '',
    colW: table.querySelector('colgroup col')?.style.width ?? '',
  }
}).catch((e) => ({ err: String(e).slice(0, 120) }))
console.log('XLSX_STYLE =', JSON.stringify(st))
const a = []
if (!st.hasTable) a.push('no table')
if (st.headBg !== 'rgb(255, 192, 0)') a.push('bg wrong: ' + st.headBg)
if (st.headColor !== 'rgb(255, 0, 0)') a.push('font color wrong: ' + st.headColor)
if (st.headBold !== '600' && st.headBold !== 'bold') a.push('bold wrong: ' + st.headBold)
if (st.headAlign !== 'center') a.push('align wrong: ' + st.headAlign)
if (st.colspan !== 2) a.push('merge colspan wrong: ' + st.colspan)
if (st.colW !== '103px') a.push('col width wrong: ' + st.colW + ' (14*7+5=103)')
if (st.rowH !== '27px') a.push('row height wrong: ' + st.rowH)
if (st.tab !== '样式表') a.push('sheet tab wrong: ' + st.tab)
if (errors.length) a.push('pageerror: ' + errors.join('|'))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/xlsx-style-e2e.png' })
await browser.close()
