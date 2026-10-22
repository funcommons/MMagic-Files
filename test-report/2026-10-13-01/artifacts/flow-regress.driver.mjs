// flow-editor 全量回归 v2（playwright 实机驱动，真实 demo :5200 + MinIO）
// v1 结论收敛：① 空白/低位点击落在画布外（画布仅 ~282px 高）→ fit-first + 动态 bbox
// ② 形状菜单开合翻转互撞 → 菜单状态跟踪 ③ 目录重复 dblclick 反复折叠 → 展开一次记忆
// ④ 场景引用被撤销吃掉的节点 → 重排（F7 用审批，F8 用基线节点，F9 删的是新边端点）
// pass → 关键截图 <id>-pass.png；fail → 完整证据 <id>-FAIL.png（全页）
import { createRequire } from 'module'
import { writeFileSync } from 'fs'
const require = createRequire('/Users/justin/codes/funcommons/MMagic-Files/frontend/package.json')
const { chromium } = require('@playwright/test')

const OUT = '/Users/justin/codes/funcommons/MMagic-Files/test-report/2026-10-13-01/screenshots'
const ART = '/Users/justin/codes/funcommons/MMagic-Files/test-report/2026-10-13-01/artifacts'
const results = []
const consoleErrors = []
let page, frame, browser

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
async function shot(name, opts = {}) {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts })
}
async function check(lane, id, name, fn) {
  try {
    await fn()
    results.push({ lane, id, name, pass: true })
    console.log(`PASS ${id} ${name}`)
  } catch (e) {
    results.push({ lane, id, name, pass: false, error: String(e).slice(0, 1500) })
    console.log(`FAIL ${id} ${name} :: ${String(e).slice(0, 200)}`)
    await shot(`${id}-FAIL`, { fullPage: true }).catch(() => {})
  }
}

// ── 选择器助手 ──
const canvas = () => frame.locator('.mmagic-flow__canvas')
const nodeCount = () => canvas().locator('.x6-node').count()
const edgeCount = () => canvas().locator('.x6-edge').count()
const badge = () => frame.locator('.mmagic-flow__badge').textContent()
const zoomTxt = () => frame.locator('.mmagic-flow__zoom').textContent()
const node = (t) => canvas().locator(`.x6-node:has-text("${t}")`).first()
const boundaryCount = () => canvas().locator('.x6-cell-tool, [data-tool-name="boundary"]').count()
const fitFirst = async () => {
  await frame.locator('[data-testid="flow-fit"]').click()
  await page.waitForTimeout(450)
}
async function clickNode(t) {
  await fitFirst()
  await node(t).click()
  await page.waitForTimeout(250)
}
let menuOpen = false
async function shapeAdd(kind) {
  if (!menuOpen) {
    await frame.locator('[data-testid="flow-shape-btn"]').click()
    await page.waitForTimeout(250)
    menuOpen = true
  }
  await frame.locator(`[data-testid="flow-kind-${kind}"]`).click()
  menuOpen = false
  await page.waitForTimeout(350)
}
const expanded = new Set()
async function ensureExpanded(folder) {
  if (!expanded.has('apps-demo')) {
    await frame.getByText('apps-demo').first().dblclick()
    expanded.add('apps-demo')
    await page.waitForTimeout(900)
  }
  if (folder && !expanded.has(folder)) {
    await frame.getByText(folder).first().dblclick()
    expanded.add(folder)
    await page.waitForTimeout(900)
  }
}
async function openFile(file, folder = 'diagrams') {
  await ensureExpanded(folder)
  await frame.getByText(file).first().dblclick()
  await page.waitForTimeout(1500)
}
async function closeActiveTab() {
  await frame.locator('.ptabs__tab.is-active .ptabs__close').click()
  await page.waitForTimeout(700)
}

// ── 启动 ──
browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
page = await context.newPage()
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${e.message}`.slice(0, 300)))
const dialogLog = []
page.on('dialog', async (d) => {
  dialogLog.push({ message: d.message(), type: d.type() })
  await d.dismiss()
})

await page.goto('http://localhost:5200/embed/play')
await page.getByText('装载 iframe（#config）').first().click()
await page.waitForSelector('iframe', { timeout: 15000 })
await page.waitForTimeout(3500)
frame = page.frameLocator('iframe')
await openFile('approval.mmd')
await canvas().waitFor({ timeout: 15000 })
await page.waitForTimeout(600)
await fitFirst()

const BASE_NODES = await nodeCount()
const BASE_EDGES = await edgeCount()
console.log(`BASELINE nodes=${BASE_NODES} edges=${BASE_EDGES}`)

// ═══ F1 装配与渲染 ═══
await check('F1 装配与渲染', 're-01', 'X6 画布装配：节点数≥4、边数≥3', async () => {
  assert((await nodeCount()) >= 4, `nodes=${await nodeCount()} < 4`)
  assert((await edgeCount()) >= 3, `edges=${await edgeCount()} < 3`)
  await shot('re-01-pass')
})
await check('F1 装配与渲染', 're-02', '语义配色：判定节点菱形琥珀底 #fffbeb', async () => {
  const fill = await node('审批').locator('polygon').getAttribute('fill')
  assert(fill === '#fffbeb', `审批 fill=${fill}`)
})
await check('F1 装配与渲染', 're-03', '自适应尺寸：各节点盒随文本（非等宽定值）', async () => {
  const ws = new Set()
  for (const t of ['提交申请', '审批', '归档']) {
    const b = await node(t).boundingBox()
    ws.add(`${Math.round(b.width)}x${Math.round(b.height)}`)
  }
  assert(ws.size >= 2, `所有节点同尺寸 ${[...ws].join(',')}`)
})

// ═══ F2 选中效果 ═══
await check('F2 选中效果', 're-04', '点选节点 → boundary 虚线包围盒出现', async () => {
  await clickNode('审批')
  assert((await boundaryCount()) > 0, 'boundary tool 未出现')
  await shot('re-04-pass')
})
await check('F2 选中效果', 're-05', '点空白 → 选中效果清除 + 面板收起', async () => {
  const c = await canvas().boundingBox()
  await canvas().click({ position: { x: 30, y: c.height - 30 } })
  await page.waitForTimeout(300)
  assert((await boundaryCount()) === 0, `boundary 仍存在 ${await boundaryCount()}`)
  assert((await frame.locator('.mmagic-flow__panel.is-open').count()) === 0, '面板未收起')
})
await check('F2 选中效果', 're-06', '点选边 → boundary 挂载到边', async () => {
  await fitFirst()
  const e = canvas().locator('.x6-edge').first()
  const b = await e.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(300)
  assert((await boundaryCount()) > 0, '边选中无 boundary')
  await shot('re-06-pass')
  const c = await canvas().boundingBox()
  await canvas().click({ position: { x: 30, y: c.height - 30 } })
  await page.waitForTimeout(200)
})

// ═══ F3 缩放体系 ═══
await check('F3 缩放体系', 're-07', '放大一次 → 125%', async () => {
  await frame.locator('[data-testid="flow-zoom-in"]').click()
  await page.waitForTimeout(250)
  assert((await zoomTxt()) === '125%', `zoom=${await zoomTxt()}（期望 125%）`)
})
await check('F3 缩放体系', 're-08', '缩小一次 → 100%', async () => {
  await frame.locator('[data-testid="flow-zoom-out"]').click()
  await page.waitForTimeout(250)
  assert((await zoomTxt()) === '100%', `zoom=${await zoomTxt()}（期望 100%）`)
})
await check('F3 缩放体系', 're-09', 'Ctrl+滚轮缩放生效', async () => {
  await frame.locator('[data-testid="flow-zoom-reset"]').click()
  await page.waitForTimeout(250)
  const c = await canvas().boundingBox()
  await page.keyboard.down('Control')
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
  await page.mouse.wheel(0, -240)
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)
  const z = await zoomTxt()
  assert(z !== '100%', `ctrl+wheel 后仍 ${z}`)
  await shot('re-09-pass')
})
await check('F3 缩放体系', 're-10', '适应画布 → ≤100%', async () => {
  await frame.locator('[data-testid="flow-fit"]').click()
  await page.waitForTimeout(350)
  assert(parseInt(await zoomTxt()) <= 100, `fit 后 ${await zoomTxt()}`)
})
await check('F3 缩放体系', 're-11', '1:1 → 100%', async () => {
  await frame.locator('[data-testid="flow-zoom-reset"]').click()
  await page.waitForTimeout(350)
  assert((await zoomTxt()) === '100%', `zoom=${await zoomTxt()}`)
  await shot('re-11-pass')
})

// ═══ F4 形状下拉与节点模板 ═══
await check('F4 形状下拉与节点模板', 're-12', '形状下拉展开：5 类语义模板（色点+名称）', async () => {
  await frame.locator('[data-testid="flow-shape-btn"]').click()
  menuOpen = true
  await page.waitForTimeout(250)
  const items = await frame.locator('[data-testid="flow-shape-menu"] button').count()
  assert(items === 5, `menu items=${items}`)
  await shot('re-12-pass')
})
await check('F4 形状下拉与节点模板', 're-13', '逐类添加 5 节点：判定/开始/输入输出/结束/过程', async () => {
  await frame.locator('[data-testid="flow-kind-decision"]').click() // 菜单已开
  menuOpen = false
  await page.waitForTimeout(350)
  for (const k of ['start', 'io', 'end', 'process']) await shapeAdd(k)
  assert((await nodeCount()) === BASE_NODES + 5, `nodes=${await nodeCount()} 期望 ${BASE_NODES + 5}`)
  await shot('re-13-pass')
})

// ═══ F5 撤销/重做 ═══
const N5 = BASE_NODES + 5
await check('F5 撤销/重做', 're-14', '撤销（单步）→ 节点 9→8', async () => {
  await frame.locator('[data-testid="flow-undo"]').click()
  await page.waitForTimeout(350)
  assert((await nodeCount()) === N5 - 1, `nodes=${await nodeCount()} 期望 ${N5 - 1}`)
})
await check('F5 撤销/重做', 're-15', '重做（单步）→ 节点恢复 9', async () => {
  await frame.locator('[data-testid="flow-redo"]').click()
  await page.waitForTimeout(350)
  assert((await nodeCount()) === N5, `nodes=${await nodeCount()} 期望 ${N5}`)
})
await check('F5 撤销/重做', 're-16', '再撤销回 8；重做钮可用性随栈翻转', async () => {
  await frame.locator('[data-testid="flow-undo"]').click()
  await page.waitForTimeout(300)
  assert((await nodeCount()) === N5 - 1, `nodes=${await nodeCount()}`)
  assert(await frame.locator('[data-testid="flow-redo"]').isEnabled(), 'redo 应可用')
  assert(await frame.locator('[data-testid="flow-undo"]').isEnabled(), 'undo 应可用（栈未空）')
  await shot('re-16-pass')
})

// ═══ F6 多行文本与自适应 ═══
const rectH = (t) => canvas().locator(`.x6-node:has-text("${t}") rect`).first().getAttribute('height')
const rectW = (t) => canvas().locator(`.x6-node:has-text("${t}") rect`).first().getAttribute('width')
async function pollAttr(getter, pred, what) {
  for (let i = 0; i < 20; i++) {
    const v = Number(await getter())
    if (pred(v)) return v
    await page.waitForTimeout(200)
  }
  throw new Error(`${what} 未达标（最后 ${await getter()}）`)
}
await check('F6 多行文本与自适应', 're-17', '多行 label：两行渲染 + 节点盒增高（38→56）', async () => {
  await clickNode('提交申请')
  await frame.locator('.mmagic-flow__panel textarea.is-label').fill('提交申请\n（表单+附件）')
  await frame.locator('[data-testid="flow-apply"]').click()
  const h = await pollAttr(() => rectH('提交申请'), (v) => v >= 50, 'rect 高度')
  assert((await canvas().locator('text:has-text("表单+附件")').count()) > 0, '第二行文本未渲染')
  await shot('re-17-pass', { clip: { x: 690, y: 90, width: 740, height: 500 } })
})
await check('F6 多行文本与自适应', 're-18', '长单行 label：节点盒增宽（76→212）', async () => {
  await clickNode('归档')
  await frame.locator('.mmagic-flow__panel textarea.is-label').fill('归档至长期存储并生成归档回执')
  await frame.locator('[data-testid="flow-apply"]').click()
  const w = await pollAttr(() => rectW('归档至长期存储并生成归档回执'), (v) => v >= 150, 'rect 宽度')
  await shot('re-18-pass', { clip: { x: 690, y: 90, width: 740, height: 500 } })
})

// ═══ F7 属性面板（类型/填充/元数据） ═══
await check('F7 属性面板', 're-19', '类型切换 判定→输入输出：菱形变圆角矩形', async () => {
  await clickNode('审批')
  await frame.locator('.mmagic-flow__panel select').selectOption('io')
  await frame.locator('[data-testid="flow-apply"]').click()
  await page.waitForTimeout(450)
  const n = canvas().locator('.x6-node:has-text("审批")')
  assert((await n.locator('rect').count()) > 0, '未变矩形（rect 缺失）')
  assert((await n.locator('polygon').count()) === 0, '菱形残留')
  await shot('re-19-pass')
})
await check('F7 属性面板', 're-20', '自定义填充色 #ffcc00 → 节点填充生效（已知缺陷 D4 佐证）', async () => {
  await clickNode('审批')
  await frame.locator('.mmagic-flow__panel input[type="color"]').evaluate((el) => {
    el.value = '#ffcc00'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await frame.locator('[data-testid="flow-apply"]').click()
  await page.waitForTimeout(450)
  const fill = await canvas().locator('.x6-node:has-text("审批") rect').first().getAttribute('fill')
  assert(fill === '#ffcc00', `fill=${fill}`)
})
await check('F7 属性面板', 're-21', '元数据 JSON 编辑 → 应用', async () => {
  await clickNode('审批')
  const meta = frame.locator('.mmagic-flow__panel textarea:not(.is-label)')
  await meta.fill('{"owner":"回归测试","sla":"2h"}')
  await frame.locator('[data-testid="flow-apply"]').click()
  await page.waitForTimeout(300)
  assert((await meta.inputValue()).includes('回归测试'), 'meta 未写入')
})

// ═══ F8 连线与边标签 ═══
await check('F8 连线与边标签', 're-22', '连线模式：两击建边 → 边+1', async () => {
  const e0 = await edgeCount()
  await frame.locator('[data-testid="flow-connect"]').click()
  await page.waitForTimeout(250)
  await clickNode('提交申请')
  await clickNode('输入/输出')
  await page.waitForTimeout(350)
  assert((await edgeCount()) === e0 + 1, `edges=${await edgeCount()} 期望 ${e0 + 1}`)
  await frame.locator('[data-testid="flow-connect"]').click()
  await shot('re-22-pass')
})
await check('F8 连线与边标签', 're-23', '边标签编辑 → 画布出现标签文本', async () => {
  await fitFirst()
  const e = canvas().locator('.x6-edge').last()
  const b = await e.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await page.waitForTimeout(300)
  await frame.locator('.mmagic-flow__panel textarea.is-label').fill('自动流转')
  await frame.locator('[data-testid="flow-apply"]').click()
  await page.waitForTimeout(450)
  assert((await canvas().locator('text:has-text("自动流转")').count()) > 0, '边标签未显示')
  await shot('re-23-pass')
})

// ═══ F9 删除 ═══
await check('F9 删除', 're-24', 'Delete 键删节点 → 级联删关联边', async () => {
  await clickNode('输入/输出')
  const n0 = await nodeCount()
  const e0 = await edgeCount()
  await page.keyboard.press('Delete')
  await page.waitForTimeout(450)
  assert((await nodeCount()) === n0 - 1, `nodes=${await nodeCount()} 期望 ${n0 - 1}`)
  assert((await edgeCount()) < e0, `关联边未级联 edges=${await edgeCount()} (前 ${e0})`)
})
await check('F9 删除', 're-25', '「删除选中」钮 → 删节点', async () => {
  await clickNode('归档至长期存储并生成归档回执')
  const n0 = await nodeCount()
  await frame.locator('[data-testid="flow-delete"]').click()
  await page.waitForTimeout(450)
  assert((await nodeCount()) === n0 - 1, `nodes=${await nodeCount()} 期望 ${n0 - 1}`)
  await shot('re-25-pass')
})

// ═══ F10 导出 SVG ═══
await check('F10 导出 SVG', 're-26', '导出 → 触发 .svg 下载', async () => {
  const dlPromise = page.waitForEvent('download', { timeout: 8000 })
  await frame.locator('[data-testid="flow-export-svg"]').click()
  const dl = await dlPromise
  await dl.saveAs(`${ART}/${dl.suggestedFilename()}`)
  assert(dl.suggestedFilename().endsWith('.svg'), `filename=${dl.suggestedFilename()}`)
})

// ═══ F11 关闭确认 ═══
await check('F11 关闭确认', 're-27', 'dirty 关 tab → confirm 拦截；取消则 tab 保留', async () => {
  assert((await badge())?.includes('未保存'), `badge=${await badge()}`)
  await closeActiveTab()
  assert(dialogLog.length > 0, '未弹确认框')
  assert(dialogLog[0].message.includes('未保存'), `dialog=${dialogLog[0].message}`)
  assert((await canvas().count()) > 0, '取消后 tab 被关闭（应保留）')
  await shot('re-27-pass')
})

// ═══ F12 保存链与持久化 ═══
await check('F12 保存链', 're-28', 'Ctrl+S → 徽标清除 + 宿主协议 fileChanged put', async () => {
  await frame.locator('.mmagic-flow__zoom').click() // 惰性点：聚焦 iframe，不触发画布行为
  await page.keyboard.press('ControlOrMeta+s')
  await page.waitForTimeout(1200)
  assert(((await badge()) ?? '').trim() === '', `badge=${await badge()}`)
  const log = await page.locator('body').textContent()
  assert(log.includes('fileChanged'), '协议日志无 fileChanged')
  await shot('re-28-pass', { fullPage: true })
})
await check('F12 保存链', 're-29', '持久化：关 tab 重开 → 多行 label / 元数据还原', async () => {
  await closeActiveTab()
  await openFile('approval.mmd')
  await canvas().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  assert((await canvas().locator('text:has-text("表单+附件")').count()) > 0, '多行 label 未持久化')
  await clickNode('审批')
  const meta = await frame.locator('.mmagic-flow__panel textarea:not(.is-label)').inputValue()
  assert(meta.includes('回归测试'), `元数据未持久化 ${meta}`)
  await shot('re-29-pass')
  await closeActiveTab()
})
await check('F12 保存链', 're-29b', '持久化：自定义填充色还原（已知缺陷 D4 佐证）', async () => {
  await openFile('approval.mmd')
  await canvas().waitFor({ timeout: 15000 })
  await page.waitForTimeout(800)
  const fill = await canvas().locator('.x6-node:has-text("审批") rect').first().getAttribute('fill')
  assert(fill === '#ffcc00', `填充未持久化 fill=${fill}（期望 #ffcc00）`)
  await closeActiveTab()
})

// ═══ F13 语法降级（非 graph TD 只读渲染） ═══
await check('F13 语法降级', 're-30', '时序图 login-seq.mmd → 只读 mermaid 渲染（无编辑工具栏）', async () => {
  await openFile('login-seq.mmd')
  await page.waitForTimeout(2000)
  assert((await frame.locator('.mmagic-mermaid svg').count()) > 0, '无 mermaid 只读渲染')
  assert((await canvas().count()) === 0, '不应出现编辑画布')
  await shot('re-30-pass')
  await closeActiveTab()
})
await check('F13 语法降级', 're-31', '脑图 product-mind.mmd → 只读 mermaid 渲染', async () => {
  await openFile('product-mind.mmd')
  await page.waitForTimeout(2000)
  assert((await frame.locator('.mmagic-mermaid svg').count()) > 0, '无 mermaid 只读渲染')
  await shot('re-31-pass')
  await closeActiveTab()
})

// ═══ F14 边界门 ═══
await check('F14 边界门', 're-32', '坏语法（mindmap+tab 缩进）→ 降级失败提示', async () => {
  await openFile('broken-tab.mmd')
  await page.waitForTimeout(2000)
  assert((await frame.locator('.mmagic-flow-fail').count()) > 0, '无失败提示')
  assert((await frame.getByText('图示渲染失败').count()) > 0, '文案缺失')
  await shot('re-32-pass')
  await closeActiveTab()
})
await check('F14 边界门', 're-33', '宽容语法（broken-mind.mmd）→ 不崩溃（失败提示或只读渲染）', async () => {
  await openFile('broken-mind.mmd')
  await page.waitForTimeout(2000)
  const ro = await frame.locator('.mmagic-mermaid svg').count()
  const fail = await frame.locator('.mmagic-flow-fail').count()
  assert(ro > 0 || fail > 0, `既无只读渲染也无失败提示 ro=${ro} fail=${fail}`)
  assert((await canvas().count()) === 0, '不应进入编辑画布')
  await shot('re-33-pass')
  await closeActiveTab()
})
await check('F14 边界门', 're-34', '超大 huge.mmd（5.6MB>5MiB）→ 过大提示不装配', async () => {
  await openFile('huge.mmd')
  await page.waitForTimeout(2500)
  assert((await frame.locator('.flow-too-large-tip').count()) > 0, '无过大提示')
  assert((await frame.getByText('图示过大').count()) > 0, '文案缺失')
  assert((await canvas().count()) === 0, '不应装配画布')
  await shot('re-34-pass')
  await closeActiveTab()
})
await check('F14 边界门', 're-35', '空图 empty-graph.mmd → 只读渲染不崩溃', async () => {
  await openFile('empty-graph.mmd')
  await page.waitForTimeout(2000)
  const ro = await frame.locator('.mmagic-mermaid svg').count()
  const fail = await frame.locator('.mmagic-flow-fail').count()
  assert(ro > 0 || fail > 0, `空图既无只读渲染也无失败提示 ro=${ro} fail=${fail}`)
  await shot('re-35-pass')
  await closeActiveTab()
})

// ── 收口 ──
writeFileSync(`${ART}/flow-regress-results.json`, JSON.stringify({ baseline: { nodes: BASE_NODES, edges: BASE_EDGES }, results, consoleErrors, dialogLog }, null, 2))
const pass = results.filter((r) => r.pass).length
console.log(`\n===== ${pass}/${results.length} PASS, consoleErrors=${consoleErrors.length} =====`)
await browser.close()
