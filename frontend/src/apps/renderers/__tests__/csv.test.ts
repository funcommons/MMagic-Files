/**
 * csvTableRenderer 单测（M2-R3）
 * 契约正本：csv.ts 文件头注释——papaparse 表格化 + 客户端分页（pageSize 100）
 * + 超阈值（text.length > CSV_MAX_BYTES）只渲染提示节点 + savedState 恢复页码
 *
 * 覆盖点：
 *  1. 样例 CSV（表头行+数据行）→ thead/tbody 行列数；引号包裹的含逗号字段解析正确
 *  2. TSV（tab 分隔）→ papaparse 自动探测分隔符，同样表格化
 *  3. 分页——250 数据行切 3 页：下一页/上一页按钮翻页、页码指示、边界禁用、getState 跟随
 *  4. savedState 恢复——第 4 参 {page} 定位起始页；越界收敛到末页；非法值回退第 1 页
 *  5. 超阈值——只渲染提示节点（ctx.t('app.csv-too-large')），不出表格，无 getState
 *  6. dispose——DOM 还原、按钮监听随 AbortController 失效；单页/提示分支不出分页
 *  7. 空文件——渲染空态提示节点
 */
import { describe, expect, it, vi } from 'vitest'
import { CSV_MAX_BYTES, CSV_PAGE_SIZE, csvTableRenderer } from '../csv'
import type { AppCtx, AppInstance } from '../../../sdk/types'

/** AppCtx 桩：t 恒等返回 key（词典 M2 收口前 renderer 侧拿到的就是 key 口径） */
function makeCtx(blob: Blob): AppCtx {
  return {
    getObject: vi.fn(async () => blob),
    putObject: vi.fn(async () => undefined),
    t: (key: string) => key,
    notify: vi.fn(),
    theme: {},
  }
}

const FILE = { key: 'dir/a.csv', name: 'a.csv', size: 42 }

/** 渲染并收窄到带 getState 的实例（renderer 是 async，全部用例都 await） */
type PageInstance = AppInstance & { getState(): { page: number } }

async function render(el: HTMLElement, blob: Blob, savedState?: unknown): Promise<PageInstance> {
  const ret = await csvTableRenderer(el, FILE, makeCtx(blob), savedState)
  expect(ret && typeof (ret as AppInstance).dispose === 'function').toBe(true)
  return ret as PageInstance
}

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'text/csv' })
}

/** 按 data-dir 定位分页按钮（按钮可见文本是方向箭头，测试锚 data 属性更稳） */
function pagerBtn(el: HTMLElement, dir: 'prev' | 'next'): HTMLButtonElement {
  const btn = el.querySelector<HTMLButtonElement>(`button[data-dir="${dir}"]`)
  expect(btn, `分页按钮 ${dir} 存在`).not.toBeNull()
  return btn!
}

/** 表体首行各列文本（分页断言锚点） */
function firstRowCells(el: HTMLElement): string[] {
  const tds = el.querySelectorAll('tbody tr:first-child td')
  return Array.from(tds, (td) => td.textContent ?? '')
}

/** 样例：2 列（表头 id/name）+ 3 数据行，第 2 行含引号包裹的逗号字段 */
const SAMPLE = 'id,name\n1,alpha\n2,"beta, x"\n3,gamma\n'

describe('csvTableRenderer 基础渲染', () => {
  it('样例 CSV：thead 2 列、tbody 3 行；引号逗号字段不裂格', async () => {
    const el = document.createElement('div')
    await render(el, blobOf(SAMPLE))

    const ths = el.querySelectorAll('thead th')
    expect(ths).toHaveLength(2)
    expect([...ths].map((th) => th.textContent)).toEqual(['id', 'name'])

    const rows = el.querySelectorAll('tbody tr')
    expect(rows).toHaveLength(3)
    expect([...rows[0]!.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1', 'alpha'])
    // "beta, x" 引号包裹 → papaparse 保留为单格
    expect([...rows[1]!.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['2', 'beta, x'])
  })

  it('TSV：papaparse 自动探测 tab 分隔，同样表格化', async () => {
    const el = document.createElement('div')
    await render(el, blobOf('a\tb\n1\t2'))
    expect(el.querySelectorAll('thead th')).toHaveLength(2)
    expect(firstRowCells(el)).toEqual(['1', '2'])
  })

  it('数据行不足一页：不渲染分页按钮，getState 恒为第 1 页', async () => {
    const el = document.createElement('div')
    const inst = await render(el, blobOf(SAMPLE))
    expect(el.querySelector('button[data-dir]')).toBeNull()
    expect(inst.getState()).toEqual({ page: 1 })
  })

  it('空文件：渲染空态提示节点（app.csv-empty），不出表格', async () => {
    const el = document.createElement('div')
    const inst = await render(el, blobOf(''))
    expect(el.childElementCount).toBe(1)
    expect(el.textContent).toContain('app.csv-empty')
    expect(el.querySelector('table')).toBeNull()
    inst.dispose()
    expect(el.childElementCount).toBe(0)
  })
})

describe('csvTableRenderer 分页', () => {
  /** 250 数据行 + 表头 → ceil(250/100)=3 页（100/100/50） */
  function bigCsv(rows: number): string {
    const lines = ['idx,note']
    for (let i = 1; i <= rows; i++) lines.push(`${i},n${i}`)
    return `${lines.join('\n')}\n`
  }

  it('250 行切 3 页：逐页翻动，页码/首行数据/边界禁用/getState 全对齐', async () => {
    const el = document.createElement('div')
    const inst = await render(el, blobOf(bigCsv(250)))

    const indicator = () => el.querySelector('.mmagic-csv-page')?.textContent
    const prev = () => pagerBtn(el, 'prev')
    const next = () => pagerBtn(el, 'next')

    // 第 1 页：100 行，idx 1..100；上一页禁用
    expect(el.querySelectorAll('tbody tr')).toHaveLength(100)
    expect(firstRowCells(el)[0]).toBe('1')
    expect(indicator()).toBe('1 / 3')
    expect(prev().disabled).toBe(true)
    expect(next().disabled).toBe(false)

    // → 第 2 页：idx 101..200
    next().click()
    expect(el.querySelectorAll('tbody tr')).toHaveLength(100)
    expect(firstRowCells(el)[0]).toBe('101')
    expect(indicator()).toBe('2 / 3')
    expect(prev().disabled).toBe(false)
    expect(inst.getState()).toEqual({ page: 2 })

    // → 第 3 页（尾页）：50 行，idx 201..250；下一页禁用
    next().click()
    expect(el.querySelectorAll('tbody tr')).toHaveLength(50)
    expect(firstRowCells(el)[0]).toBe('201')
    expect(indicator()).toBe('3 / 3')
    expect(next().disabled).toBe(true)
    expect(inst.getState()).toEqual({ page: 3 })

    // ← 回第 2 页：上一页可用且数据正确
    prev().click()
    expect(firstRowCells(el)[0]).toBe('101')
    expect(indicator()).toBe('2 / 3')
    expect(inst.getState()).toEqual({ page: 2 })
  })

  it('尾页「下一页」点击为空操作（守卫，不越界出空表）', async () => {
    const el = document.createElement('div')
    const inst = await render(el, blobOf(bigCsv(120))) // 2 页：100+20
    pagerBtn(el, 'next').click()
    pagerBtn(el, 'next').click()
    pagerBtn(el, 'next').click() // 已在尾页
    expect(firstRowCells(el)[0]).toBe('101')
    expect(el.querySelectorAll('tbody tr')).toHaveLength(20)
    expect(inst.getState()).toEqual({ page: 2 })
  })

  it(`pageSize=${CSV_PAGE_SIZE} 页大小边界：整除行数不出现空尾页`, async () => {
    const el = document.createElement('div')
    await render(el, blobOf(bigCsv(200)))
    pagerBtn(el, 'next').click()
    expect(el.querySelectorAll('tbody tr')).toHaveLength(100)
    expect(el.querySelector('.mmagic-csv-page')?.textContent).toBe('2 / 2')
  })
})

describe('csvTableRenderer savedState 恢复', () => {
  function bigCsv(): string {
    const lines = ['idx,note']
    for (let i = 1; i <= 250; i++) lines.push(`${i},n${i}`)
    return `${lines.join('\n')}\n`
  }

  it('savedState={page:2}：直接定位第 2 页且 getState 保持', async () => {
    const el = document.createElement('div')
    const inst = await render(el, blobOf(bigCsv()), { page: 2 })
    expect(firstRowCells(el)[0]).toBe('101')
    expect(el.querySelector('.mmagic-csv-page')?.textContent).toBe('2 / 3')
    expect(inst.getState()).toEqual({ page: 2 })
  })

  it('savedState 越界（page=99）收敛到末页；翻页后从收敛页起算', async () => {
    const el = document.createElement('div')
    const inst = await render(el, blobOf(bigCsv()), { page: 99 })
    expect(firstRowCells(el)[0]).toBe('201')
    expect(el.querySelector('.mmagic-csv-page')?.textContent).toBe('3 / 3')
    pagerBtn(el, 'prev').click()
    expect(inst.getState()).toEqual({ page: 2 })
  })

  it('非法 savedState（字符串/0/负数）回退第 1 页', async () => {
    for (const bad of ['junk', 3, { page: 0 }, { page: -2 }, { page: '2' }, null]) {
      const el = document.createElement('div')
      const inst = await render(el, blobOf(bigCsv()), bad)
      expect(firstRowCells(el)[0], `savedState=${JSON.stringify(bad)} 回退第 1 页`).toBe('1')
      expect(inst.getState()).toEqual({ page: 1 })
    }
  })
})

describe('csvTableRenderer 超阈值与 dispose', () => {
  it(`text.length > CSV_MAX_BYTES（${CSV_MAX_BYTES}）：只渲染提示节点，无表格无 getState`, async () => {
    const el = document.createElement('div')
    // 阈值基于 text.length：构造超长字符串触发提示分支（不进 papaparse）
    const big = blobOf(`id,name\n1,${'x'.repeat(CSV_MAX_BYTES + 1)}`)
    const inst = await render(el, big)
    expect(el.childElementCount).toBe(1)
    expect(el.textContent).toContain('app.csv-too-large')
    expect(el.querySelector('table')).toBeNull()
    expect(inst.getState).toBeUndefined()
    inst.dispose()
    expect(el.childElementCount).toBe(0)
  })

  it('dispose：DOM 还原；detach 后点击分页按钮不报错（监听已 abort）', async () => {
    const el = document.createElement('div')
    const lines = ['idx,note']
    for (let i = 1; i <= 250; i++) lines.push(`${i},n${i}`)
    const inst = await render(el, blobOf(`${lines.join('\n')}\n`))
    const next = pagerBtn(el, 'next')
    next.click()
    expect(firstRowCells(el)[0]).toBe('101')

    inst.dispose()
    expect(el.childElementCount).toBe(0)
    // 监听已随 AbortController 失效：点击游离按钮应静默无副作用
    expect(() => next.click()).not.toThrow()
    expect(firstRowCells(el)).toEqual([])
  })

  it('dispose 可重复调用（幂等）', async () => {
    const el = document.createElement('div')
    const inst = await render(el, blobOf(SAMPLE))
    inst.dispose()
    expect(() => inst.dispose()).not.toThrow()
    expect(el.childElementCount).toBe(0)
  })
})
