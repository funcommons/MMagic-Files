/**
 * xlsx 渲染器单测（M2-R5——M4 内容提前）
 * 契约正本：renderers/xlsx.ts 头注释——getObject→arrayBuffer→动态 import('xlsx')
 * →XLSX.read(data,{type:'array'})→顶部 sheet 标签切换 + 当前 sheet 走
 * sheet_to_html 渲染（表格挂 xlsx-table class）；savedState 恢复当前 sheet；
 * getState={sheet}；空工作簿/加载失败→提示节点，不向调用侧抛出。
 *
 * 工作簿用真实 SheetJS 造（book_new/aoa_to_sheet/book_append_sheet/write，jsdom 可跑）；
 * 唯独「空工作簿」无法经 write 产出（SheetJS 对无 sheet 工作簿 write 直接抛错）——
 * 用 importOriginal 局部 mock：read 改回真实的 utils.book_new()（SheetNames=[]），其余全真。
 *
 * 覆盖点：
 *  1. 双 sheet：标签按钮数量/文案（HTML 按文本呈现）、默认渲染第 1 个 sheet、表格挂 xlsx-table class
 *  2. 切换：点第 2 个标签 → 表格 HTML 变化、active 态迁移、getState 跟随、回切还原
 *  3. savedState={sheet:1} 直接渲染第 2 个 sheet；非法/越界 savedState 回第 1 个
 *  4. 空工作簿（SheetNames=[]）→ 提示节点、无标签无表格、无 getState
 *  5. 加载失败：getObject 拒绝 / 非法字节（非 zip）→ 错误提示、不抛出
 *  6. 安全：敌意单元格（SheetJS data-v 属性欠转义）不得残留 src/onerror 活性属性
 *  7. dispose：el 清空；游离标签点击无副作用、可重复调用
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { xlsxRenderer } from '../xlsx'
import type { AppCtx, AppInstance } from '../../../sdk/types'

// ───────────────────────── 局部 mock：仅服务「空工作簿」分支 ─────────────────────────
// xlsxHolder.emptyBook=true 时 read 返回真实的空工作簿（SheetNames=[]），其余路径全真
const xlsxHolder = vi.hoisted(() => ({ emptyBook: false }))
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('xlsx')>()
  return {
    ...actual,
    read: (data: Parameters<typeof actual.read>[0], opts?: Parameters<typeof actual.read>[1]) =>
      xlsxHolder.emptyBook ? actual.utils.book_new() : actual.read(data, opts),
  }
})

/** 渲染文件实参 */
const FILE = { key: 'docs/a.xlsx', name: 'a.xlsx', size: 9000 }

/**
 * 双 sheet 样例：SheetA 两行两列；第 2 个 sheet 名含 HTML 片段（按文本呈现，且不含 SheetJS
 * 禁用字符 / \ [ ] * ?）且单格（切换后表格 HTML 必变）
 */
const SHEETS: Array<[string, unknown[][]]> = [
  ['SheetA', [['a1', 'b1'], ['a2', 'b2']]],
  ['Sheet<b>', [['x9']]],
]

/** 用真实 SheetJS 把 aoa 工作簿写成 xlsx 字节流 Blob */
function xlsxBlob(sheets: Array<[string, unknown[][]]>): Blob {
  const wb = XLSX.utils.book_new()
  for (const [name, aoa] of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  return new Blob([out])
}

/** fake ctx：getObject 可注入成功/拒绝；t 加前缀以便断言文案确实走词典 */
function makeCtx(getObjectImpl: (key: string) => Promise<Blob>): AppCtx {
  return {
    getObject: vi.fn(getObjectImpl),
    putObject: vi.fn(async () => undefined),
    t: (key: string) => `T:${key}`,
    notify: vi.fn(),
    theme: {},
  }
}

/** 成功路径实例（恒带 getState）；renderer 是 async，全部用例都 await */
type SheetInstance = AppInstance & { getState(): { sheet: number } }

async function render(
  el: HTMLElement,
  blob: Blob,
  savedState?: unknown,
): Promise<{ inst: SheetInstance; ctx: AppCtx }> {
  const ctx = makeCtx(async () => blob)
  const ret = await xlsxRenderer(el, FILE, ctx, savedState)
  const inst = ret as SheetInstance
  expect(typeof inst.dispose).toBe('function')
  expect(typeof inst.getState, '成功路径必须带 getState').toBe('function')
  return { inst, ctx }
}

/** 当前 sheet 表格首格文本（切换前后 HTML 变化的断言锚点） */
function firstCell(el: HTMLElement): string {
  return el.querySelector('.xlsx-sheet table tr td')?.textContent ?? ''
}

/** 第 i 个 sheet 标签按钮（data-sheet=index） */
function tabBtn(el: HTMLElement, index: number): HTMLButtonElement {
  const btn = el.querySelector<HTMLButtonElement>(`.xlsx-tabs button[data-sheet="${index}"]`)
  expect(btn, `sheet 标签 ${index} 存在`).not.toBeNull()
  return btn!
}

beforeEach(() => {
  xlsxHolder.emptyBook = false
})

afterEach(() => {
  xlsxHolder.emptyBook = false
  vi.restoreAllMocks()
})

describe('xlsxRenderer 基础渲染', () => {
  it('双 sheet：标签按钮 2 个、文案=sheet 名（HTML 按文本呈现）；默认渲染第 1 个 sheet', async () => {
    const el = document.createElement('div')
    const { inst, ctx } = await render(el, xlsxBlob(SHEETS))

    expect(vi.mocked(ctx.getObject).mock.calls[0]?.[0]).toBe('docs/a.xlsx')

    const tabs = el.querySelectorAll('.xlsx-tabs button')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.textContent).toBe('SheetA')
    expect(tabs[1]!.textContent).toBe('Sheet<b>')
    expect(el.querySelector('.xlsx-tabs b'), 'sheet 名不得被解析为元素').toBeNull()

    const table = el.querySelector('.xlsx-sheet table')
    expect(table, '表格挂在 sheet 区').not.toBeNull()
    expect(table!.className).toBe('xlsx-table')
    expect(firstCell(el)).toBe('a1')
    expect(el.textContent).not.toContain('x9')
    expect(inst.getState()).toEqual({ sheet: 0 })
  })
})

describe('xlsxRenderer sheet 切换', () => {
  it('点第 2 个标签：表格 HTML 变化、active 迁移、getState 跟随；回切还原', async () => {
    const el = document.createElement('div')
    const { inst } = await render(el, xlsxBlob(SHEETS))

    const sheetArea = el.querySelector('.xlsx-sheet')!
    const before = sheetArea.innerHTML
    tabBtn(el, 1).click()

    expect(el.querySelector('.xlsx-sheet')!.innerHTML).not.toBe(before)
    expect(firstCell(el)).toBe('x9')
    expect(tabBtn(el, 1).classList.contains('xlsx-tab--active'), 'active 迁到按钮 2').toBe(true)
    expect(tabBtn(el, 0).classList.contains('xlsx-tab--active')).toBe(false)
    expect(inst.getState()).toEqual({ sheet: 1 })

    tabBtn(el, 0).click()
    expect(firstCell(el)).toBe('a1')
    expect(inst.getState()).toEqual({ sheet: 0 })
  })
})

describe('xlsxRenderer savedState 恢复', () => {
  it('savedState={sheet:1}：直接渲染第 2 个 sheet，getState 保持、active 对位', async () => {
    const el = document.createElement('div')
    const { inst } = await render(el, xlsxBlob(SHEETS), { sheet: 1 })
    expect(firstCell(el)).toBe('x9')
    expect(inst.getState()).toEqual({ sheet: 1 })
    expect(tabBtn(el, 1).classList.contains('xlsx-tab--active')).toBe(true)
  })

  it('非法 savedState 回退第 1 个 sheet', async () => {
    for (const bad of ['junk', 3, { sheet: -1 }, { sheet: '1' }, { other: 1 }, null]) {
      const el = document.createElement('div')
      const { inst } = await render(el, xlsxBlob(SHEETS), bad)
      expect(firstCell(el), `savedState=${JSON.stringify(bad)} 回退第 1 个 sheet`).toBe('a1')
      expect(inst.getState()).toEqual({ sheet: 0 })
    }
  })

  it('越界 savedState（sheet=9）收敛到末个 sheet（对齐 csv 渲染器越界收敛口径）', async () => {
    const el = document.createElement('div')
    const { inst } = await render(el, xlsxBlob(SHEETS), { sheet: 9 })
    expect(firstCell(el)).toBe('x9')
    expect(inst.getState()).toEqual({ sheet: 1 })
  })
})

describe('xlsxRenderer 空工作簿与失败面', () => {
  it('空工作簿（SheetNames=[]）：提示节点、无标签无表格、无 getState；dispose 清空', async () => {
    xlsxHolder.emptyBook = true
    const el = document.createElement('div')
    const ret = await xlsxRenderer(el, FILE, makeCtx(async () => xlsxBlob(SHEETS)))
    const inst = ret as AppInstance

    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe('T:app.xlsx-empty')
    expect(el.querySelector('.xlsx-tabs')).toBeNull()
    expect(el.querySelector('table')).toBeNull()
    expect(inst.getState, '提示分支无 getState').toBeUndefined()

    inst.dispose()
    expect(el.childElementCount).toBe(0)
  })

  it('getObject 拒绝：不抛出，错误提示节点（app.xlsx-load-fail）', async () => {
    const el = document.createElement('div')
    const ret = await xlsxRenderer(
      el,
      FILE,
      makeCtx(async () => {
        throw new Error('sigv4 403')
      }),
    )
    expect(ret, '失败面也返回实例').toBeDefined()
    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe('T:app.xlsx-load-fail')
    expect(el.querySelector('table')).toBeNull()
  })

  it('非法字节（zip 魔数但结构破损）：XLSX.read 抛错 → 错误提示节点，不抛出', async () => {
    // 纯文本字节 SheetJS 会按 CSV/文本兜底解析（不抛），须用带魔数的破损 zip 才能触发失败面
    const corrupt = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef])])
    const el = document.createElement('div')
    const ret = await xlsxRenderer(el, FILE, makeCtx(async () => corrupt))
    expect(ret).toBeDefined()
    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe('T:app.xlsx-load-fail')
    expect(el.querySelector('table')).toBeNull()
  })
})

describe('xlsxRenderer 安全与 dispose', () => {
  it('敌意单元格（data-v 欠转义）：innerHTML 后不残留 src/onerror 活性属性，正常格照常渲染', async () => {
    const hostile = '"><img src=x onerror=alert(1)>'
    const el = document.createElement('div')
    await render(el, xlsxBlob([['SheetA', [[hostile, 'normal']]]]))

    expect(el.querySelector('[src]'), '不得有 src 属性元素').toBeNull()
    expect(el.querySelector('[onerror]'), '不得有 onerror 属性元素').toBeNull()
    expect(el.textContent).toContain('normal')
  })

  it('dispose：el 清空；游离标签点击无副作用（监听已 abort）；可重复调用', async () => {
    const el = document.createElement('div')
    const { inst } = await render(el, xlsxBlob(SHEETS))
    const tab = tabBtn(el, 1)

    inst.dispose()
    expect(el.childElementCount).toBe(0)
    expect(() => tab.click()).not.toThrow()
    expect(el.querySelector('table')).toBeNull()
    expect(() => inst.dispose()).not.toThrow()
  })
})
