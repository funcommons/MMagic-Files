/**
 * xlsx 渲染器（内置应用 xlsx-viewer 的 renderer，M2-R5——M4 内容提前）
 * 契约：《documents/第一期文件类型支持计划.md》§一（xlsx-viewer 行，SheetJS 多 sheet 切换）+
 *       《动态插件方案.md》V1.1 §二 ctx 能力面（凭证不出、字节流进出）。
 * 链路：ctx.getObject(key) → Blob.arrayBuffer → 动态 import('xlsx')（SheetJS 体积大，不入主
 *       bundle）→ XLSX.read(data,{type:'array'}) → 顶部 sheet 标签按钮行（切换）+
 *       当前 sheet 用 XLSX.utils.sheet_to_html 渲染进 sheet 区 innerHTML（表格挂 xlsx-table）。
 * 安全：sheet_to_html 文本已转义，但 data-v 属性欠转义（单元格原文直出），innerHTML 解析后
 *       可能形成带 src/onerror 的活性元素——渲染后统一剥除表格内全部属性（只保行列结构语义）。
 * 状态：getState()={sheet}（当前 sheet 下标）；savedState（第 4 参）带 sheet 则恢复（越界收敛）。
 * 生命周期：dispose=abort 监听 + 清空容器；getObject/解析失败→错误提示节点、空工作簿→空态
 *       提示节点，两者只返回 {dispose}，不向调用侧抛出。
 */
import type { WorkBook } from 'xlsx'
import type { AppCtx, AppDefinition } from '../../sdk/types'

/** i18n key：xlsx 加载/解析失败提示（键照用，文案待主线在 locales 词典补录） */
const LOAD_FAIL_KEY = 'app.xlsx-load-fail'
/** i18n key：空工作簿（无任何 sheet）提示 */
const EMPTY_KEY = 'app.xlsx-empty'

/** 从 savedState 安全读出 sheet 下标：仅接受 {sheet: 非负整数}，其余返回 null（回退第 1 个） */
function readSavedSheet(savedState: unknown): number | null {
  if (typeof savedState !== 'object' || savedState === null) return null
  const sheet = (savedState as { sheet?: unknown }).sheet
  if (typeof sheet !== 'number' || !Number.isInteger(sheet) || sheet < 0) return null
  return sheet
}

/** 提示节点（文案走宿主词典；样式对齐 pdf/csv 渲染器口径） */
function buildTip(ctx: AppCtx, key: string, className: string): HTMLDivElement {
  const tip = document.createElement('div')
  tip.className = className
  tip.style.padding = '16px'
  tip.style.color = 'var(--app-text-secondary, #888)'
  tip.textContent = ctx.t(key)
  return tip
}

/** 剥除 sheet 区内全部属性（含 SheetJS 欠转义的 data-v 与其衍生的 src/onerror），只保结构 */
function stripAttributes(root: HTMLElement): void {
  for (const node of root.querySelectorAll('*')) {
    for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name)
  }
}

export const xlsxRenderer: AppDefinition['renderer'] = async (el, file, ctx, savedState) => {
  let wb: WorkBook | undefined
  let XLSX: typeof import('xlsx') | undefined
  try {
    const blob = await ctx.getObject(file.key)
    const data = await blob.arrayBuffer()
    // 动态 import（bundle 重量）；jsdom/弱网下 import 失败同样进 catch 降级
    XLSX = await import('xlsx')
    wb = XLSX.read(data, { type: 'array' })
  } catch {
    // 字节流拿不到 / 非法 xlsx——提示节点 + 空 dispose，不抛出（R2 pdf 同款失败面）
    const tip = buildTip(ctx, LOAD_FAIL_KEY, 'xlsx-load-fail')
    el.appendChild(tip)
    return { dispose: () => tip.remove() }
  }

  // 空工作簿：无 sheet 可渲染，出空态提示（不走标签/表格分支）
  const names = wb.SheetNames
  if (names.length === 0) {
    const tip = buildTip(ctx, EMPTY_KEY, 'xlsx-empty')
    el.appendChild(tip)
    return { dispose: () => tip.remove() }
  }

  let current = Math.min(readSavedSheet(savedState) ?? 0, names.length - 1)

  const wrapper = document.createElement('div')
  wrapper.className = 'xlsx-view'

  // ── 当前 sheet 表格区：sheet_to_html 进 innerHTML → 只留 table → 剥属性 → 挂 class ──
  const sheetArea = document.createElement('div')
  sheetArea.className = 'xlsx-sheet'
  wrapper.appendChild(sheetArea)

  const renderSheet = (): void => {
    const sheet = wb?.Sheets[names[current] ?? '']
    sheetArea.innerHTML = sheet ? XLSX!.utils.sheet_to_html(sheet) : ''
    const table = sheetArea.querySelector('table')
    if (table) {
      // sheet_to_html 产出整段文档串（html/head/body 包裹）：只保留 table，弃 head/meta/title
      sheetArea.replaceChildren(table)
      stripAttributes(sheetArea)
      table.className = 'xlsx-table'
    }
    for (let i = 0; i < tabs.length; i++) {
      const active = i === current
      tabs[i]!.classList.toggle('xlsx-tab--active', active)
      tabs[i]!.setAttribute('aria-selected', String(active))
    }
  }

  // ── sheet 标签按钮行：文案=textContent（sheet 名按文本呈现，不解析为元素）──
  const tabsRow = document.createElement('div')
  tabsRow.className = 'xlsx-tabs'
  const tabs: HTMLButtonElement[] = []
  const ac = new AbortController()
  names.forEach((name, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'xlsx-tab'
    btn.dataset.sheet = String(i)
    btn.textContent = name
    btn.addEventListener(
      'click',
      () => {
        if (current !== i) {
          current = i
          renderSheet()
        }
      },
      { signal: ac.signal },
    )
    tabsRow.appendChild(btn)
    tabs.push(btn)
  })
  wrapper.appendChild(tabsRow)

  el.appendChild(wrapper)
  renderSheet()

  return {
    dispose: () => {
      ac.abort()
      wrapper.remove()
    },
    getState: () => ({ sheet: current }),
  }
}
