/** local 模式 E2E（宿主代 pick 架构）：radio 切本地 → S3 表单隐藏 + 宿主「选择本地文件夹」按钮出现 →
 *  装载 → iframe 内引导卡（宿主引导文案）→ 宿主按钮点击触发顶层 picker（headless 下 AbortError=API 可达）
 *  → postMessage 通道注入 fake handle 不可行（含方法不可 structured-clone）——树链路由单测覆盖 */
import { createRequire } from 'module'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1676, height: 930 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)))
await page.goto('http://localhost:5200/embed/play')
await page.waitForTimeout(2000)
await page.locator('.el-radio').filter({ hasText: '本地文件夹' }).first().click()
await page.waitForTimeout(300)
const s3FormVisible = await page.locator('input[placeholder="http://localhost:9000"]').isVisible().catch(() => false)
const hostBtn = await page.getByTestId('localfs-host-pick').isVisible().catch(() => false)
// 装载
await page.getByRole('button', { name: /装载/ }).first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForFunction(() => document.body.textContent?.includes('已就绪'), { timeout: 40000 })
await page.waitForTimeout(2000)
const f = () => page.frames().find((fr) => fr.url().startsWith('http://localhost:5199'))
const hero = await f().evaluate(() => ({
  hasCard: !!document.querySelector('.local-fs-hero'),
  text: (document.querySelector('.local-fs-hero')?.textContent ?? '').slice(0, 90),
  noPickBtn: !document.querySelector('[data-testid="localfs-pick"]'), // 跨源 iframe：不出本页 pick 钮
}))
// 宿主按钮点击 → 顶层 picker 调用（headless 无手势环境 AbortError=API 通、策略不拦）
let hostPickResult = 'n/a'
page.once('dialog', () => {}) // no-op：picker 非 JS dialog
hostPickResult = await page.evaluate(async () => {
  try {
    await window.showDirectoryPicker({ mode: 'read' })
    return 'opened'
  } catch (err) {
    return err instanceof DOMException ? err.name : String(err).slice(0, 60)
  }
})
console.log('S3_FORM_VISIBLE =', s3FormVisible)
console.log('HOST_BTN =', hostBtn)
console.log('HERO =', JSON.stringify(hero))
console.log('TOP_PICK =', hostPickResult)
const a = []
if (s3FormVisible) a.push('s3 form still visible')
if (!hostBtn) a.push('host pick button missing')
if (!hero.hasCard) a.push('no hero card in iframe')
if (!hero.noPickBtn) a.push('iframe shows in-frame pick button (should be host-pick mode)')
if (!hero.text.includes('嵌入页')) a.push('hero not host-pick copy: ' + hero.text)
if (hostPickResult === 'SecurityError') a.push('top-level picker blocked?!')
if (hostPickResult !== 'AbortError' && hostPickResult !== 'opened') a.push('unexpected picker result: ' + hostPickResult)
if (errors.length) a.push('pageerror: ' + errors.join('|'))
console.log('ASSERTS =', a.length ? a.join(' | ') : 'ALL PASS')
await page.screenshot({ path: '/tmp/localfs-e2e.png' })
await browser.close()
