/**
 * CSV/TSV 表格渲染器（内置应用 csv-table 的 renderer，M2-R3）
 * 契约：《documents/第一期文件类型支持计划.md》§一——papaparse 表格化 + 客户端分页；
 * >20MB 不渲染表格，只出提示节点（截断与下载引导由宿主工具条承接）。
 *
 * 数据流：ctx.getObject(key) → Blob.text() → Papa.parse(text,{header:false}) → <table>
 * 状态：getState() 返回 {page}；savedState（renderer 第 4 参）带 page 则恢复定位（越界收敛）。
 * 生命周期：dispose 还原 el 并 abort 全部监听；提示分支只返回 {dispose}。
 */
import * as Papa from 'papaparse'
import type { AppDefinition } from '../../sdk/types'

/** 超过该字节数（≈字符数，基于 text.length 判定）不出表格，只渲染提示节点 */
export const CSV_MAX_BYTES = 20 * 1024 * 1024

/** 客户端分页每页数据行数（不含表头行） */
export const CSV_PAGE_SIZE = 100

/** 从 savedState 安全读出页码：仅接受 {page: 有限正数}，其余返回 null（回退第 1 页） */
function readSavedPage(savedState: unknown): number | null {
  if (typeof savedState !== 'object' || savedState === null) return null
  const page = (savedState as { page?: unknown }).page
  if (typeof page !== 'number' || !Number.isFinite(page) || page < 1) return null
  return Math.floor(page)
}

/** 竖表单元格（textContent 赋值天然转义，无 XSS 面） */
function appendCell(row: HTMLElement, text: string, tag: 'td' | 'th'): void {
  const cell = document.createElement(tag)
  cell.textContent = text
  row.appendChild(cell)
}

export const csvTableRenderer: AppDefinition['renderer'] = async (el, file, ctx, savedState) => {
  const blob = await ctx.getObject(file.key)
  const text = await blob.text()

  // ── 超阈值：只渲染提示节点（不进 papaparse，防大文本卡死主线程）──
  if (text.length > CSV_MAX_BYTES) {
    const tip = document.createElement('div')
    tip.className = 'mmagic-csv-too-large'
    tip.textContent = ctx.t('app.csv-too-large')
    el.appendChild(tip)
    return { dispose: () => tip.remove() }
  }

  const { data } = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true })
  const rows = data ?? []
  // 空文件：空态提示（无表头可渲染）
  if (rows.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'mmagic-csv-empty'
    empty.textContent = ctx.t('app.csv-empty')
    el.appendChild(empty)
    return { dispose: () => empty.remove() }
  }

  // ── 拆表头/数据行：第 1 行恒为表头（header:false 口径），分页只作用于数据行 ──
  const header = rows[0] ?? []
  const dataRows = rows.slice(1)
  const totalPages = Math.max(1, Math.ceil(dataRows.length / CSV_PAGE_SIZE))
  const saved = readSavedPage(savedState)
  let page = Math.min(Math.max(saved ?? 1, 1), totalPages)

  const wrapper = document.createElement('div')
  wrapper.className = 'mmagic-csv'

  const table = document.createElement('table')
  table.className = 'mmagic-csv-table'
  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  for (const cell of header) appendCell(headRow, cell ?? '', 'th')
  thead.appendChild(headRow)
  const tbody = document.createElement('tbody')
  table.append(thead, tbody)
  wrapper.appendChild(table)

  // ── 分页条：单页不渲染（无多余控件）；按钮锚 data-dir，文本用方向箭头（不依赖词典）──
  let prevBtn: HTMLButtonElement | null = null
  let nextBtn: HTMLButtonElement | null = null
  let indicator: HTMLElement | null = null
  if (totalPages > 1) {
    const pager = document.createElement('div')
    pager.className = 'mmagic-csv-pager'
    prevBtn = document.createElement('button')
    prevBtn.type = 'button'
    prevBtn.dataset.dir = 'prev'
    prevBtn.textContent = '‹'
    prevBtn.title = ctx.t('app.csv-prev')
    nextBtn = document.createElement('button')
    nextBtn.type = 'button'
    nextBtn.dataset.dir = 'next'
    nextBtn.textContent = '›'
    nextBtn.title = ctx.t('app.csv-next')
    indicator = document.createElement('span')
    indicator.className = 'mmagic-csv-page'
    pager.append(prevBtn, indicator, nextBtn)
    wrapper.appendChild(pager)
  }

  const renderPage = (): void => {
    tbody.replaceChildren()
    const start = (page - 1) * CSV_PAGE_SIZE
    for (const row of dataRows.slice(start, start + CSV_PAGE_SIZE)) {
      const tr = document.createElement('tr')
      for (const cell of row) appendCell(tr, cell ?? '', 'td')
      tbody.appendChild(tr)
    }
    if (indicator) indicator.textContent = `${page} / ${totalPages}`
    if (prevBtn) prevBtn.disabled = page <= 1
    if (nextBtn) nextBtn.disabled = page >= totalPages
  }

  const ac = new AbortController()
  prevBtn?.addEventListener(
    'click',
    () => {
      if (page > 1) {
        page--
        renderPage()
      }
    },
    { signal: ac.signal },
  )
  nextBtn?.addEventListener(
    'click',
    () => {
      if (page < totalPages) {
        page++
        renderPage()
      }
    },
    { signal: ac.signal },
  )

  el.appendChild(wrapper)
  renderPage()

  return {
    dispose: () => {
      ac.abort()
      wrapper.remove()
    },
    getState: () => ({ page }),
  }
}
